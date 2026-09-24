import { NextResponse } from "next/server";
import { db, dbAll } from "@/lib/supabase";
import { getManaPoolOrder, getManaPoolOrders, manaPoolConfigured, manaPoolPrice, manaPoolSyncEnabled, setManaPoolInventory } from "@/lib/manapool";
import { findScryfallCandidates, manaPoolVariant } from "@/lib/scryfall";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function overview() {
  const mapped = await dbAll("marketplace_listings?select=id,ebay_listing_id,title,ebay_quantity,scryfall_id,manapool_mapping_status,manapool_mapping_candidates,manapool_price_cents,manapool_quantity&game=eq.magic&ebay_status=eq.active&order=title.asc");
  return {
    configured: manaPoolConfigured(), enabled: manaPoolSyncEnabled(),
    mapped: mapped.filter((x:any) => x.scryfall_id).length,
    unmapped: mapped.filter((x:any) => !x.scryfall_id).length,
    review: mapped.filter((x:any) => x.manapool_mapping_status === "review").slice(0, 30),
    reviewCount: mapped.filter((x:any) => x.manapool_mapping_status === "review").length,
    queued: mapped.filter((x:any) => !x.scryfall_id && x.manapool_mapping_status === "pending").length,
    unmatched: mapped.filter((x:any) => !x.scryfall_id && x.manapool_mapping_status === "unmatched").length,
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
          const normalize = (value:string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g," ").trim();
          const normalizedTitle = normalize(row.title);
          const titleMatches = candidates.filter((candidate) => {
            const setName = normalize(candidate.set_name);
            const setAlias = normalize(String(candidate.set_name).split(":")[0]);
            const number = String(candidate.collector_number || "").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
            const numberInTitle = number && new RegExp(`(^|[^a-z0-9])${number}([^a-z0-9]|$)`,`i`).test(row.title);
            const setInTitle = (setName && normalizedTitle.includes(setName)) || (setAlias.length >= 4 && normalizedTitle.includes(setAlias));
            return Boolean(setInTitle && numberInTitle);
          });
          const exact = candidates.filter((candidate) => row.set_name && normalize(candidate.set_name) === normalize(String(row.set_name)) && (!row.card_number || normalize(candidate.collector_number) === normalize(String(row.card_number))));
          const chosen = titleMatches.length === 1 ? titleMatches[0] : exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
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
      return NextResponse.json({ ok:true, processed:pending.slice(0,40).length, matched, review, unmatched, failed, remaining:Math.max(0, pending.length - 40), overview:await overview() });
    }
    if (mode === "confirm-map") {
      const id = String(body.id || ""), scryfallId = String(body.scryfall_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(scryfallId)) throw new Error("Invalid Scryfall ID");
      const rows = await db(`marketplace_listings?select=id,title,language,finish,condition_name&id=eq.${encodeURIComponent(id)}&game=eq.magic&limit=1`);
      if (!rows?.[0]) throw new Error("Magic listing not found");
      await db(`marketplace_listings?id=eq.${encodeURIComponent(id)}`, { method:"PATCH", body:JSON.stringify({ scryfall_id:scryfallId, manapool_mapping_status:"mapped", ...manaPoolVariant(rows[0]) }) });
      return NextResponse.json({ok:true,overview:await overview()});
    }
    const listings = await dbAll("marketplace_listings?select=id,ebay_listing_id,title,ebay_quantity,scryfall_id,language_id,finish_id,condition_id,manapool_lowest_cents&game=eq.magic&ebay_status=eq.active&scryfall_id=not.is.null");
    const updates = listings.map((x:any) => ({
      scryfall_id: String(x.scryfall_id), language_id:x.language_id || "EN", finish_id:x.finish_id || "NF", condition_id:x.condition_id || "NM", quantity: Number(x.ebay_quantity || 0),
      price_cents: manaPoolPrice(Number(x.manapool_lowest_cents || 0)), custom_external_id: String(x.ebay_listing_id),
    }));
    if (mode === "preview") return NextResponse.json({ preview: updates.slice(0, 100), total: updates.length, enabled: manaPoolSyncEnabled() });
    const result = await setManaPoolInventory(updates);
    for (const row of listings) await db(`marketplace_listings?id=eq.${row.id}`, { method:"PATCH", body:JSON.stringify({ manapool_quantity: row.ebay_quantity, manapool_price_cents: manaPoolPrice(Number(row.manapool_lowest_cents || 0)), last_manapool_sync_at:new Date().toISOString() }) });
    return NextResponse.json({ ok:true, updated:updates.length, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mana Pool sync failed" }, { status: 500 }); }
}

export async function PATCH() {
  try {
    const summaries = await getManaPoolOrders();
    let imported = 0;
    for (const summary of summaries) {
      const detail = await getManaPoolOrder(String(summary.id));
      for (const item of detail?.items || detail?.order?.items || []) {
        const external = String(item.custom_external_id || item.product?.custom_external_id || "");
        const listingRows = external ? await db(`marketplace_listings?select=id,title,ebay_sku&ebay_listing_id=eq.${encodeURIComponent(external)}&limit=1`) : [];
        const listing = listingRows?.[0];
        const quantity = Math.max(1, Number(item.quantity || 1));
        const locations = listing ? await db(`physical_skus?select=id,sku,location_label,created_at&listing_id=eq.${listing.id}&status=eq.available&order=created_at.asc&limit=${quantity}`) : [];
        const pulled = (locations || []).slice(0, quantity);
        const row = { marketplace:"manapool", marketplace_order_id:String(summary.id), listing_id:listing?.id || null, quantity,
          fulfillment_status:"unfulfilled", refunded:false, ordered_at:summary.created_at || new Date().toISOString(),
          order_title:item.name || item.product?.single?.name || listing?.title || "Mana Pool order",
          pull_sku:pulled.map((x:any)=>x.sku).join(", ") || null, pull_location:pulled.map((x:any)=>x.location_label).join(", ") || null,
          raw_payload:{ order_label:summary.label, shipping_method:summary.shipping_method, mana_pool_order:detail },
        };
        await db("marketplace_orders?on_conflict=marketplace,marketplace_order_id,listing_id", { method:"POST", headers:{Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify(row) });
        for (const location of pulled) await db(`physical_skus?id=eq.${location.id}`, { method:"PATCH", body:JSON.stringify({status:"allocated",source_order_id:String(summary.id),updated_at:new Date().toISOString()}) });
        imported++;
      }
    }
    return NextResponse.json({ok:true,orders:summaries.length,lines:imported});
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mana Pool order import failed" }, { status: 500 }); }
}
