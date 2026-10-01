import { db } from "@/lib/supabase";
import { getEbayWebhookStatus, configureEbayWebhooks } from "@/lib/ebay";
import { listManaPoolWebhooks, registerManaPoolWebhook } from "@/lib/manapool";

type WorkerState = { started: boolean; queueBusy: boolean; recoveryBusy: boolean; verifyBusy: boolean };

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
    const response = await (await import("@/app/api/orders/import/route")).POST();
    const body = await responseBody(response);
    await save({ automation_last_recovery_at: started, automation_last_recovery_result: `ok: ${Number(body.imported || 0)} imported, ${Number(body.updated || 0)} refreshed` });
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

export function startAutomationWorker() {
  if (globalWorker.__swivelsWorker?.started) return;
  const state: WorkerState = { started: true, queueBusy: false, recoveryBusy: false, verifyBusy: false };
  globalWorker.__swivelsWorker = state;
  setTimeout(() => queueTick(state), 5_000).unref();
  setTimeout(() => recoveryTick(state), 12_000).unref();
  setTimeout(() => verifyTick(state), 20_000).unref();
  setInterval(() => queueTick(state), 15_000).unref();
  setInterval(() => recoveryTick(state), 2 * 60_000).unref();
  setInterval(() => verifyTick(state), 30 * 60_000).unref();
}
