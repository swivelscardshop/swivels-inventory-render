import { NextResponse } from "next/server";
import { db, dbAll } from "@/lib/supabase";
import { getManaPoolOrder, getManaPoolOrders, manaPoolConfigured, manaPoolPrice, manaPoolSyncEnabled, setManaPoolInventory } from "@/lib/manapool";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function overview() {
  const mapped = await dbAll("marketplace_listings?select=id,ebay_listing_id,title,ebay_quantity,tcgplayer_sku,manapool_price_cents,manapool_quantity&game=eq.magic&ebay_status=eq.active&order=title.asc");
  return {
    configured: manaPoolConfigured(), enabled: manaPoolSyncEnabled(),
    mapped: mapped.filter((x:any) => x.tcgplayer_sku).length,
    unmapped: mapped.filter((x:any) => !x.tcgplayer_sku).length,
    rows: mapped.slice(0, 100),
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
    const listings = await dbAll("marketplace_listings?select=id,ebay_listing_id,title,ebay_quantity,tcgplayer_sku,manapool_lowest_cents&game=eq.magic&ebay_status=eq.active&tcgplayer_sku=not.is.null");
    const updates = listings.map((x:any) => ({
      tcgplayer_sku: Number(x.tcgplayer_sku), quantity: Number(x.ebay_quantity || 0),
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
