import { NextResponse } from "next/server";
import { db, dbAll } from "@/lib/supabase";
import { markRetry } from "@/lib/sync-events";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const secretMap = (rows: any[]) => Object.fromEntries((rows || []).map((row: any) => [row.key, row.value]));
const isFailure = (value: unknown) => /failed|error/i.test(String(value || ""));

async function runEvent(event: any) {
  let response: Response;
  if (event.source === "manapool-webhook" || event.event_type === "order_created") {
    response = await (await import("@/app/api/manapool/route")).PATCH();
  } else if (event.event_type === "ItemListed") {
    response = await (await import("@/app/api/sync/route")).POST();
  } else {
    response = await (await import("@/app/api/orders/import/route")).POST();
  }
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) throw new Error(body.error || "Retry failed");
  return body;
}

export async function GET() {
  try {
    const [events, secrets, openIssues, pendingCount, failedCount, latestImport] = await Promise.all([
      db("sync_events?select=id,source,event_key,event_type,status,attempts,error_message,received_at,processed_at,payload&order=received_at.desc&limit=100"),
      db("app_secrets?select=key,value,updated_at&key=in.(last_ebay_webhook_at,last_ebay_webhook_event,last_ebay_webhook_result,last_manapool_webhook_at,last_manapool_webhook_event,last_manapool_webhook_result,webhook_base_url,manapool_webhook_secret,automation_worker_heartbeat,automation_worker_status,automation_worker_error,automation_last_recovery_at,automation_last_recovery_result,automation_webhook_verified_at,automation_ebay_webhook_live,automation_manapool_webhook_live,automation_webhook_error)&limit=30"),
      dbAll("reconciliation_issues?select=id&status=eq.open"),
      dbAll("sync_events?select=id&status=eq.pending"),
      dbAll("sync_events?select=id&status=eq.failed"),
      db("marketplace_listings?select=last_ebay_sync_at&order=last_ebay_sync_at.desc&limit=1"),
    ]);
    const saved = secretMap(secrets || []);
    const ebayResult = saved.last_ebay_webhook_result || null;
    const manaResult = saved.last_manapool_webhook_result || null;
    const heartbeatAge = saved.automation_worker_heartbeat ? Date.now() - new Date(saved.automation_worker_heartbeat).getTime() : Infinity;
    const workerOnline = heartbeatAge < 90_000;
    return NextResponse.json({
      ok: true,
      summary: {
        pending: pendingCount.length,
        failed: failedCount.length,
        mismatches: openIssues.length,
        lastImportAt: latestImport?.[0]?.last_ebay_sync_at || null,
        workerOnline,
        workerHeartbeat: saved.automation_worker_heartbeat || null,
        workerStatus: saved.automation_worker_status || "not started",
        workerError: saved.automation_worker_error || null,
        lastRecoveryAt: saved.automation_last_recovery_at || null,
        lastRecoveryResult: saved.automation_last_recovery_result || null,
      },
      connections: {
        ebay: { connected: saved.automation_ebay_webhook_live === "true", lastAt: saved.last_ebay_webhook_at || null, event: saved.last_ebay_webhook_event || null, result: ebayResult, healthy: saved.automation_ebay_webhook_live === "true" && !isFailure(ebayResult) },
        manapool: { connected: saved.automation_manapool_webhook_live === "true", lastAt: saved.last_manapool_webhook_at || null, event: saved.last_manapool_webhook_event || null, result: manaResult, healthy: saved.automation_manapool_webhook_live === "true" && !isFailure(manaResult) },
        endpoint: saved.webhook_base_url || null,
        verifiedAt: saved.automation_webhook_verified_at || null,
        verificationError: saved.automation_webhook_error || null,
      },
      events,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load sync health" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action, eventId }: any = await request.json();
    if (action === "reconcile") {
      const response = await (await import("@/app/api/exceptions/route")).GET();
      const body: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Reconciliation failed");
      return NextResponse.json({ ok: true, message: `Reconciliation completed. ${Number(body.counts?.total || 0)} item(s) need review.` });
    }
    if (action === "full-import") {
      const body = await runEvent({ source: "control-center", event_type: "ItemListed" });
      return NextResponse.json({ ok: true, result: body, message: "eBay catalog and orders were refreshed." });
    }
    if (action === "retry-one") {
      const event = await markRetry(String(eventId || ""));
      try {
        const body = await runEvent(event);
        await db(`sync_events?id=eq.${encodeURIComponent(String(event.id))}`, { method: "PATCH", body: JSON.stringify({ status: "processed", error_message: null, processed_at: new Date().toISOString() }) });
        return NextResponse.json({ ok: true, result: body, message: "The failed event was processed successfully." });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Retry failed";
        await db(`sync_events?id=eq.${encodeURIComponent(String(event.id))}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_message: message.slice(0, 1000), processed_at: new Date().toISOString() }) });
        throw error;
      }
    }
    if (action === "retry-all") {
      const failed = await db("sync_events?select=id,source,event_type,attempts&status=eq.failed&order=received_at.asc&limit=50");
      let processed = 0;
      const errors: string[] = [];
      for (const row of failed) {
        try {
          const event = await markRetry(row.id);
          await runEvent(event);
          await db(`sync_events?id=eq.${encodeURIComponent(String(row.id))}`, { method: "PATCH", body: JSON.stringify({ status: "processed", error_message: null, processed_at: new Date().toISOString() }) });
          processed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Retry failed";
          errors.push(message);
          await db(`sync_events?id=eq.${encodeURIComponent(String(row.id))}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error_message: message.slice(0, 1000), processed_at: new Date().toISOString() }) });
        }
      }
      return NextResponse.json({ ok: errors.length === 0, processed, failed: errors.length, message: `${processed} event(s) recovered; ${errors.length} still failed.` }, { status: errors.length ? 207 : 200 });
    }
    return NextResponse.json({ error: "Unsupported Sync Control action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync Control action failed" }, { status: 500 });
  }
}
