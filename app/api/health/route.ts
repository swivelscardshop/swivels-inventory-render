export const dynamic = "force-dynamic";

export async function GET() {
  let automation: any = null;
  try {
    const { db } = await import("@/lib/supabase");
    const rows = await db("app_secrets?select=key,value&key=in.(automation_worker_heartbeat,automation_worker_status,automation_last_recovery_at)&limit=10");
    const saved = Object.fromEntries((rows || []).map((row: any) => [row.key, row.value]));
    const age = saved.automation_worker_heartbeat ? Date.now() - new Date(saved.automation_worker_heartbeat).getTime() : Infinity;
    automation = { online: age < 90_000, heartbeat: saved.automation_worker_heartbeat || null, status: saved.automation_worker_status || "not started", lastRecoveryAt: saved.automation_last_recovery_at || null };
  } catch {}
  return Response.json(
    {
      ok: true,
      service: "swivels-inventory",
      timestamp: new Date().toISOString(),
      automation,
    },
    { status: 200 },
  );
}
