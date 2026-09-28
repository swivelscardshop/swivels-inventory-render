import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { fulfillManaPoolOrder } from "@/lib/manapool";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db("marketplace_orders?select=id,marketplace,marketplace_order_id,quantity,ordered_at,fulfillment_status,order_title,pull_sku,pull_location,sku_removed_at,raw_payload,marketplace_listings(title,ebay_sku,image_url)&fulfillment_status=eq.unfulfilled&refunded=eq.false&order=ordered_at.desc&limit=100");
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Orders failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body: any = await request.json();
    const marketplace = String(body?.marketplace || "");
    const marketplaceOrderId = String(body?.marketplaceOrderId || "");
    if (!["ebay", "manapool"].includes(marketplace) || !marketplaceOrderId || marketplaceOrderId.length > 120)
      return NextResponse.json({ error: "Invalid order" }, { status: 400 });
    const rows = await db(`marketplace_orders?select=id,marketplace,marketplace_order_id,listing_id,fulfillment_status&marketplace=eq.${marketplace}&marketplace_order_id=eq.${encodeURIComponent(marketplaceOrderId)}&fulfillment_status=eq.unfulfilled`);
    if (!rows?.length) return NextResponse.json({ error: "Order not found or already completed" }, { status: 404 });

    if (marketplace === "manapool") {
      await fulfillManaPoolOrder(marketplaceOrderId, body?.tracking);
    }

    for (const line of rows) {
      const listingFilter = line.listing_id ? `&listing_id=eq.${line.listing_id}` : "";
      await db(`physical_skus?source_order_id=eq.${encodeURIComponent(marketplaceOrderId)}&status=eq.allocated${listingFilter}`, { method: "DELETE" });
    }
    await db(`marketplace_orders?marketplace=eq.${marketplace}&marketplace_order_id=eq.${encodeURIComponent(marketplaceOrderId)}&fulfillment_status=eq.unfulfilled`, {
      method: "PATCH", body: JSON.stringify({ fulfillment_status: "fulfilled", sku_removed_at: new Date().toISOString() }),
    });
    for (const listingId of [...new Set(rows.map((line:any)=>line.listing_id).filter(Boolean))]) {
      const remaining = await db(`physical_skus?select=id&listing_id=eq.${listingId}&limit=1`);
      if (!remaining?.length) await db(`marketplace_listings?id=eq.${listingId}&ebay_status=eq.inactive`, { method: "DELETE" });
    }
    return NextResponse.json({ ok: true, lines: rows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shipment confirmation failed" }, { status: 500 });
  }
}
