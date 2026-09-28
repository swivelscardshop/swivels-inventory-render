import { NextResponse } from "next/server";
import { db, dbAll } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const safeDate = (value: unknown) => value ? String(value) : null;

export async function GET() {
  try {
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
        occurredAt: safeDate(row.last_seen_at), action: "full-sync", actionLabel: "Refresh from eBay",
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
    const { action }: any = await request.json();
    let response: Response;
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
