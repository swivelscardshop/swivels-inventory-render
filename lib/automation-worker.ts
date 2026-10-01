import { db } from "@/lib/supabase";
import { getEbayWebhookStatus, configureEbayWebhooks, getActiveListingCount } from "@/lib/ebay";
import { count } from "@/lib/supabase";
import { listManaPoolWebhooks, registerManaPoolWebhook } from "@/lib/manapool";

type WorkerState = { started: boolean; queueBusy: boolean; recoveryBusy: boolean; verifyBusy: boolean; reconciliationBusy: boolean; catalogBusy: boolean };

const globalWorker = globalThis as typeof globalThis & { __swivelsWorker?: WorkerState };

async function save(values: Record<string, string>) {
  const now = new Date().toISOString();
  await db("app_secrets?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(Object.entries(values).map(([key, value]) => ({ key, value: String(value).slice(0, 1000), updated_at: now }))),
  });
}

async function responseBody(response: Response) {
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) throw new Error(body.error || `Automation request failed (${response.status})`);
  return body;
}

async function processEvent(event: any) {
  let response: Response;
  if (event.source === "manapool-webhook" || event.event_type === "order_created") response = await (await import("@/app/api/manapool/route")).PATCH();
  else if (event.event_type === "ItemListed") response = await (await import("@/app/api/sync/route")).POST();
  else response = await (await import("@/app/api/orders/import/route")).POST();
  return responseBody(response);
}

async function queueTick(state: WorkerState) {
  if (state.queueBusy) return;
  state.queueBusy = true;
  try {
    const claimed = await db("rpc/claim_sync_events", { method: "POST", body: JSON.stringify({ batch_limit: 10 }) });
    for (const event of claimed || []) {
      try {
        await processEvent(event);
        await db(`sync_events?id=eq.${event.id}`, { method: "PATCH", body: JSON.stringify({ status: "processed", error_message: null, processed_at: new Date().toISOString() }) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Background event processing failed";
        await db(`sync_events?id=eq.${event.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_message: message.slice(0, 1000), processed_at: new Date().toISOString() }) }).catch(() => {});
      }
    }
    await save({ automation_worker_heartbeat: new Date().toISOString(), automation_worker_status: "running", automation_worker_error: "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue worker failed";
    await save({ automation_worker_heartbeat: new Date().toISOString(), automation_worker_status: "degraded", automation_worker_error: message }).catch(() => {});
  } finally { state.queueBusy = false; }
}

async function recoveryTick(state: WorkerState) {
  if (state.recoveryBusy) return;
  state.recoveryBusy = true;
  const started = new Date().toISOString();
  try {
    const ebay = await responseBody(await (await import("@/app/api/orders/import/route")).POST());
    const mana = await responseBody(await (await import("@/app/api/manapool/route")).PATCH());
    await save({ automation_last_recovery_at: started, automation_last_recovery_result: `ok: eBay ${Number(ebay.imported || 0)} new/${Number(ebay.updated || 0)} refreshed; Mana Pool ${Number(mana.lines || 0)} line(s)` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automatic order recovery failed";
    await save({ automation_last_recovery_at: started, automation_last_recovery_result: `failed: ${message}` }).catch(() => {});
  } finally { state.recoveryBusy = false; }
}

async function verifyTick(state: WorkerState) {
  if (state.verifyBusy) return;
  state.verifyBusy = true;
  const verifiedAt = new Date().toISOString();
  try {
    const stored = await db("app_secrets?select=key,value&key=in.(webhook_base_url,manapool_webhook_secret)&limit=10");
    const values = Object.fromEntries((stored || []).map((row: any) => [row.key, row.value]));
    const base = String(values.webhook_base_url || process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
    if (!/^https:\/\//i.test(base)) throw new Error("APP_BASE_URL/webhook_base_url is not configured");
    let ebay = await getEbayWebhookStatus(`${base}/api/webhooks/ebay`);
    if (!ebay.live) ebay = await configureEbayWebhooks(`${base}/api/webhooks/ebay`);
    const mana = await listManaPoolWebhooks();
    let manaLive = (mana?.webhooks || []).some((row: any) => String(row.topic || "") === "order_created");
    const secrets: Record<string, string> = {};
    if (!manaLive) {
      const registered = await registerManaPoolWebhook(`${base}/api/webhooks/manapool`);
      if (!registered?.secret) throw new Error("Mana Pool webhook repair did not return a signing secret");
      secrets.manapool_webhook_secret = String(registered.secret);
      manaLive = true;
    }
    await save({ ...secrets, webhook_base_url: base, automation_webhook_verified_at: verifiedAt, automation_ebay_webhook_live: String(Boolean(ebay.live)), automation_manapool_webhook_live: String(manaLive), automation_webhook_error: "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook verification failed";
    await save({ automation_webhook_verified_at: verifiedAt, automation_webhook_error: message }).catch(() => {});
  } finally { state.verifyBusy = false; }
}

async function reconciliationTick(state: WorkerState) {
  if (state.reconciliationBusy) return;
  state.reconciliationBusy = true;
  const started = new Date().toISOString();
  try {
    const response = await (await import("@/app/api/exceptions/route")).GET();
    const result = await responseBody(response);
    await save({ automation_last_reconciliation_at: started, automation_last_reconciliation_result: `ok: ${Number(result.counts?.total || 0)} item(s) need review` });
  } catch (error) {
    await save({ automation_last_reconciliation_at: started, automation_last_reconciliation_result: `failed: ${error instanceof Error ? error.message : "Reconciliation failed"}` }).catch(() => {});
  } finally { state.reconciliationBusy = false; }
}

async function catalogTick(state: WorkerState) {
  if (state.catalogBusy || state.queueBusy) return;
  state.catalogBusy = true;
  const checkedAt = new Date().toISOString();
  try {
    const [ebayCount, storedCount] = await Promise.all([
      getActiveListingCount(),
      count("marketplace_listings", "&ebay_status=eq.active"),
    ]);
    const saved=await db("app_secrets?select=value&key=eq.automation_last_full_catalog_at&limit=1");
    const lastFull=saved?.[0]?.value?new Date(saved[0].value).getTime():0;
    const fullDue=Date.now()-lastFull>10*60_000;
    let result = `counts agree: ${ebayCount}`;
    if (ebayCount !== storedCount || fullDue) {
      const response = await (await import("@/app/api/sync/route")).POST();
      const synced = await responseBody(response);
      result = ebayCount !== storedCount
        ? `drift repaired: eBay ${ebayCount}, stored ${storedCount}, imported ${Number(synced.listings || 0)}`
        : `scheduled catalog verification: ${Number(synced.listings || ebayCount)} active`;
      await save({automation_last_full_catalog_at:checkedAt});
    }
    await save({ automation_last_catalog_at: checkedAt, automation_last_catalog_result: result });
  } catch (error) {
    await save({ automation_last_catalog_at: checkedAt, automation_last_catalog_result: `failed: ${error instanceof Error ? error.message : "Catalog check failed"}` }).catch(() => {});
  } finally { state.catalogBusy = false; }
}

export function startAutomationWorker() {
  if (globalWorker.__swivelsWorker?.started) return;
  const state: WorkerState = { started: true, queueBusy: false, recoveryBusy: false, verifyBusy: false, reconciliationBusy: false, catalogBusy: false };
  globalWorker.__swivelsWorker = state;
  setTimeout(() => queueTick(state), 5_000).unref();
  setTimeout(() => recoveryTick(state), 12_000).unref();
  setTimeout(() => verifyTick(state), 20_000).unref();
  setTimeout(() => reconciliationTick(state), 40_000).unref();
  setTimeout(() => catalogTick(state), 30_000).unref();
  setInterval(() => queueTick(state), 15_000).unref();
  setInterval(() => recoveryTick(state), 2 * 60_000).unref();
  setInterval(() => verifyTick(state), 30 * 60_000).unref();
  setInterval(() => reconciliationTick(state), 15 * 60_000).unref();
  setInterval(() => catalogTick(state), 2 * 60_000).unref();
}
