import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { POST as runFullSync } from "@/app/api/sync/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COOLDOWN_MS = 2 * 60 * 1000;
const LOCK_TIMEOUT_MS = 6 * 60 * 1000;

function age(value?: string | null) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? Date.now() - time : Number.POSITIVE_INFINITY;
}

async function save(key: string, value: string) {
  const now = new Date().toISOString();
  await db("app_secrets?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key, value, updated_at: now }),
  });
}

export async function POST() {
  try {
    const rows = await db(
      "app_secrets?select=key,value&key=in.(automatic_sync_started_at,automatic_sync_completed_at)&limit=5",
    );
    const state = Object.fromEntries((rows || []).map((row: any) => [row.key, row.value]));

    if (age(state.automatic_sync_completed_at) < COOLDOWN_MS) {
      return NextResponse.json({ ok: true, skipped: true, reason: "recently_synced" });
    }
    if (age(state.automatic_sync_started_at) < LOCK_TIMEOUT_MS) {
      return NextResponse.json({ ok: true, skipped: true, reason: "sync_in_progress" });
    }

    await save("automatic_sync_started_at", new Date().toISOString());
    const response = await runFullSync();
    const result: any = await response.json();
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error || "Automatic eBay sync failed");
    }

    await save("automatic_sync_completed_at", new Date().toISOString());
    await save("automatic_sync_started_at", "");
    return NextResponse.json({ ...result, automatic: true });
  } catch (error) {
    await save(
      "automatic_sync_last_error",
      error instanceof Error ? error.message.slice(0, 450) : "Automatic eBay sync failed",
    ).catch(() => {});
    await save("automatic_sync_started_at", "").catch(() => {});
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Automatic eBay sync failed" },
      { status: 500 },
    );
  }
}
