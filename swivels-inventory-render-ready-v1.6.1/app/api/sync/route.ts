import { NextResponse } from "next/server";
import { accessToken, getActiveListings, getOpenOrders } from "@/lib/ebay";
import { db, dbAll } from "@/lib/supabase";

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

    // The normal import is read-only against eBay and refreshes the Supabase catalog.
    await db("marketplace_listings?ebay_status=eq.active", { method: "PATCH", body: JSON.stringify({ ebay_status: "inactive", updated_at: new Date().toISOString() }) });
    for (const group of chunks(listings)) {
      const databaseRows = group.map(({ started_at: _startedAt, ...listing }) => listing);
      await db("marketplace_listings?on_conflict=ebay_listing_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(databaseRows),
      });
    }

    const stored: any[] = [];
    const ids = listings.map(x => x.ebay_listing_id);
    for (const group of chunks(ids, 150)) {
      stored.push(...await db(`marketplace_listings?select=id,ebay_listing_id,match_key,title&ebay_listing_id=in.(${group.join(",")})`));
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

    // Attach every physical SKU from a CSV batch once its new eBay listing exists.
    const keyToIds = new Map<string, string[]>();
    for (const row of stored) if (row.match_key) keyToIds.set(row.match_key, [...(keyToIds.get(row.match_key) || []), row.id]);
    const pending = await dbAll("pending_skus?select=id,match_key,sku,location_label&order=id.asc");
    const attached: any[] = [], attachedIds: string[] = [];
    for (const row of pending || []) {
      const matches = keyToIds.get(row.match_key) || [];
      if (matches.length !== 1) continue;
      attached.push({ listing_id: matches[0], sku: row.sku, location_label: row.location_label, status: "available", source: "csv_intake", updated_at: new Date().toISOString() });
      attachedIds.push(row.id);
    }
    for (const group of chunks(attached)) await db("physical_skus?on_conflict=sku", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(group) });
    for (const group of chunks(attachedIds, 100)) await db(`pending_skus?id=in.(${group.join(",")})`, { method: "DELETE" });

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
      const legacyIds = [...new Set(orders.flatMap((order: any) => (order.lineItems || []).map((line: any) => String(line.legacyItemId || ""))).filter(Boolean))];
      const orderListings: any[] = [];
      for (const group of chunks(legacyIds, 150)) orderListings.push(...await db(`marketplace_listings?select=id,ebay_listing_id,title,ebay_sku&ebay_listing_id=in.(${group.join(",")})`));
      const orderListingMap = new Map(orderListings.map(x => [String(x.ebay_listing_id), x]));
      const orderIds = orders.map((x: any) => String(x.orderId));
      const existing: any[] = [];
      for (const group of chunks(orderIds, 100)) existing.push(...await db(`marketplace_orders?select=marketplace_order_id,listing_id&marketplace_order_id=in.(${group.join(",")})`));
      const existingKeys = new Set(existing.map(x => `${x.marketplace_order_id}|${x.listing_id}`));
      for (const order of orders) for (const line of order.lineItems || []) {
        const listing = orderListingMap.get(String(line.legacyItemId || ""));
        if (!listing || existingKeys.has(`${order.orderId}|${listing.id}`)) continue;
        const soldQuantity = Math.max(1, Number(line.quantity || 1));
        const locations = await db(`physical_skus?select=id,sku,location_label&listing_id=eq.${listing.id}&status=eq.available&order=created_at.asc&limit=${soldQuantity}`);
        const pulled = locations || [];
        const row = { marketplace: "ebay", marketplace_order_id: String(order.orderId), listing_id: listing.id,
          quantity: soldQuantity, fulfillment_status: "unfulfilled", refunded: false,
          ordered_at: order.creationDate || new Date().toISOString(), order_title: listing.title,
          pull_sku: pulled.length ? pulled.map((x: any) => x.sku).join(", ") : listing.ebay_sku || null,
          pull_location: pulled.length ? pulled.map((x: any) => x.location_label).join(", ") : listing.ebay_sku || null,
          sku_removed_at: pulled.length ? new Date().toISOString() : null,
          raw_payload: { lineItemId: line.lineItemId, legacyItemId: line.legacyItemId } };
        await db("marketplace_orders?on_conflict=marketplace,marketplace_order_id,listing_id", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row),
        });
        for (const location of pulled) await db(`physical_skus?id=eq.${location.id}`, { method: "DELETE" });
        importedOrders += 1;
      }
      // Remove cards that no longer exist as active eBay listings. Order location snapshots remain.
      await db("marketplace_listings?ebay_status=eq.inactive", { method: "DELETE" });
    } catch (orderError) {
      return NextResponse.json({ ok: true, listings: listings.length, orders: 0, warning: `Listings imported. Orders could not be imported: ${orderError instanceof Error ? orderError.message : "unknown error"}` });
    }
    return NextResponse.json({ ok: true, listings: listings.length, orders: importedOrders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 });
  }
}
