import { NextResponse } from "next/server";
import { accessToken, getOpenOrders } from "@/lib/ebay";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const chunks = <T,>(rows: T[], size = 100) => {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
};

export async function POST() {
  try {
    const token = await accessToken();
    const orders = await getOpenOrders(token);
    const openLines = (order: any) => (order.lineItems || []).filter((line: any) => {
      const lineStatus = String(line.lineItemFulfillmentStatus || "").toUpperCase();
      return String(order.orderFulfillmentStatus || "").toUpperCase() === "NOT_STARTED" || !lineStatus || lineStatus === "NOT_STARTED";
    });

    const itemIds = [...new Set(orders.flatMap((order: any) => openLines(order).map((line: any) => String(line.legacyItemId || ""))).filter(Boolean))];
    const storedListings: any[] = [];
    for (const group of chunks(itemIds, 150)) {
      storedListings.push(...await db(`marketplace_listings?select=id,ebay_listing_id,title,ebay_sku,image_url&ebay_listing_id=in.(${group.join(",")})`));
    }
    const listingMap = new Map(storedListings.map((row: any) => [String(row.ebay_listing_id), row]));
    let imported = 0;
    let updated = 0;
    const unmatched: string[] = [];

    // Remove rows accidentally imported from eBay's historical unfiltered
    // feed. Their allocated cards were already shipped, so the sold locations
    // must be removed rather than returned to available inventory.
    const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const staleRows = await db(`marketplace_orders?select=id,marketplace_order_id,listing_id&marketplace=eq.ebay&fulfillment_status=eq.unfulfilled&ordered_at=lt.${encodeURIComponent(cutoff)}`);
    for (const stale of staleRows || []) {
      const listingFilter = stale.listing_id ? `&listing_id=eq.${stale.listing_id}` : "";
      await db(`physical_skus?source_order_id=eq.${encodeURIComponent(String(stale.marketplace_order_id))}&status=eq.allocated${listingFilter}`, { method: "DELETE" });
      await db(`marketplace_orders?id=eq.${stale.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fulfillment_status: "fulfilled", sku_removed_at: new Date().toISOString() }),
      });
    }

    for (const order of orders) {
      for (const line of openLines(order)) {
        const itemId = String(line.legacyItemId || "");
        if (!itemId) {
          unmatched.push(`${order.orderId}: missing item ID`);
          continue;
        }
        let listing: any = listingMap.get(itemId);
        if (!listing) {
          const title = String(line.title || `eBay sold item ${itemId}`);
          const lower = title.toLowerCase();
          const game = lower.includes("magic: the gathering") || /\bmtg\b/.test(lower)
            ? "magic"
            : lower.includes("pokemon") || lower.includes("pokémon") ? "pokemon" : "other";
          const now = new Date().toISOString();
          await db("marketplace_listings?on_conflict=ebay_listing_id", {
            method: "POST",
            headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
            body: JSON.stringify({
              ebay_listing_id: itemId,
              ebay_sku: line.sku ? String(line.sku) : null,
              title,
              game,
              ebay_quantity: 0,
              ebay_status: "inactive",
              last_ebay_sync_at: now,
              updated_at: now,
            }),
          });
          listing = (await db(`marketplace_listings?select=id,ebay_listing_id,title,ebay_sku,image_url&ebay_listing_id=eq.${itemId}&limit=1`))?.[0];
          if (listing) listingMap.set(itemId, listing);
        }
        if (!listing) {
          unmatched.push(`${order.orderId}: item ${itemId}`);
          continue;
        }

        const orderId = String(order.orderId);
        const existing = await db(`marketplace_orders?select=id&marketplace=eq.ebay&marketplace_order_id=eq.${encodeURIComponent(orderId)}&listing_id=eq.${listing.id}&limit=1`);
        const soldQuantity = Math.max(1, Number(line.quantity || 1));
        const locations = await db(`physical_skus?select=id,sku,location_label,created_at&listing_id=eq.${listing.id}&status=eq.available&order=created_at.asc&limit=500`);
        const pulled = [...(locations || [])]
          .sort((a: any, b: any) => Number(b.sku === listing.ebay_sku) - Number(a.sku === listing.ebay_sku) || String(a.created_at).localeCompare(String(b.created_at)))
          .slice(0, soldQuantity);
        const rawPayload = {
          lineItemId: line.lineItemId,
          legacyItemId: itemId,
          sku: line.sku ?? listing.ebay_sku ?? null,
          orderTotal: order.pricingSummary?.total?.value ?? null,
          lineTotal: line.lineItemCost?.value ?? null,
          currency: order.pricingSummary?.total?.currency ?? "USD",
        };

        if (existing?.length) {
          await db(`marketplace_orders?id=eq.${existing[0].id}`, {
            method: "PATCH",
            body: JSON.stringify({ raw_payload: rawPayload, order_title: listing.title }),
          });
          updated += 1;
          continue;
        }

        await db("marketplace_orders", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            marketplace: "ebay",
            marketplace_order_id: orderId,
            listing_id: listing.id,
            quantity: soldQuantity,
            fulfillment_status: "unfulfilled",
            refunded: false,
            ordered_at: order.creationDate || new Date().toISOString(),
            order_title: listing.title,
            pull_sku: pulled.length ? pulled.map((row: any) => row.sku).join(", ") : line.sku || listing.ebay_sku || null,
            pull_location: pulled.length ? pulled.map((row: any) => row.location_label).join(", ") : line.sku || listing.ebay_sku || null,
            sku_removed_at: null,
            raw_payload: rawPayload,
          }),
        });
        for (const location of pulled) {
          await db(`physical_skus?id=eq.${location.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "allocated", source_order_id: orderId, updated_at: new Date().toISOString() }),
          });
        }
        const remaining=Math.max(0,Number(listing.ebay_quantity||0)-soldQuantity);
        await db(`marketplace_listings?id=eq.${listing.id}`, {
          method:"PATCH",
          body:JSON.stringify({ebay_quantity:remaining,ebay_status:remaining>0?"active":"inactive",updated_at:new Date().toISOString()}),
        });
        listing.ebay_quantity=remaining;
        imported += 1;
      }
    }

    return NextResponse.json({ ok: true, orders: orders.length, lines: orders.reduce((sum: number, order: any) => sum + openLines(order).length, 0), imported, updated, staleCleared: staleRows?.length || 0, unmatched });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "eBay order import failed" }, { status: 500 });
  }
}
