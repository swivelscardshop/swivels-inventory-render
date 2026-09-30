import { NextResponse } from "next/server";
import { db, dbAll } from "@/lib/supabase";
import { endListing, reviseListingQuantity } from "@/lib/ebay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const safeDate = (value: unknown) => value ? String(value) : null;
const chunks=<T,>(rows:T[],size=100)=>Array.from({length:Math.ceil(rows.length/size)},(_,index)=>rows.slice(index*size,(index+1)*size));

async function reconcileInventoryIssues(){
  const now=new Date().toISOString();
  const [differences,dismissed]=await Promise.all([
    db("listing_reconciliation?select=id,ebay_quantity,active_sku_count,difference&difference=neq.0"),
    dbAll("reconciliation_issues?select=listing_id,issue_type&status=eq.ignored"),
  ]);
  const dismissedKeys=new Set((dismissed||[]).map((row:any)=>`${row.listing_id}|${row.issue_type}`));

  // reconciliation_issues is a display/work queue. Rebuild its open inventory
  // rows from the current Supabase reconciliation view so completed combine and
  // missing-SKU repairs disappear instead of leaving stale exceptions behind.
  await db("reconciliation_issues?status=eq.open",{method:"PATCH",body:JSON.stringify({status:"resolved",last_seen_at:now})});
  const issues=(differences||[]).map((row:any)=>({
    listing_id:row.id,
    issue_type:Number(row.difference)>0?"missing_sku":"extra_sku",
    ebay_quantity:Number(row.ebay_quantity),
    active_sku_count:Number(row.active_sku_count),
    status:"open",
    last_seen_at:now,
    details:{difference:Number(row.difference)},
  })).filter((row:any)=>!dismissedKeys.has(`${row.listing_id}|${row.issue_type}`));
  for(const group of chunks(issues)){
    await db("reconciliation_issues?on_conflict=listing_id,issue_type",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(group)});
  }
}

export async function GET() {
  try {
    await reconcileInventoryIssues();
    const [issues, orders, unmapped, failedEvents, secrets, latest] = await Promise.all([
      dbAll("reconciliation_issues?select=id,issue_type,ebay_quantity,active_sku_count,details,last_seen_at,marketplace_listings(title,ebay_listing_id)&status=eq.open&order=last_seen_at.desc"),
      dbAll("marketplace_orders?select=id,marketplace,marketplace_order_id,order_title,pull_sku,pull_location,ordered_at&fulfillment_status=in.(unfulfilled,processing)&refunded=eq.false&order=ordered_at.desc"),
      dbAll("marketplace_listings?select=id,ebay_listing_id,title,manapool_mapping_status&game=eq.magic&ebay_status=eq.active&scryfall_id=is.null&order=updated_at.desc"),
      dbAll("sync_events?select=id,source,event_type,error_message,received_at,processed_at&status=eq.failed&order=received_at.desc"),
      db("app_secrets?select=key,value,updated_at&key=in.(last_ebay_webhook_at,last_ebay_webhook_event,last_ebay_webhook_result,last_manapool_webhook_at,last_manapool_webhook_event,last_manapool_webhook_result)&limit=20"),
      db("marketplace_listings?select=last_ebay_sync_at&order=last_ebay_sync_at.desc&limit=1"),
    ]);
    const secret = Object.fromEntries((secrets || []).map((row: any) => [row.key, row.value]));
    const missingPull = (orders || []).filter((row: any) => !String(row.pull_sku || "").trim() || !String(row.pull_location || "").trim());
    const items = [
      ...(issues || []).map((row: any) => ({
        id: `inventory-${row.id}`, category: "Inventory", severity: "warning",
        title: row.marketplace_listings?.title || "Inventory quantity mismatch",
        detail: `eBay quantity ${row.ebay_quantity}; stored locations ${row.active_sku_count}.`,
        occurredAt: safeDate(row.last_seen_at),
        action: Number(row.ebay_quantity) - Number(row.active_sku_count) === 1 ? "add-missing-sku" : "full-sync",
        actionLabel: Number(row.ebay_quantity) - Number(row.active_sku_count) === 1 ? "Add missing SKU" : "Refresh from eBay",
        issueId: row.id,
        ebayListingId: row.marketplace_listings?.ebay_listing_id,
        ebayQuantity: Number(row.ebay_quantity),
        activeSkuCount: Number(row.active_sku_count),
      })),
      ...missingPull.map((row: any) => ({
        id: `order-${row.id}`, category: "Order", severity: "error",
        title: row.order_title || `${row.marketplace} order ${row.marketplace_order_id}`,
        detail: `Order ${row.marketplace_order_id} does not have a physical pull location.`,
        occurredAt: safeDate(row.ordered_at), action: row.marketplace === "manapool" ? "manapool-orders" : "ebay-orders", actionLabel: "Retry order import",
      })),
      ...(unmapped || []).map((row: any) => ({
        id: `mapping-${row.id}`, category: "Mana Pool", severity: "warning",
        title: row.title, detail: `Magic card needs mapping (${row.manapool_mapping_status || "pending"}).`,
        occurredAt: null, action: "magic-mapping", actionLabel: "Open Mana Pool",
      })),
      ...(failedEvents || []).map((row: any) => ({
        id: `event-${row.id}`, category: "Sync", severity: "error",
        title: `${row.source} ${row.event_type} failed`, detail: row.error_message || "No error details were recorded.",
        occurredAt: safeDate(row.processed_at || row.received_at), action: null, actionLabel: null,
      })),
    ];
    const ebayResult = String(secret.last_ebay_webhook_result || "");
    const manaResult = String(secret.last_manapool_webhook_result || "");
    if (/failed/i.test(ebayResult)) items.unshift({ id:"ebay-webhook", category:"eBay webhook", severity:"error", title:"Latest eBay webhook failed", detail:ebayResult, occurredAt:safeDate(secret.last_ebay_webhook_at), action:"ebay-orders", actionLabel:"Retry orders" });
    if (/failed/i.test(manaResult)) items.unshift({ id:"manapool-webhook", category:"Mana Pool webhook", severity:"error", title:"Latest Mana Pool webhook failed", detail:manaResult, occurredAt:safeDate(secret.last_manapool_webhook_at), action:"manapool-orders", actionLabel:"Retry orders" });
    return NextResponse.json({
      ok: true, items, counts: {
        total: items.length,
        errors: items.filter((x: any) => x.severity === "error").length,
        inventory: issues.length, missingPull: missingPull.length, unmapped: unmapped.length,
      },
      health: {
        lastEbayImport: latest?.[0]?.last_ebay_sync_at || null,
        lastEbayWebhookAt: secret.last_ebay_webhook_at || null,
        lastEbayWebhookEvent: secret.last_ebay_webhook_event || null,
        lastEbayWebhookResult: secret.last_ebay_webhook_result || null,
        lastManaPoolWebhookAt: secret.last_manapool_webhook_at || null,
        lastManaPoolWebhookEvent: secret.last_manapool_webhook_event || null,
        lastManaPoolWebhookResult: secret.last_manapool_webhook_result || null,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Exception Center failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action, issueId, sku }: any = await request.json();
    let response: Response;
    if (["end-listing","match-quantity","dismiss-exception"].includes(action)) {
      const rows=await db(`reconciliation_issues?select=id,listing_id,issue_type,status,marketplace_listings(ebay_listing_id,title,ebay_status)&id=eq.${encodeURIComponent(String(issueId||""))}&status=eq.open&limit=1`);
      const issue=rows?.[0];
      if(!issue) return NextResponse.json({error:"This exception is no longer open. Refresh Exception Center."},{status:409});
      const listing=issue.marketplace_listings;
      const ebayId=String(listing?.ebay_listing_id||"");
      const now=new Date().toISOString();
      if(action==="dismiss-exception"){
        await db(`reconciliation_issues?id=eq.${issue.id}`,{method:"PATCH",body:JSON.stringify({status:"ignored",last_seen_at:now})});
        return NextResponse.json({ok:true,message:"Exception removed. No eBay listing or inventory quantity was changed."});
      }
      if(!/^\d+$/.test(ebayId)||listing?.ebay_status!=="active") return NextResponse.json({error:"The linked eBay listing is no longer active."},{status:409});
      const live=(await db(`listing_reconciliation?select=id,ebay_quantity,active_sku_count,difference&id=eq.${issue.listing_id}&limit=1`))?.[0];
      if(!live) return NextResponse.json({error:"Could not verify this listing against Supabase."},{status:409});
      if(action==="end-listing"){
        await endListing(ebayId);
        await db(`marketplace_listings?id=eq.${issue.listing_id}`,{method:"PATCH",body:JSON.stringify({ebay_quantity:0,ebay_status:"inactive",updated_at:now})});
      }else{
        const quantity=Number(live.active_sku_count);
        if(!Number.isInteger(quantity)||quantity<1) return NextResponse.json({error:"There are no available Supabase SKUs. Use End listing instead."},{status:409});
        await reviseListingQuantity(ebayId,quantity);
        await db(`marketplace_listings?id=eq.${issue.listing_id}`,{method:"PATCH",body:JSON.stringify({ebay_quantity:quantity,updated_at:now})});
      }
      await db(`reconciliation_issues?listing_id=eq.${issue.listing_id}&status=eq.open`,{method:"PATCH",body:JSON.stringify({status:"resolved",last_seen_at:now})});
      await db("sync_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({source:"exception-center",event_key:`exception:${action}:${issue.id}:${Date.now()}`,event_type:action,status:"processed",attempts:1,payload:{issue_id:issue.id,listing_id:issue.listing_id,ebay_listing_id:ebayId,previous_ebay_quantity:Number(live.ebay_quantity),active_sku_count:Number(live.active_sku_count)},received_at:now,processed_at:now})});
      return NextResponse.json({ok:true,message:action==="end-listing"?"eBay listing ended and exception resolved.":`eBay quantity changed to ${Number(live.active_sku_count)} and exception resolved.`});
    }
    if (action === "add-missing-sku") {
      const cleanSku = String(sku || "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{2,79}$/.test(cleanSku))
        return NextResponse.json({ error: "Enter a valid physical SKU location" }, { status: 400 });
      const rows = await db(`reconciliation_issues?select=id,listing_id,ebay_quantity,active_sku_count,status&id=eq.${encodeURIComponent(String(issueId || ""))}&status=eq.open&limit=1`);
      const issue = rows?.[0];
      if (!issue || Number(issue.ebay_quantity) - Number(issue.active_sku_count) !== 1)
        return NextResponse.json({ error: "This issue is no longer missing exactly one SKU. Refresh Exception Center." }, { status: 409 });
      const existing = await db(`physical_skus?select=id,listing_id,status&sku=eq.${encodeURIComponent(cleanSku)}&limit=1`);
      if (existing?.length)
        return NextResponse.json({ error: `SKU ${cleanSku} is already stored on another inventory record.` }, { status: 409 });
      await db("physical_skus", { method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify({
        listing_id:issue.listing_id, sku:cleanSku, location_label:cleanSku, status:"available", source:"manual_repair", updated_at:new Date().toISOString(),
      }) });
      await db(`reconciliation_issues?id=eq.${issue.id}`, { method:"PATCH", body:JSON.stringify({status:"resolved",last_seen_at:new Date().toISOString()}) });
      return NextResponse.json({ ok:true, addedSku:cleanSku });
    }
    if (action === "ebay-orders") response = await (await import("@/app/api/orders/import/route")).POST();
    else if (action === "manapool-orders") response = await (await import("@/app/api/manapool/route")).PATCH();
    else if (action === "full-sync") response = await (await import("@/app/api/sync/route")).POST();
    else return NextResponse.json({ error: "Unsupported retry action" }, { status: 400 });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 207) return NextResponse.json({ error: body.error || "Retry failed" }, { status: response.status });
    return NextResponse.json({ ok: true, result: body });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retry failed" }, { status: 500 });
  }
}
