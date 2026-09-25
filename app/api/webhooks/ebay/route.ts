import { after, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ok:true,service:"Swivels eBay webhook"});
}

export async function POST(request:Request) {
  const raw = await request.text();
  const supported = /<(?:\w+:)?NotificationEventName>(?:FixedPriceTransaction|ItemListed)<\/(?:\w+:)?NotificationEventName>/i.test(raw) ||
    /<(?:\w+:)?(?:FixedPriceTransaction|ItemListed)Notification/i.test(raw);
  if (!supported) return new NextResponse("OK",{status:200,headers:{"Content-Type":"text/plain"}});
  const now=new Date().toISOString();
  await db("app_secrets?on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([{key:"last_ebay_webhook_at",value:now,updated_at:now},{key:"last_ebay_webhook_result",value:"received",updated_at:now}])}).catch(()=>{});
  // The payload is a signal only. Inventory is rebuilt from authenticated eBay
  // APIs, so a forged request cannot supply quantities or listing data.
  after(async()=>{
    try {
      const handler = await import("@/app/api/sync/route");
      const response=await handler.POST();
      if(!response.ok) throw new Error(await response.text());
      const completed=new Date().toISOString();
      await db("app_secrets?on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({key:"last_ebay_webhook_result",value:"sync completed",updated_at:completed})});
    }
    catch (error) {
      console.error("eBay webhook processing failed",error);
      const failed=new Date().toISOString();
      await db("app_secrets?on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({key:"last_ebay_webhook_result",value:`failed: ${error instanceof Error?error.message:"unknown error"}`.slice(0,450),updated_at:failed})}).catch(()=>{});
    }
  });
  return new NextResponse("OK",{status:200,headers:{"Content-Type":"text/plain"}});
}
