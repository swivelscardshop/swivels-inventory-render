import { NextRequest, NextResponse } from "next/server";
import { count, db } from "@/lib/supabase";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize") || 50)));
    const offset = (page - 1) * pageSize;
    const term = encodeURIComponent(q.replace(/[,*()]/g, " ").slice(0, 100));
    const filter = q ? `&or=(title.ilike.*${term}*,ebay_sku.ilike.*${term}*,ebay_listing_id.ilike.*${term}*)` : "";
    const [rows, total] = await Promise.all([
      db(`marketplace_listings?select=id,ebay_listing_id,ebay_sku,title,game,set_name,price,ebay_quantity,physical_skus(sku,location_label,status)&ebay_status=eq.active${filter}&order=title.asc&limit=${pageSize}&offset=${offset}`),
      count("marketplace_listings", `&ebay_status=eq.active${filter}`),
    ]);
    return NextResponse.json({ rows, page, pageSize, total });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Inventory failed" }, { status: 500 });
  }
}
