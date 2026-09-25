import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ok:true,service:"Swivels Mana Pool webhook"});
}

export async function POST(request:Request) {
  const raw = await request.text();
  const timestamp = request.headers.get("x-manapool-timestamp") || "";
  const signature = request.headers.get("x-manapool-signature") || "";
  const event = request.headers.get("x-manapool-event") || "";
  const rows = await db("app_secrets?select=value&key=eq.manapool_webhook_secret&limit=1");
  const secret = rows?.[0]?.value || "";

  // Mana Pool probes the callback URL before registration returns its signing
  // secret. A probe never changes inventory; only a subsequently signed
  // order_created event is allowed to start order processing.
  if (!signature || !timestamp || !secret) {
    let challenge = "";
    try { challenge = String(JSON.parse(raw || "{}").challenge || ""); } catch {}
    return NextResponse.json(challenge ? {challenge} : {received:true,verification:true});
  }

  const supplied = signature.split(",").map((part:string)=>part.trim().split("=")).find((part:string[])=>part[0]==="v1")?.[1] || "";
  const expected = secret && timestamp ? createHmac("sha256",secret).update(`v1:${timestamp}:${raw}`).digest("hex") : "";
  const recent = /^\d+$/.test(timestamp) && Math.abs(Date.now()/1000-Number(timestamp)) <= 300;
  const valid = event==="order_created" && recent && supplied.length===expected.length && supplied.length>0 && timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
  if (!valid) return NextResponse.json({error:"Invalid Mana Pool webhook signature"},{status:401});
  after(async()=>{
    try { const handler = await import("@/app/api/manapool/route"); await handler.PATCH(); }
    catch (error) { console.error("Mana Pool webhook processing failed",error); }
  });
  return NextResponse.json({received:true});
}
