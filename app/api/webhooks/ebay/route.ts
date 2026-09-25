import { after, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ok:true,service:"Swivels eBay webhook"});
}

function eventName(raw:string) {
  try {
    const parsed:any = new XMLParser({ignoreAttributes:false,removeNSPrefix:true}).parse(raw);
    const visit=(value:any):string=>{
      if (!value || typeof value!=="object") return "";
      if (value.NotificationEventName) return String(value.NotificationEventName?.["#text"] ?? value.NotificationEventName);
      for (const child of Object.values(value)) {
        const found=visit(child);
        if(found)return found;
      }
      return "";
    };
    return visit(parsed);
  } catch { return ""; }
}

async function saveResult(event:string,result:string) {
  const now=new Date().toISOString();
  await db("app_secrets?on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([
    {key:"last_ebay_webhook_at",value:now,updated_at:now},
    {key:"last_ebay_webhook_event",value:event||"unknown",updated_at:now},
    {key:"last_ebay_webhook_result",value:result.slice(0,450),updated_at:now},
  ])}).catch(()=>{});
}

export async function POST(request:Request) {
  const raw = await request.text();
  const event=eventName(raw) || (/FixedPriceTransaction/i.test(raw)?"FixedPriceTransaction":/ItemListed/i.test(raw)?"ItemListed":"unknown");
  if (!new Set(["FixedPriceTransaction","ItemListed"]).has(event)) {
    await saveResult(event,"ignored unsupported event");
    return new NextResponse("OK",{status:200,headers:{"Content-Type":"text/plain"}});
  }
  await saveResult(event,"received; processing");
  // The payload is a signal only. Inventory is rebuilt from authenticated eBay
  // APIs, so a forged request cannot supply quantities or listing data.
  after(async()=>{
    try {
      // A sale only needs the lightweight order importer. A newly-created
      // listing needs the catalog import so it can be mapped and published.
      const handler = event==="FixedPriceTransaction"
        ? await import("@/app/api/orders/import/route")
        : await import("@/app/api/sync/route");
      let body:any={};
      const attempts=event==="FixedPriceTransaction"?3:1;
      for(let attempt=1;attempt<=attempts;attempt+=1){
        const response=await handler.POST();
        if(!response.ok) throw new Error(await response.text());
        body=await response.json().catch(()=>({}));
        if(event!=="FixedPriceTransaction" || Number(body.imported||0)>0 || attempt===attempts)break;
        // eBay occasionally sends the notification just before the order is
        // visible through Fulfillment. Retry only this event, never on a timer.
        await new Promise(resolve=>setTimeout(resolve,attempt*5000));
      }
      await saveResult(event,event==="FixedPriceTransaction"
        ? `order import completed: ${Number(body.imported||0)} new, ${Number(body.updated||0)} refreshed`
        : "listing import completed");
    }
    catch (error) {
      console.error("eBay webhook processing failed",error);
      await saveResult(event,`failed: ${error instanceof Error?error.message:"unknown error"}`);
    }
  });
  return new NextResponse("OK",{status:200,headers:{"Content-Type":"text/plain"}});
}
