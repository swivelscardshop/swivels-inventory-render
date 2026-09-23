import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db("marketplace_orders?select=id,marketplace_order_id,quantity,ordered_at,fulfillment_status,marketplace_listings(title,ebay_sku,physical_skus(sku,location_label,status))&fulfillment_status=eq.unfulfilled&refunded=eq.false&order=ordered_at.desc&limit=50");
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Orders failed" }, { status: 500 });
  }
}
