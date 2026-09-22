import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const filter = q ? `&or=(title.ilike.*${encodeURIComponent(q)}*,ebay_sku.ilike.*${encodeURIComponent(q)}*,ebay_listing_id.ilike.*${encodeURIComponent(q)}*)` : "";
    const rows = await db(`marketplace_listings?select=id,ebay_listing_id,ebay_sku,title,game,set_name,price,ebay_quantity,ebay_status,last_ebay_sync_at,physical_skus(sku,location_label,status)&ebay_status=eq.active${filter}&order=title.asc&limit=500`);
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Inventory failed" }, { status: 500 });
  }
}
