import { after, NextResponse } from "next/server";

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
  // The payload is a signal only. Inventory is rebuilt from authenticated eBay
  // APIs, so a forged request cannot supply quantities or listing data.
  after(async()=>{
    try { const handler = await import("@/app/api/sync/route"); await handler.POST(); }
    catch (error) { console.error("eBay webhook processing failed",error); }
  });
  return new NextResponse("OK",{status:200,headers:{"Content-Type":"text/plain"}});
}

