import { NextResponse } from "next/server";
import { configureEbayWebhooks, getEbayWebhookStatus } from "@/lib/ebay";
import { listManaPoolWebhooks, registerManaPoolWebhook } from "@/lib/manapool";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function baseUrl(request:Request) {
  return String(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || new URL(request.url).origin).replace(/\/$/,"");
}

export async function GET() {
  try {
    const stored=await db("app_secrets?select=key,value,updated_at&key=in.(webhook_base_url,last_ebay_webhook_at,last_ebay_webhook_result)&limit=10");
    const saved=Object.fromEntries((stored||[]).map((x:any)=>[x.key,x]));
    const base=saved.webhook_base_url?.value||null;
    const [mana,ebay] = await Promise.all([
      listManaPoolWebhooks(),
      getEbayWebhookStatus(base?`${base}/api/webhooks/ebay`:undefined),
    ]);
    const manaPool=mana?.webhooks||[];
    const manaPoolLive=manaPool.some((x:any)=>String(x.topic||"")==="order_created");
    return NextResponse.json({configured:Boolean(base&&ebay.live&&manaPoolLive),baseUrl:base,ebay,manaPool,manaPoolLive,lastEbayWebhookAt:saved.last_ebay_webhook_at?.value||null,lastEbayWebhookResult:saved.last_ebay_webhook_result?.value||null});
  } catch (error) { return NextResponse.json({error:error instanceof Error?error.message:"Webhook status failed"},{status:500}); }
}

export async function POST(request:Request) {
  try {
    const base = baseUrl(request);
    if (!/^https:\/\//i.test(base)) throw new Error("APP_BASE_URL must be your public HTTPS Render URL");
    const ebayUrl=`${base}/api/webhooks/ebay`;
    const manaUrl=`${base}/api/webhooks/manapool`;
    const ebay = await configureEbayWebhooks(ebayUrl);
    if(!ebay.live) throw new Error("eBay did not confirm the application URL and seller event subscriptions");
    const mana = await registerManaPoolWebhook(manaUrl);
    if (!mana?.secret) throw new Error("Mana Pool did not return a webhook signing secret");
    await db("app_secrets?on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([
      {key:"manapool_webhook_secret",value:String(mana.secret),updated_at:new Date().toISOString()},
      {key:"webhook_base_url",value:base,updated_at:new Date().toISOString()},
    ])});
    return NextResponse.json({ok:true,configured:true,baseUrl:base,ebayUrl,manaUrl,ebay,manaPoolLive:true});
  } catch (error) { return NextResponse.json({error:error instanceof Error?error.message:"Webhook setup failed"},{status:500}); }
}
