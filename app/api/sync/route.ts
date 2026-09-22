import { NextResponse } from "next/server";
import { accessToken, getActiveListings, getOpenOrders } from "@/lib/ebay";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function chunks<T>(rows: T[], size = 300) {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}

export async function POST() {
  try {
    const token = await accessToken();
    const listings = await getActiveListings(token);
    if (!listings.length) throw new Error("eBay returned zero active listings. No Supabase records were changed.");

    // eBay is read-only. This endpoint writes only to the fresh Supabase catalog.
    await db("marketplace_listings?ebay_status=eq.active", { method: "PATCH", body: JSON.stringify({ ebay_status: "inactive", updated_at: new Date().toISOString() }) });
    for (const group of chunks(listings)) {
      await db("marketplace_listings?on_conflict=ebay_listing_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(group),
      });
    }

    const stored: any[] = [];
    const ids = listings.map(x => x.ebay_listing_id);
    for (const group of chunks(ids, 150)) {
      stored.push(...await db(`marketplace_listings?select=id,ebay_listing_id&ebay_listing_id=in.(${group.join(",")})`));
    }
    const listingMap = new Map(stored.map(x => [String(x.ebay_listing_id), x.id]));

    // Preserve the primary location carried by each active eBay listing.
    const primaryLocations = listings.filter(x => x.ebay_sku).map(x => ({
      listing_id: listingMap.get(x.ebay_listing_id), sku: x.ebay_sku,
      location_label: x.ebay_sku, status: "available", source: "ebay",
      updated_at: new Date().toISOString(),
    })).filter(x => x.listing_id);
    for (const group of chunks(primaryLocations)) {
      await db("physical_skus?on_conflict=sku", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(group),
      });
    }

    // Rebuild quantity discrepancies without altering either eBay quantity or locations.
    await db("reconciliation_issues?status=eq.open", { method: "PATCH", body: JSON.stringify({ status: "resolved", last_seen_at: new Date().toISOString() }) });
    const differences = await db("listing_reconciliation?select=id,ebay_quantity,active_sku_count,difference&difference=neq.0");
    const issues = differences.map((x: any) => ({
      listing_id: x.id, issue_type: Number(x.difference) > 0 ? "missing_sku" : "extra_sku",
      ebay_quantity: x.ebay_quantity, active_sku_count: x.active_sku_count, status: "open",
      last_seen_at: new Date().toISOString(), details: { difference: x.difference },
    }));
    for (const group of chunks(issues)) {
      await db("reconciliation_issues?on_conflict=listing_id,issue_type", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(group),
      });
    }

    let importedOrders = 0;
    try {
      const orders = await getOpenOrders(token);
      const rows: any[] = [];
      for (const order of orders) for (const line of order.lineItems || []) {
        const listingId = listingMap.get(String(line.legacyItemId || ""));
        if (!listingId) continue;
        rows.push({ marketplace: "ebay", marketplace_order_id: String(order.orderId), listing_id: listingId,
          quantity: Number(line.quantity || 1), fulfillment_status: "unfulfilled", refunded: false,
          ordered_at: order.creationDate || new Date().toISOString(), raw_payload: { lineItemId: line.lineItemId, legacyItemId: line.legacyItemId } });
      }
      if (rows.length) for (const group of chunks(rows)) {
        await db("marketplace_orders?on_conflict=marketplace,marketplace_order_id,listing_id", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(group),
        });
      }
      importedOrders = rows.length;
    } catch (orderError) {
      return NextResponse.json({ ok: true, listings: listings.length, orders: 0, warning: `Listings imported. Orders could not be imported: ${orderError instanceof Error ? orderError.message : "unknown error"}` });
    }
    return NextResponse.json({ ok: true, listings: listings.length, orders: importedOrders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 });
  }
}
