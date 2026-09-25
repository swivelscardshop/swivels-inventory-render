import { NextResponse } from "next/server";
import { accessToken, getActiveListings, getOpenOrders, getOrder } from "@/lib/ebay";
import { db, dbAll } from "@/lib/supabase";
import { getManaPoolSinglePricesFor, lowestManaPoolPriceForFinish, manaPoolPrice, manaPoolSyncEnabled, manaPoolVariantPriceKey, setManaPoolInventory } from "@/lib/manapool";
import { chooseScryfallCandidate, findScryfallCandidates, manaPoolVariant } from "@/lib/scryfall";

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
    const previousMappedMagic = await dbAll("marketplace_listings?select=id,ebay_listing_id,scryfall_id,language_id,finish_id,condition_id&game=eq.magic&ebay_status=eq.active&scryfall_id=not.is.null");

    // The normal import is read-only against eBay and refreshes the Supabase catalog.
    await db("marketplace_listings?ebay_status=eq.active", { method: "PATCH", body: JSON.stringify({ ebay_status: "inactive", updated_at: new Date().toISOString() }) });
    // Remove stale Magic classifications before rebuilding them from the exact
    // eBay Store category assigned to each current listing.
    await db("marketplace_listings?game=eq.magic", { method: "PATCH", body: JSON.stringify({ game: "other", updated_at: new Date().toISOString() }) });
    for (const group of chunks(listings)) {
      const databaseRows = group.map(({ started_at: _startedAt, ...listing }) => listing);
      await db("marketplace_listings?on_conflict=ebay_listing_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(databaseRows),
      });
    }

    // PostgREST has intermittently preserved the old `game` value while
    // merging existing listing rows. Apply the eBay classification explicitly
    // so Mana Pool reads the same set reported by the import response.
    const magicListingIds = listings.filter((listing) => listing.game === "magic").map((listing) => listing.ebay_listing_id);
    for (const group of chunks(magicListingIds, 100)) {
      await db(`marketplace_listings?ebay_listing_id=in.(${group.join(",")})`, {
        method: "PATCH", body: JSON.stringify({ game: "magic", updated_at: new Date().toISOString() }),
      });
    }

    // Newly listed Magic singles are mapped automatically when there is one
    // unambiguous printing. Only genuinely ambiguous cards wait for review.
    const pendingMagic = await dbAll("marketplace_listings?select=id,title,card_name,card_number,set_name,language,finish,condition_name&game=eq.magic&ebay_status=eq.active&scryfall_id=is.null&manapool_mapping_status=eq.pending&order=title.asc");
    let automaticallyMapped = 0, mappingReview = 0;
    for (const row of pendingMagic) {
      try {
        const candidates = await findScryfallCandidates(row);
        const chosen = chooseScryfallCandidate(row, candidates);
        if (chosen) {
          await db(`marketplace_listings?id=eq.${row.id}`, { method:"PATCH", body:JSON.stringify({scryfall_id:chosen.id,manapool_mapping_status:"mapped",manapool_mapping_candidates:candidates,...manaPoolVariant(row)}) });
          automaticallyMapped++;
        } else {
          await db(`marketplace_listings?id=eq.${row.id}`, { method:"PATCH", body:JSON.stringify({manapool_mapping_status:candidates.length?"review":"unmatched",manapool_mapping_candidates:candidates}) });
          mappingReview++;
        }
      } catch { mappingReview++; }
    }

    // eBay is the quantity master. Every eBay import publishes mapped Magic
    // singles to Mana Pool, updates quantities, and sends zero for listings
    // that disappeared from eBay.
    let manaPoolPublished = 0;
    if (manaPoolSyncEnabled()) {
      const activeMapped = await dbAll("marketplace_listings?select=id,ebay_listing_id,ebay_quantity,scryfall_id,language_id,finish_id,condition_id&game=eq.magic&ebay_status=eq.active&scryfall_id=not.is.null");
      const variantCounts=new Map<string,number>();
      for(const row of activeMapped) { const key=manaPoolVariantPriceKey(row); variantCounts.set(key,(variantCounts.get(key)||0)+1); }
      const priceMap = await getManaPoolSinglePricesFor(activeMapped.map((x:any)=>String(x.scryfall_id)));
      const updates:any[] = [];
      for (const row of activeMapped) {
        if((variantCounts.get(manaPoolVariantPriceKey(row))||0)>1) continue;
        const market = priceMap.get(String(row.scryfall_id).toLowerCase());
        const lowest = market ? lowestManaPoolPriceForFinish(market,row.finish_id||"NF") : null;
        if (lowest === null) continue;
        updates.push({scryfall_id:String(row.scryfall_id),language_id:row.language_id||"EN",finish_id:row.finish_id||"NF",condition_id:row.condition_id||"NM",quantity:Number(row.ebay_quantity||0),price_cents:manaPoolPrice(lowest),custom_external_id:String(row.ebay_listing_id)});
      }
      const activeIds = new Set(listings.map(x=>String(x.ebay_listing_id)));
      for (const row of previousMappedMagic.filter((x:any)=>!activeIds.has(String(x.ebay_listing_id)))) updates.push({scryfall_id:String(row.scryfall_id),language_id:row.language_id||"EN",finish_id:row.finish_id||"NF",condition_id:row.condition_id||"NM",quantity:0,price_cents:null,custom_external_id:String(row.ebay_listing_id)});
      if (updates.length) await setManaPoolInventory(updates);
      manaPoolPublished=updates.length;
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
    let completedOrders = 0;
    try {
      const fetchedOrders = await getOpenOrders(token);
      const orders = fetchedOrders.filter((order: any) => ["NOT_STARTED", "IN_PROGRESS"].includes(String(order.orderFulfillmentStatus || "").toUpperCase()));
      const openLines = (order:any) => (order.lineItems || []).filter((line:any) => {
        const lineStatus = String(line.lineItemFulfillmentStatus || "").toUpperCase();
        const orderStatus = String(order.orderFulfillmentStatus || "").toUpperCase();
        return orderStatus === "NOT_STARTED" || !lineStatus || lineStatus === "NOT_STARTED";
      });
      const legacyIds = [...new Set(orders.flatMap((order: any) => openLines(order).map((line: any) => String(line.legacyItemId || ""))).filter(Boolean))];
      const orderListings: any[] = [];
      for (const group of chunks(legacyIds, 150)) orderListings.push(...await db(`marketplace_listings?select=id,ebay_listing_id,title,ebay_sku,image_url&ebay_listing_id=in.(${group.join(",")})`));
      const orderListingMap = new Map(orderListings.map(x => [String(x.ebay_listing_id), x]));
      const orderIds = orders.map((x: any) => String(x.orderId));
      const existing: any[] = [];
      for (const group of chunks(orderIds, 100)) existing.push(...await db(`marketplace_orders?select=id,marketplace_order_id,listing_id&marketplace_order_id=in.(${group.join(",")})`));
      const existingMap = new Map(existing.map(x => [`${x.marketplace_order_id}|${x.listing_id}`, x]));
      for (const order of orders) for (const line of openLines(order)) {
        const listing = orderListingMap.get(String(line.legacyItemId || ""));
        if (!listing) continue;
        const rawPayload = {
          lineItemId: line.lineItemId,
          legacyItemId: line.legacyItemId,
          orderTotal: order.pricingSummary?.total?.value ?? null,
          lineTotal: line.lineItemCost?.value ?? null,
          currency: order.pricingSummary?.total?.currency ?? "USD",
        };
        const existingOrder = existingMap.get(`${order.orderId}|${listing.id}`);
        if (existingOrder) {
          await db(`marketplace_orders?id=eq.${existingOrder.id}`, { method: "PATCH", body: JSON.stringify({ raw_payload: rawPayload, order_title: listing.title }) });
          continue;
        }
        const soldQuantity = Math.max(1, Number(line.quantity || 1));
        const locations = await db(`physical_skus?select=id,sku,location_label,created_at&listing_id=eq.${listing.id}&status=eq.available&order=created_at.asc&limit=500`);
        // Pull the surviving eBay listing's own location first, then attached
        // duplicate/CSV locations in their original intake order.
        const pulled = [...(locations || [])]
          .sort((a: any, b: any) => Number(b.sku === listing.ebay_sku) - Number(a.sku === listing.ebay_sku) || String(a.created_at).localeCompare(String(b.created_at)))
          .slice(0, soldQuantity);
        const row = { marketplace: "ebay", marketplace_order_id: String(order.orderId), listing_id: listing.id,
          quantity: soldQuantity, fulfillment_status: "unfulfilled", refunded: false,
          ordered_at: order.creationDate || new Date().toISOString(), order_title: listing.title,
          pull_sku: pulled.length ? pulled.map((x: any) => x.sku).join(", ") : listing.ebay_sku || null,
          pull_location: pulled.length ? pulled.map((x: any) => x.location_label).join(", ") : listing.ebay_sku || null,
          sku_removed_at: null,
          raw_payload: rawPayload };
        await db("marketplace_orders?on_conflict=marketplace,marketplace_order_id,listing_id", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row),
        });
        for (const location of pulled) await db(`physical_skus?id=eq.${location.id}`, {
          method: "PATCH", body: JSON.stringify({ status: "allocated", source_order_id: String(order.orderId), updated_at: new Date().toISOString() }),
        });
        importedOrders += 1;
      }

      // Reconcile orders that were shipped or canceled directly on eBay after
      // they had already been allocated in this app.
      const openOrderIds = new Set(orders.filter((order:any) => openLines(order).length).map((order: any) => String(order.orderId)));
      const pendingEbayOrders = await dbAll("marketplace_orders?select=id,marketplace_order_id,listing_id,fulfillment_status&marketplace=eq.ebay&fulfillment_status=eq.unfulfilled&refunded=eq.false");
      const staleOrderIds = [...new Set((pendingEbayOrders || []).map((row: any) => String(row.marketplace_order_id)).filter((id: string) => !openOrderIds.has(id)))];
      for (const orderId of staleOrderIds) {
        const current: any = await getOrder(token, orderId);
        const fulfillment = String(current?.orderFulfillmentStatus || "").toUpperCase();
        const cancelState = String(current?.cancelStatus?.cancelState || "").toUpperCase();
        const canceled = cancelState === "CANCELED" || cancelState === "CANCELLED";
        if (!canceled && fulfillment !== "IN_PROGRESS" && fulfillment !== "FULFILLED") continue;
        const affected = (pendingEbayOrders || []).filter((row: any) => String(row.marketplace_order_id) === orderId);
        for (const row of affected) {
          const listingFilter = row.listing_id ? `&listing_id=eq.${row.listing_id}` : "";
          if (canceled) {
            await db(`physical_skus?source_order_id=eq.${encodeURIComponent(orderId)}&status=eq.allocated${listingFilter}`, {
              method: "PATCH", body: JSON.stringify({ status: "available", source_order_id: null, updated_at: new Date().toISOString() }),
            });
            await db(`marketplace_orders?id=eq.${row.id}`, {
              method: "PATCH", body: JSON.stringify({ fulfillment_status: "fulfilled", refunded: true }),
            });
          } else {
            await db(`physical_skus?source_order_id=eq.${encodeURIComponent(orderId)}&status=eq.allocated${listingFilter}`, { method: "DELETE" });
            await db(`marketplace_orders?id=eq.${row.id}`, {
              method: "PATCH", body: JSON.stringify({ fulfillment_status: "fulfilled", sku_removed_at: new Date().toISOString() }),
            });
          }
          completedOrders += 1;
        }
      }

      // Allocated SKUs remain in Supabase until the user explicitly confirms
      // shipment in the app or eBay reports that fulfillment has started.
    } catch (orderError) {
      const magicSingles = listings.filter(x => x.game === "magic").length;
      return NextResponse.json({ ok: true, listings: listings.length, magicSingles, orders: 0, warning: `Imported ${listings.length.toLocaleString()} listings including ${magicSingles.toLocaleString()} Magic singles. Orders could not be imported: ${orderError instanceof Error ? orderError.message : "unknown error"}` });
    }
    return NextResponse.json({ ok: true, listings: listings.length, magicSingles: listings.filter(x => x.game === "magic").length, orders: importedOrders, completedOrders, automaticallyMapped, mappingReview, manaPoolPublished });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 });
  }
}
