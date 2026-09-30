import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const dynamic="force-dynamic";

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));
const value=(source:any,...keys:string[])=>{
  for(const key of keys){const found=source?.[key];if(found!==undefined&&found!==null&&String(found).trim())return String(found).trim();}
  return "";
};
const firstObject=(...values:any[])=>values.find((entry)=>entry&&typeof entry==="object"&&!Array.isArray(entry))||{};

function shippingAddress(payload:any){
  const detail=payload?.mana_pool_order||payload||{};
  const order=detail?.order||detail?.data?.order||detail?.data||detail;
  const address=firstObject(
    order?.shipping_address,order?.shippingAddress,order?.ship_to,order?.shipTo,
    order?.shipping?.address,order?.customer?.shipping_address,
    detail?.shipping_address,detail?.shippingAddress,detail?.ship_to,
  );
  const customer=firstObject(order?.customer,order?.buyer,detail?.customer,detail?.buyer);
  const name=value(address,"name","full_name","fullName","recipient","recipient_name")||
    [value(address,"first_name","firstName"),value(address,"last_name","lastName")].filter(Boolean).join(" ")||
    value(customer,"name","full_name","fullName");
  return {
    name,
    company:value(address,"company","company_name","organization"),
    line1:value(address,"address1","address_1","line1","line_1","street","street1","street_address"),
    line2:value(address,"address2","address_2","line2","line_2","street2","apartment","unit"),
    city:value(address,"city","locality"),
    state:value(address,"state","state_code","province","region"),
    postal:value(address,"postal_code","postalCode","zip","zip_code"),
    country:value(address,"country_code","countryCode","country")||"US",
  };
}

const returnAddress=()=>({
  name:process.env.STORE_RETURN_NAME||"Swivels Card Shop",
  line1:process.env.STORE_RETURN_ADDRESS1||"",
  line2:process.env.STORE_RETURN_ADDRESS2||"",
  city:process.env.STORE_RETURN_CITY||"",
  state:process.env.STORE_RETURN_STATE||"",
  postal:process.env.STORE_RETURN_POSTAL_CODE||"",
  country:process.env.STORE_RETURN_COUNTRY||"US",
});
const cityLine=(address:any)=>[address.city,[address.state,address.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const addressHtml=(address:any)=>[address.name,address.company,address.line1,address.line2,cityLine(address),address.country&&address.country!=="US"?address.country:""].filter(Boolean).map((line)=>`<div>${esc(line)}</div>`).join("");

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const orderId=String(url.searchParams.get("orderId")||"").trim();
    const type=url.searchParams.get("type")==="label"?"label":"packing";
    if(!orderId||orderId.length>120)return NextResponse.json({error:"Invalid Mana Pool order"},{status:400});
    const rows=await db(`marketplace_orders?select=id,marketplace_order_id,quantity,ordered_at,order_title,pull_sku,pull_location,raw_payload&marketplace=eq.manapool&marketplace_order_id=eq.${encodeURIComponent(orderId)}&order=ordered_at.asc`);
    if(!rows?.length)return NextResponse.json({error:"Mana Pool order not found"},{status:404});
    const payload=rows[0].raw_payload||{};
    const shipTo=shippingAddress(payload);
    if(!shipTo.name||!shipTo.line1||!shipTo.city||!shipTo.state||!shipTo.postal)
      return NextResponse.json({error:"The Mana Pool order does not contain a complete customer shipping address."},{status:422});
    const sender=returnAddress();
    if(type==="label"&&(!sender.line1||!sender.city||!sender.state||!sender.postal))
      return NextResponse.json({error:"Add STORE_RETURN_ADDRESS1, STORE_RETURN_CITY, STORE_RETURN_STATE, and STORE_RETURN_POSTAL_CODE in Render."},{status:422});
    const orderDetail=payload?.mana_pool_order?.order||payload?.mana_pool_order||{};
    const shippingMethod=value(payload,"shipping_method")||value(orderDetail,"shipping_method","shippingMethod")||"Standard shipping";
    const orderedAt=new Date(rows[0].ordered_at).toLocaleString("en-US",{timeZone:"America/Los_Angeles",dateStyle:"medium",timeStyle:"short"});
    const printScript=`<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script>`;
    if(type==="label"){
      const html=`<!doctype html><html><head><meta charset="utf-8"><title>Mana Pool ${esc(orderId)} shipping label</title><style>@page{size:4in 6in;margin:0}*{box-sizing:border-box}body{margin:0;width:4in;height:6in;font-family:Arial,sans-serif;color:#000}.label{height:100%;padding:.22in;display:flex;flex-direction:column}.return{font-size:10pt;line-height:1.25;border-bottom:1px solid #bbb;padding-bottom:.14in}.ship{margin:auto .08in;font-size:17pt;line-height:1.35}.ship small{display:block;font-size:9pt;letter-spacing:.16em;font-weight:700;margin-bottom:.16in}.order{border-top:1px solid #bbb;padding-top:.12in;font-size:9pt;display:flex;justify-content:space-between}.notice{font-size:7pt;text-align:center;margin-top:.1in;color:#555}@media print{.notice{display:none}}</style></head><body><main class="label"><section class="return"><b>FROM</b>${addressHtml(sender)}</section><section class="ship"><small>SHIP TO</small>${addressHtml(shipTo)}</section><section class="order"><span>Mana Pool #${esc(orderId)}</span><span>${esc(shippingMethod)}</span></section><div class="notice">Address label only — postage is not included</div></main>${printScript}</body></html>`;
      return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
    }
    const itemRows=rows.map((row:any,index:number)=>`<tr><td>${index+1}</td><td><b>${esc(row.order_title||"Card")}</b><small>Pull: ${esc(row.pull_location||row.pull_sku||"No location")}</small></td><td>${esc(row.quantity)}</td></tr>`).join("");
    const totalQty=rows.reduce((sum:number,row:any)=>sum+Number(row.quantity||0),0);
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Mana Pool ${esc(orderId)} packing slip</title><style>@page{size:letter;margin:.5in}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17213b;margin:0}.head{display:flex;justify-content:space-between;border-bottom:3px solid #2354e6;padding-bottom:18px}.head h1{margin:0;font-size:25px}.head p{margin:4px 0 0;color:#59657a}.meta{text-align:right;font-size:12px}.addresses{display:grid;grid-template-columns:1fr 1fr;gap:35px;margin:28px 0}.addresses section{border:1px solid #dce3ef;border-radius:8px;padding:15px;line-height:1.45}.addresses small{display:block;font-weight:700;letter-spacing:.12em;color:#65759b;margin-bottom:8px}table{width:100%;border-collapse:collapse}th{text-align:left;background:#eef4ff;font-size:11px;letter-spacing:.08em;padding:10px}td{padding:12px 10px;border-bottom:1px solid #e3e8f1;vertical-align:top;font-size:12px}td small{display:block;color:#65759b;margin-top:5px}th:last-child,td:last-child{text-align:center;width:70px}.summary{text-align:right;margin-top:18px;font-weight:700}.thanks{text-align:center;margin-top:50px;border-top:1px solid #dce3ef;padding-top:18px;color:#59657a}</style></head><body><header class="head"><div><h1>${esc(sender.name)}</h1><p>Mana Pool packing slip</p></div><div class="meta"><b>Order #${esc(orderId)}</b><div>${esc(orderedAt)}</div><div>${esc(shippingMethod)}</div></div></header><div class="addresses"><section><small>SHIP TO</small>${addressHtml(shipTo)}</section><section><small>RETURN ADDRESS</small>${addressHtml(sender)}</section></div><table><thead><tr><th>#</th><th>ITEM</th><th>QTY</th></tr></thead><tbody>${itemRows}</tbody></table><div class="summary">${rows.length} item${rows.length===1?"":"s"} · ${totalQty} card${totalQty===1?"":"s"}</div><div class="thanks">Thank you for your order from Swivels Card Shop.</div>${printScript}</body></html>`;
    return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not create print document"},{status:500});}
}
