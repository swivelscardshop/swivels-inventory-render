import { NextResponse } from "next/server";
import { configureEbayWebhooks } from "@/lib/ebay";
import { listManaPoolWebhooks, registerManaPoolWebhook } from "@/lib/manapool";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function baseUrl(request:Request) {
  return String(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || new URL(request.url).origin).replace(/\/$/,"");
}

export async function GET() {
  try {
    const [mana,stored] = await Promise.all([
      listManaPoolWebhooks(),
      db("app_secrets?select=value,updated_at&key=eq.webhook_base_url&limit=1"),
    ]);
    return NextResponse.json({configured:Boolean(stored?.[0]),baseUrl:stored?.[0]?.value||null,manaPool:mana?.webhooks||[]});
  } catch (error) { return NextResponse.json({error:error instanceof Error?error.message:"Webhook status failed"},{status:500}); }
}

export async function POST(request:Request) {
  try {
    const base = baseUrl(request);
    if (!/^https:\/\//i.test(base)) throw new Error("APP_BASE_URL must be your public HTTPS Render URL");
    const ebayUrl=`${base}/api/webhooks/ebay`;
    const manaUrl=`${base}/api/webhooks/manapool`;
    await configureEbayWebhooks(ebayUrl);
    const mana = await registerManaPoolWebhook(manaUrl);
    if (!mana?.secret) throw new Error("Mana Pool did not return a webhook signing secret");
    await db("app_secrets?on_conflict=key",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([
      {key:"manapool_webhook_secret",value:String(mana.secret),updated_at:new Date().toISOString()},
      {key:"webhook_base_url",value:base,updated_at:new Date().toISOString()},
    ])});
    return NextResponse.json({ok:true,baseUrl:base,ebayUrl,manaUrl});
  } catch (error) { return NextResponse.json({error:error instanceof Error?error.message:"Webhook setup failed"},{status:500}); }
}

