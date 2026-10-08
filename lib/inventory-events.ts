import { db } from "@/lib/supabase";

export async function recordInventoryEvents(rows: Array<{
  listing_id?: string | null;
  physical_sku_id?: string | null;
  sku?: string | null;
  event_type: string;
  source: string;
  quantity_delta?: number | null;
  details?: Record<string, unknown>;
}>) {
  if (!rows.length) return;
  await db("inventory_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows.map((row) => ({ ...row, details: row.details || {} }))),
  });
}
