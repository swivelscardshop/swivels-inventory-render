import { createHash } from "node:crypto";
import { db } from "@/lib/supabase";

export type SyncSource = "ebay-webhook" | "manapool-webhook" | "control-center";

export function webhookEventKey(source: SyncSource, eventType: string, payload: string) {
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  return `${source}:${eventType || "unknown"}:${digest}`;
}

export async function beginSyncEvent(input: {
  source: SyncSource;
  eventKey: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  await db("sync_events?on_conflict=event_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      source: input.source,
      event_key: input.eventKey,
      event_type: input.eventType || "unknown",
      status: "pending",
      attempts: 1,
      payload: input.payload || {},
      error_message: null,
      received_at: now,
      processed_at: null,
    }),
  });
}

export async function finishSyncEvent(eventKey: string, status: "processed" | "failed", detail?: string) {
  await db(`sync_events?event_key=eq.${encodeURIComponent(eventKey)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      error_message: status === "failed" ? String(detail || "Unknown processing error").slice(0, 1000) : null,
      processed_at: new Date().toISOString(),
    }),
  });
}

export async function markRetry(eventId: string) {
  const rows = await db(`sync_events?select=id,source,event_type,attempts&id=eq.${encodeURIComponent(eventId)}&limit=1`);
  const event = rows?.[0];
  if (!event) throw new Error("The sync event no longer exists");
  await db(`sync_events?id=eq.${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "pending",
      attempts: Number(event.attempts || 0) + 1,
      error_message: null,
      processed_at: null,
    }),
  });
  return event;
}
