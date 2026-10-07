import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { beginSyncEvent, finishSyncEvent, webhookEventKey } from "@/lib/sync-events";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ok:true,service:"Swivels Mana Pool webhook"});
}

async function saveResult(event:string,result:string) {
  const now=new Date().toISOString();
  await db("app_secrets?on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([
    {key:"last_manapool_webhook_at",value:now,updated_at:now},
    {key:"last_manapool_webhook_event",value:event||"unknown",updated_at:now},
    {key:"last_manapool_webhook_result",value:result.slice(0,450),updated_at:now},
  ])}).catch(()=>{});
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
  const eventKey=webhookEventKey("manapool-webhook",event,raw);
  await beginSyncEvent({source:"manapool-webhook",eventKey,eventType:event,payload:{bytes:raw.length}}).catch(()=>{});
  await saveResult(event,"received; processing");
  after(async()=>{
    try {
      const handler = await import("@/app/api/manapool/route");
      const response=await handler.PATCH();
      const body:any=await response.json().catch(()=>({}));
      if(!response.ok && response.status!==207) throw new Error(body.error||"Mana Pool order import failed");
      await saveResult(event,body.errors?.length?`failed: ${body.errors.join("; ").slice(0,400)}`:`order import completed: ${Number(body.lines||0)} line(s)`);
      if(body.errors?.length) await finishSyncEvent(eventKey,"failed",body.errors.join("; ")).catch(()=>{});
      else await finishSyncEvent(eventKey,"processed").catch(()=>{});
    }
    catch (error) {
      console.error("Mana Pool webhook processing failed",error);
      const message=error instanceof Error?error.message:"unknown error";
      await saveResult(event,`failed: ${message}`);
      await finishSyncEvent(eventKey,"failed",message).catch(()=>{});
    }
  });
  return NextResponse.json({received:true});
}
