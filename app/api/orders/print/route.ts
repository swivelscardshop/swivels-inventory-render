import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const dynamic="force-dynamic";

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));
const value=(source:any,...keys:string[])=>{
  for(const key of keys){const found=source?.[key];if(found!==undefined&&found!==null&&String(found).trim())return String(found).trim();}
  return "";
};
const firstObject=(...values:any[])=>values.find((entry)=>entry&&typeof entry==="object"&&!Array.isArray(entry))||{};
const firstNumber=(...values:any[])=>{
  const found=values.find((entry)=>entry!==undefined&&entry!==null&&entry!==""&&Number.isFinite(Number(entry)));
  return found===undefined?null:Number(found);
};
const centsText=(amount:number|null)=>amount===null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(amount/100);
const label=(code:string,kind:"condition"|"finish")=>{
  const labels:any=kind==="condition"
    ? {NM:"Near Mint",LP:"Lightly Played",MP:"Moderately Played",HP:"Heavily Played",DMG:"Damaged"}
    : {NF:"Non-Foil",FO:"Foil",EF:"Etched Foil"};
  return labels[String(code||"").toUpperCase()]||code||"—";
};

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
    const rows=await db(`marketplace_orders?select=id,marketplace_order_id,quantity,ordered_at,order_title,pull_sku,pull_location,raw_payload,marketplace_listings(card_name,card_number,set_name,finish,condition_name,language_id,finish_id,condition_id)&marketplace=eq.manapool&marketplace_order_id=eq.${encodeURIComponent(orderId)}&order=ordered_at.asc`);
    if(!rows?.length)return NextResponse.json({error:"Mana Pool order not found"},{status:404});
    const payload=rows[0].raw_payload||{};
    const shipTo=shippingAddress(payload);
    if(!shipTo.name||!shipTo.line1||!shipTo.city||!shipTo.state||!shipTo.postal)
      return NextResponse.json({error:"The Mana Pool order does not contain a complete customer shipping address."},{status:422});
    const sender=returnAddress();
    if(type==="label"&&(!sender.line1||!sender.city||!sender.state||!sender.postal))
      return NextResponse.json({error:"Add STORE_RETURN_ADDRESS1, STORE_RETURN_CITY, STORE_RETURN_STATE, and STORE_RETURN_POSTAL_CODE in Render."},{status:422});
    const manaPoolDetail=payload?.mana_pool_order||{};
    const orderDetail=manaPoolDetail?.order||manaPoolDetail?.data?.order||manaPoolDetail?.data||manaPoolDetail;
    const shippingMethod=value(payload,"shipping_method")||value(orderDetail,"shipping_method","shippingMethod")||"Standard shipping";
    const orderedAt=new Date(rows[0].ordered_at).toLocaleString("en-US",{timeZone:"America/Los_Angeles",dateStyle:"medium",timeStyle:"short"});
    const printScript=`<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));</script>`;
    if(type==="label"){
      const html=`<!doctype html><html><head><meta charset="utf-8"><title>Mana Pool ${esc(orderId)} shipping label</title><style>@page{size:4in 6in;margin:0}*{box-sizing:border-box}body{margin:0;width:4in;height:6in;font-family:Arial,sans-serif;color:#000}.label{height:100%;padding:.22in;display:flex;flex-direction:column}.return{font-size:10pt;line-height:1.25;border-bottom:1px solid #bbb;padding-bottom:.14in}.ship{margin:auto .08in;font-size:17pt;line-height:1.35}.ship small{display:block;font-size:9pt;letter-spacing:.16em;font-weight:700;margin-bottom:.16in}.order{border-top:1px solid #bbb;padding-top:.12in;font-size:9pt;display:flex;justify-content:space-between}.notice{font-size:7pt;text-align:center;margin-top:.1in;color:#555}@media print{.notice{display:none}}</style></head><body><main class="label"><section class="return"><b>FROM</b>${addressHtml(sender)}</section><section class="ship"><small>SHIP TO</small>${addressHtml(shipTo)}</section><section class="order"><span>Mana Pool #${esc(orderId)}</span><span>${esc(shippingMethod)}</span></section><div class="notice">Address label only — postage is not included</div></main>${printScript}</body></html>`;
      return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
    }
    const detailItems=Array.isArray(orderDetail?.items)?orderDetail.items:Array.isArray(manaPoolDetail?.items)?manaPoolDetail.items:[];
    const itemRows=rows.map((row:any,index:number)=>{
      const item=detailItems[index]||{};
      const product=item?.product||{};
      const single=product?.single||item?.single||{};
      const listing=row.marketplace_listings||{};
      const quantity=Math.max(1,Number(row.quantity||item.quantity||1));
      const unitCents=firstNumber(item.unit_price_cents,item.price_cents,item.price?.cents,item.price?.amount_cents,product.price_cents,single.price_cents);
      const lineCents=firstNumber(item.total_cents,item.line_total_cents,item.subtotal_cents);
      const displayedPrice=unitCents!==null?unitCents:(lineCents!==null?lineCents/quantity:null);
      const set=value(item,"set_code","set_id")||value(single,"set_code","set_id")||value(single?.set,"code","id")||value(product,"set_code")||value(listing,"set_name")||"—";
      const condition=value(item,"condition_name","condition")||value(single,"condition_name")||label(value(item,"condition_id")||value(single,"condition_id")||value(listing,"condition_id"),"condition")||value(listing,"condition_name")||"—";
      const finish=value(item,"finish_name","finish")||value(single,"finish_name","finish")||label(value(item,"finish_id")||value(single,"finish_id")||value(listing,"finish_id"),"finish")||value(listing,"finish")||"—";
      const language=value(item,"language_id","language")||value(single,"language_id","language")||value(listing,"language_id")||"EN";
      const number=value(item,"collector_number","card_number","number")||value(single,"collector_number","card_number","number")||value(listing,"card_number")||"—";
      return `<tr><td>${esc(quantity)}</td><td><b>${esc(value(item,"name")||value(single,"name")||row.order_title||listing.card_name||"Card")}</b><small>Pull: ${esc(row.pull_location||row.pull_sku||"No location")}</small></td><td>${esc(set)}</td><td>${esc(condition)}</td><td>${esc(finish)}</td><td>${esc(language)}</td><td>${esc(number)}</td><td>${esc(centsText(displayedPrice))}</td></tr>`;
    }).join("");
    const totalQty=rows.reduce((sum:number,row:any)=>sum+Number(row.quantity||0),0);
    const shippingCents=firstNumber(orderDetail.shipping_cents,orderDetail.shipping_price_cents,orderDetail.shipping_amount_cents,orderDetail.shipping?.price_cents,orderDetail.shipping?.amount_cents,manaPoolDetail.shipping_cents);
    const subtotalCents=firstNumber(orderDetail.subtotal_cents,orderDetail.items_total_cents,orderDetail.merchandise_total_cents);
    const totalCents=firstNumber(orderDetail.total_cents,orderDetail.order_total_cents,orderDetail.total_amount_cents,orderDetail.total?.cents,orderDetail.total?.amount_cents,manaPoolDetail.total_cents);
    const derivedItemsCents=detailItems.reduce((sum:number,item:any)=>sum+(firstNumber(item.total_cents,item.line_total_cents,item.subtotal_cents)??((firstNumber(item.unit_price_cents,item.price_cents,item.price?.cents)??0)*Math.max(1,Number(item.quantity||1)))),0);
    const shownSubtotal=subtotalCents??(derivedItemsCents||null);
    const shownShipping=shippingCents??(totalCents!==null&&shownSubtotal!==null?Math.max(0,totalCents-shownSubtotal):null);
    const shownTotal=totalCents??(shownSubtotal!==null&&shownShipping!==null?shownSubtotal+shownShipping:null);
    const qrSource=value(orderDetail,"received_qr_url","receive_qr_url","qr_code_url","qr_url")||value(manaPoolDetail,"received_qr_url","receive_qr_url","qr_code_url","qr_url");
    const qrHtml=qrSource?`<img class="qr" src="${esc(qrSource)}" alt="Scan to mark received"><small>Scan to mark received</small>`:"";
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Mana Pool ${esc(orderId)} packing slip</title><style>@page{size:letter;margin:.35in}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#0d1832;margin:0;font-size:11px}.head{display:flex;justify-content:space-between;align-items:flex-start;background:#eee;padding:12px 14px}.brand h1{margin:0;font-size:26px}.brand p{margin:8px 0 0;color:#000}.meta{display:flex;gap:10px;text-align:right;font-size:11px;line-height:1.55}.qr{display:block;width:58px;height:58px;object-fit:contain}.meta small{display:block;font-size:6px;text-align:center}.shipto{min-height:150px;padding:48px 46px 24px;font-size:12px;line-height:1.5;border-bottom:1px dashed #aaa}.fold{text-align:center;color:#aaa;font-size:8px;margin:-5px 0 16px}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;padding:7px 4px;border-bottom:1px solid #ccc}td{padding:6px 4px;vertical-align:top;font-size:10px}td small{display:block;color:#68758b;margin-top:3px}th:first-child,td:first-child{text-align:center;width:42px}th:nth-last-child(2),td:nth-last-child(2){text-align:center}th:last-child,td:last-child{text-align:right}.totals{margin-top:2px}.totals div{display:flex;justify-content:space-between;padding:5px;background:#eee}.totals div:last-child{font-weight:700;background:#ddd}.foot{margin-top:28px;display:flex;justify-content:space-between;color:#59657a}.return{line-height:1.4}</style></head><body><header class="head"><div class="brand"><h1>▣ Mana Pool</h1><p>Purchased from ${esc(sender.name.replace(/\s+/g,""))}</p></div><div class="meta"><div><b>Mana Pool Order #${esc(orderId)}</b><br>Order Date: ${esc(new Date(rows[0].ordered_at).toLocaleDateString("en-US",{timeZone:"America/Los_Angeles"}))}<br>${esc(shippingMethod)}</div><div>${qrHtml}</div></div></header><section class="shipto">${addressHtml(shipTo)}</section><div class="fold">Fold</div><table><thead><tr><th>Qty</th><th>Description</th><th>Set</th><th>Condition</th><th>Finish</th><th>Lang</th><th>Number</th><th>Price</th></tr></thead><tbody>${itemRows}</tbody></table><div class="totals"><div><span>Items</span><b>${esc(centsText(shownSubtotal))}</b></div><div><span>Shipping</span><b>${esc(centsText(shownShipping))}</b></div><div><span>Total (${totalQty} card${totalQty===1?"":"s"})</span><b>${esc(centsText(shownTotal))}</b></div></div><div class="foot"><div>Thank you for your order from ${esc(sender.name)}.</div><div class="return"><b>Return address</b>${addressHtml(sender)}</div></div>${printScript}</body></html>`;
    return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not create print document"},{status:500});}
}
