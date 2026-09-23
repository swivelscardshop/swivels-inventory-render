import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { fulfillManaPoolOrder } from "@/lib/manapool";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db("marketplace_orders?select=id,marketplace,marketplace_order_id,quantity,ordered_at,fulfillment_status,order_title,pull_sku,pull_location,sku_removed_at,raw_payload,marketplace_listings(title,ebay_sku)&fulfillment_status=eq.unfulfilled&refunded=eq.false&order=ordered_at.desc&limit=100");
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Orders failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body: any = await request.json();
    const id = String(body?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid order" }, { status: 400 });
    const rows = await db(`marketplace_orders?select=id,marketplace,marketplace_order_id,listing_id,fulfillment_status&id=eq.${id}&limit=1`);
    const order = rows?.[0];
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.fulfillment_status !== "unfulfilled") return NextResponse.json({ error: "Order was already completed" }, { status: 409 });

    if (order.marketplace === "manapool") {
      await fulfillManaPoolOrder(String(order.marketplace_order_id), body?.tracking);
    }

    const listingFilter = order.listing_id ? `&listing_id=eq.${order.listing_id}` : "";
    await db(`physical_skus?source_order_id=eq.${encodeURIComponent(String(order.marketplace_order_id))}&status=eq.allocated${listingFilter}`, { method: "DELETE" });
    await db(`marketplace_orders?id=eq.${id}`, {
      method: "PATCH", body: JSON.stringify({ fulfillment_status: "fulfilled", sku_removed_at: new Date().toISOString() }),
    });
    if (order.listing_id) {
      const remaining = await db(`physical_skus?select=id&listing_id=eq.${order.listing_id}&limit=1`);
      if (!remaining?.length) await db(`marketplace_listings?id=eq.${order.listing_id}&ebay_status=eq.inactive`, { method: "DELETE" });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shipment confirmation failed" }, { status: 500 });
  }
}
