import { NextResponse } from "next/server";
import { db, dbAll } from "@/lib/supabase";
import { coalesceManaPoolInventory, getManaPoolOrder, getManaPoolOrders, getManaPoolSinglePricesFor, lowestManaPoolPriceForFinish, manaPoolConfigured, manaPoolPrice, manaPoolSyncEnabled, manaPoolVariantPriceKey, setManaPoolInventory } from "@/lib/manapool";
import { accessToken, endListing, getActiveListings, reviseListingQuantity } from "@/lib/ebay";
import { chooseScryfallCandidate, findScryfallCandidates, manaPoolVariant, titleIdentity } from "@/lib/scryfall";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function mappingConflicts(rows:any[]) {
  const groups = new Map<string,any[]>();
  for (const row of rows.filter((x:any)=>x.scryfall_id)) {
    const key = manaPoolVariantPriceKey(row);
    groups.set(key,[...(groups.get(key)||[]),row]);
  }
  return Array.from(groups.entries()).filter(([,listings])=>listings.length>1).map(([key,listings])=>({
    key,
    scryfall_id:listings[0].scryfall_id,
    language_id:listings[0].language_id||"EN",
    condition_id:listings[0].condition_id||"NM",
    finish_id:listings[0].finish_id||"NF",
    listings:listings.map((x:any)=>({
      id:x.id,ebay_listing_id:x.ebay_listing_id,title:x.title,ebay_sku:x.ebay_sku,
      ebay_quantity:x.ebay_quantity,locations:(x.physical_skus||[]).map((s:any)=>({sku:s.sku,location_label:s.location_label,status:s.status})),
    })),
  }));
}

async function overview() {
  const mapped = await dbAll("marketplace_listings?select=id,ebay_listing_id,ebay_sku,title,card_name,card_number,set_name,finish,condition_name,ebay_quantity,scryfall_id,language_id,finish_id,condition_id,manapool_mapping_status,manapool_mapping_candidates,manapool_price_cents,manapool_quantity,physical_skus(sku,location_label,status)&game=eq.magic&ebay_status=eq.active&order=title.asc");
  const unresolvedDetails = mapped
    .filter((x:any) => !x.scryfall_id && ["unmatched","review"].includes(x.manapool_mapping_status))
    .map((x:any) => {
      const parsed = titleIdentity(x);
      const candidates = Array.isArray(x.manapool_mapping_candidates) ? x.manapool_mapping_candidates : [];
      let reason = "No Scryfall printing matched the parsed card name and collector number.";
      if (!parsed.name) reason = "Card name could not be parsed from the eBay title.";
      else if (!parsed.number) reason = "Collector number could not be parsed from the eBay title.";
      else if (x.manapool_mapping_status === "review" && candidates.length) reason = `${candidates.length} possible printings were found; manual selection is required.`;
      return {
        id:x.id, ebay_listing_id:x.ebay_listing_id, title:x.title, status:x.manapool_mapping_status,
        parsed_name:parsed.name || "", parsed_number:parsed.number || "", parsed_set:parsed.setName || "",
        parsed_finish:parsed.finish || "Non-Foil", reason,
      };
    });
  return {
    configured: manaPoolConfigured(), enabled: manaPoolSyncEnabled(),
    mapped: mapped.filter((x:any) => x.scryfall_id).length,
    unmapped: mapped.filter((x:any) => !x.scryfall_id).length,
    review: mapped.filter((x:any) => x.manapool_mapping_status === "review").slice(0, 30),
    reviewCount: mapped.filter((x:any) => x.manapool_mapping_status === "review").length,
    queued: mapped.filter((x:any) => !x.scryfall_id && x.manapool_mapping_status === "pending").length,
    unmatched: mapped.filter((x:any) => !x.scryfall_id && x.manapool_mapping_status === "unmatched").length,
    unresolvedDetails,
    conflicts:mappingConflicts(mapped),
  };
}

export async function GET() {
  try { return NextResponse.json(await overview()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mana Pool status failed" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body:any = await request.json().catch(() => ({}));
    const mode = body?.mode || "preview";
    if (mode === "retry-unresolved") {
      await db("marketplace_listings?game=eq.magic&ebay_status=eq.active&scryfall_id=is.null&manapool_mapping_status=in.(review,unmatched)", {
        method:"PATCH", body:JSON.stringify({ manapool_mapping_status:"pending", manapool_mapping_candidates:[] }),
      });
      return NextResponse.json({ok:true,overview:await overview()});
    }
    if (mode === "map") {
      const pending = await dbAll("marketplace_listings?select=id,title,card_name,card_number,set_name,language,finish,condition_name&game=eq.magic&ebay_status=eq.active&scryfall_id=is.null&manapool_mapping_status=eq.pending&order=title.asc", 40);
      let matched = 0, review = 0, unmatched = 0, failed = 0;
      for (const row of pending.slice(0, 40)) {
        try {
          const candidates = await findScryfallCandidates(row);
          const chosen = chooseScryfallCandidate(row, candidates);
          if (chosen) {
            await db(`marketplace_listings?id=eq.${row.id}`, { method:"PATCH", body:JSON.stringify({ scryfall_id:chosen.id, manapool_mapping_status:"mapped", manapool_mapping_candidates:candidates, ...manaPoolVariant(row) }) });
            matched++;
          } else {
            const status = candidates.length ? "review" : "unmatched";
            await db(`marketplace_listings?id=eq.${row.id}`, { method:"PATCH", body:JSON.stringify({ manapool_mapping_status:status, manapool_mapping_candidates:candidates }) });
            candidates.length ? review++ : unmatched++;
          }
        } catch {
          // A single unusual title or temporary catalog response must not stop
          // every other card in this mapping batch.
          failed++;
        }
        await new Promise(resolve => setTimeout(resolve, 110));
      }
      return NextResponse.json({ ok:true, processed:pending.slice(0,40).length, matched, review, unmatched, failed, remaining:Math.max(0, pending.length - 40 + failed), overview:await overview() });
    }
    if (mode === "confirm-map") {
      const id = String(body.id || ""), scryfallId = String(body.scryfall_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(scryfallId)) throw new Error("Invalid Scryfall ID");
      const rows = await db(`marketplace_listings?select=id,title,language,finish,condition_name&id=eq.${encodeURIComponent(id)}&game=eq.magic&limit=1`);
      if (!rows?.[0]) throw new Error("Magic listing not found");
      await db(`marketplace_listings?id=eq.${encodeURIComponent(id)}`, { method:"PATCH", body:JSON.stringify({ scryfall_id:scryfallId, manapool_mapping_status:"mapped", ...manaPoolVariant(rows[0]) }) });
      return NextResponse.json({ok:true,overview:await overview()});
    }
    if (mode === "review-conflict") {
      const id=String(body.id||"");
      const rows=await db(`marketplace_listings?select=id,title,card_name,card_number,set_name,language,finish,condition_name&id=eq.${encodeURIComponent(id)}&game=eq.magic&ebay_status=eq.active&limit=1`);
      if(!rows?.[0]) throw new Error("Conflicting Magic listing was not found");
      const candidates=await findScryfallCandidates(rows[0]);
      await db(`marketplace_listings?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({scryfall_id:null,manapool_mapping_status:"review",manapool_mapping_candidates:candidates})});
      return NextResponse.json({ok:true,overview:await overview()});
    }
    if (mode === "combine-conflict") {
      const ids=Array.isArray(body.listing_ids)?[...new Set(body.listing_ids.map(String))].slice(0,20):[];
      if(ids.length<2||ids.some((id:any)=>!/^[0-9a-f-]{36}$/i.test(id))) throw new Error("Conflict selection could not be verified");
      const records=await db(`marketplace_listings?select=id,ebay_listing_id,scryfall_id,language_id,finish_id,condition_id&id=in.(${ids.join(",")})&game=eq.magic&ebay_status=eq.active`);
      if(records?.length!==ids.length||new Set(records.map((x:any)=>manaPoolVariantPriceKey(x))).size!==1) throw new Error("These listings no longer share the same Mana Pool mapping");
      const token=await accessToken();
      const ebayIds=new Set(records.map((x:any)=>String(x.ebay_listing_id)));
      const live=(await getActiveListings(token)).filter((x:any)=>ebayIds.has(String(x.ebay_listing_id)));
      if(live.length!==records.length) throw new Error("One or more eBay listings are no longer active. Refresh and review again.");
      live.sort((a:any,b:any)=>(Date.parse(b.started_at||"")||0)-(Date.parse(a.started_at||"")||0)||Number(b.ebay_listing_id)-Number(a.ebay_listing_id));
      const survivor=live[0],total=live.reduce((sum:number,x:any)=>sum+Number(x.ebay_quantity||0),0);
      await reviseListingQuantity(String(survivor.ebay_listing_id),total);
      for(const old of live.slice(1)) await endListing(String(old.ebay_listing_id));
      const survivorRecord=records.find((x:any)=>String(x.ebay_listing_id)===String(survivor.ebay_listing_id));
      for(const old of records.filter((x:any)=>x.id!==survivorRecord.id)) {
        await db(`physical_skus?listing_id=eq.${old.id}`,{method:"PATCH",body:JSON.stringify({listing_id:survivorRecord.id,updated_at:new Date().toISOString()})});
        await db(`marketplace_listings?id=eq.${old.id}`,{method:"DELETE"});
      }
      await db(`marketplace_listings?id=eq.${survivorRecord.id}`,{method:"PATCH",body:JSON.stringify({ebay_quantity:total,updated_at:new Date().toISOString()})});
      return NextResponse.json({ok:true,quantity:total,ended:live.length-1,overview:await overview()});
    }
    const listings = await dbAll("marketplace_listings?select=id,ebay_listing_id,ebay_sku,title,ebay_quantity,scryfall_id,language_id,finish_id,condition_id,physical_skus(sku,location_label,status)&game=eq.magic&ebay_status=eq.active&scryfall_id=not.is.null");
    const conflicts=mappingConflicts(listings);
    const pricesByScryfall = await getManaPoolSinglePricesFor(listings.map((x:any) => String(x.scryfall_id)));
    const priced = listings.flatMap((x:any) => {
      const market = pricesByScryfall.get(String(x.scryfall_id).toLowerCase());
      const lowestCents = market ? lowestManaPoolPriceForFinish(market, x.finish_id || "NF") : null;
      if (lowestCents === null) return [];
      return [{ listing:x, lowestCents, update:{
        scryfall_id:String(x.scryfall_id), language_id:x.language_id || "EN", finish_id:x.finish_id || "NF", condition_id:x.condition_id || "NM",
        quantity:Number(x.ebay_quantity || 0), price_cents:manaPoolPrice(lowestCents), custom_external_id:String(x.ebay_listing_id),
      }}];
    });
    const pricedIds = new Set(priced.map((x:any) => x.listing.id));
    const missing = listings.filter((x:any) => !pricedIds.has(x.id));
    const previewRows = priced.slice(0, 100).map((x:any) => ({
      title:x.listing.title, lowest_cents:x.lowestCents, price_cents:x.update.price_cents,
      quantity:x.update.quantity, condition_id:x.update.condition_id, finish_id:x.update.finish_id,
    }));
    if (mode === "preview") return NextResponse.json({ preview:previewRows, total:priced.length, missing:missing.length, mapped:listings.length, enabled:manaPoolSyncEnabled(),conflicts });
    if (missing.length) throw new Error(`${missing.length} mapped cards have no Mana Pool market price for their printing and finish. Run Preview changes and review them before live sync.`);
    if (conflicts.length) throw new Error(`${conflicts.length} Mana Pool mapping conflict${conflicts.length===1?"":"s"} must be reviewed before live inventory can be synced.`);
    const rawUpdates = priced.map((x:any) => x.update);
    const updates = coalesceManaPoolInventory(rawUpdates);
    const result = await setManaPoolInventory(updates);
    for (const row of priced) await db(`marketplace_listings?id=eq.${row.listing.id}`, { method:"PATCH", body:JSON.stringify({ manapool_quantity:row.listing.ebay_quantity, manapool_lowest_cents:row.lowestCents, manapool_price_cents:row.update.price_cents, last_manapool_sync_at:new Date().toISOString() }) });
    return NextResponse.json({ ok:true, updated:updates.length, combinedDuplicates:rawUpdates.length-updates.length, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mana Pool sync failed" }, { status: 500 }); }
}

export async function PATCH() {
  try {
    const summaries = await getManaPoolOrders();
    let imported = 0, ebayReduced = 0, ebayEnded = 0, skipped = 0;
    const errors:string[] = [];
    for (const summary of summaries) {
      const detail = await getManaPoolOrder(String(summary.id));
      for (const item of detail?.items || detail?.order?.items || []) {
        try {
          const external = String(item.custom_external_id || item.product?.custom_external_id || "");
          const listingRows = external ? await db(`marketplace_listings?select=id,title,ebay_sku,ebay_listing_id,ebay_quantity,ebay_status&ebay_listing_id=eq.${encodeURIComponent(external)}&limit=1`) : [];
          const listing = listingRows?.[0];
          const quantity = Math.max(1, Number(item.quantity || 1));
          const existing = listing ? await db(`marketplace_orders?select=id,fulfillment_status,raw_payload&marketplace=eq.manapool&marketplace_order_id=eq.${encodeURIComponent(String(summary.id))}&listing_id=eq.${listing.id}&limit=1`) : [];
          if (existing?.[0] && existing[0].fulfillment_status !== "processing") { skipped++; continue; }

          let orderId = existing?.[0]?.id;
          let targetQuantity = Number(existing?.[0]?.raw_payload?.ebay_sync?.target_quantity);
          if (!orderId) {
            targetQuantity = listing ? Math.max(0, Number(listing.ebay_quantity || 0) - quantity) : 0;
            const locations = listing ? await db(`physical_skus?select=id,sku,location_label,created_at&listing_id=eq.${listing.id}&status=eq.available&order=created_at.asc&limit=${quantity}`) : [];
            const pulled = (locations || []).slice(0, quantity);
            const rawPayload = { order_label:summary.label, shipping_method:summary.shipping_method, mana_pool_order:detail,
              ebay_sync:{ status:"processing", previous_quantity:Number(listing?.ebay_quantity || 0), sold_quantity:quantity, target_quantity:targetQuantity } };
            const created = await db("marketplace_orders", { method:"POST", headers:{Prefer:"return=representation"}, body:JSON.stringify({
              marketplace:"manapool", marketplace_order_id:String(summary.id), listing_id:listing?.id || null, quantity,
              fulfillment_status:"processing", refunded:false, ordered_at:summary.created_at || new Date().toISOString(),
              order_title:item.name || item.product?.single?.name || listing?.title || "Mana Pool order",
              pull_sku:pulled.map((x:any)=>x.sku).join(", ") || null, pull_location:pulled.map((x:any)=>x.location_label).join(", ") || null,
              raw_payload:rawPayload,
            }) });
            orderId = created?.[0]?.id;
            for (const location of pulled) await db(`physical_skus?id=eq.${location.id}`, { method:"PATCH", body:JSON.stringify({status:"allocated",source_order_id:String(summary.id),updated_at:new Date().toISOString()}) });
          }

          if (listing && Number.isFinite(targetQuantity)) {
            if (targetQuantity <= 0) {
              try { await endListing(String(listing.ebay_listing_id)); }
              catch (error) {
                if (!/already ended|not active|cannot be accessed|not found/i.test(error instanceof Error ? error.message : "")) throw error;
              }
              ebayEnded++;
            } else {
              await reviseListingQuantity(String(listing.ebay_listing_id), targetQuantity);
              ebayReduced++;
            }
            await db(`marketplace_listings?id=eq.${listing.id}`, { method:"PATCH", body:JSON.stringify({
              ebay_quantity:targetQuantity, ebay_status:targetQuantity > 0 ? "active" : "inactive", updated_at:new Date().toISOString(),
            }) });
          }
          if (orderId) {
            const payload = existing?.[0]?.raw_payload || { order_label:summary.label, shipping_method:summary.shipping_method, mana_pool_order:detail };
            payload.ebay_sync = { ...(payload.ebay_sync || {}), status:"completed", target_quantity:targetQuantity };
            await db(`marketplace_orders?id=eq.${orderId}`, { method:"PATCH", body:JSON.stringify({fulfillment_status:"unfulfilled",raw_payload:payload}) });
          }
          imported++;
        } catch (error) {
          errors.push(`${summary.id}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
    }
    return NextResponse.json({ok:errors.length===0,orders:summaries.length,lines:imported,ebayReduced,ebayEnded,skipped,errors:errors.slice(0,10)}, {status:errors.length ? 207 : 200});
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mana Pool order import failed" }, { status: 500 }); }
}
