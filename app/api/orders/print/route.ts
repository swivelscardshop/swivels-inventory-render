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
      const html=`<!doctype html><html><head><meta charset="utf-8"><title>Mana Pool ${esc(orderId)} shipping label</title><style>@page{size:6in 4in;margin:0}*{box-sizing:border-box}html,body{margin:0;width:6in;height:4in;background:#fff}body{font-family:Arial,Helvetica,sans-serif;color:#000;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}.label{width:6in;height:4in;padding:.2in .28in;display:flex;flex-direction:column}.return{font-size:9pt;line-height:1.2;border-bottom:2px solid #000;padding-bottom:.11in}.ship{margin:auto .42in;font-size:18pt;line-height:1.28;font-weight:800}@media print{html,body{overflow:hidden}}</style></head><body><main class="label"><section class="return">${addressHtml(sender)}</section><section class="ship">${addressHtml(shipTo)}</section></main>${printScript}</body></html>`;
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
      const displayedLineTotal=lineCents!==null?lineCents:(displayedPrice!==null?displayedPrice*quantity:null);
      return `<tr><td><b>${esc(value(item,"name")||value(single,"name")||row.order_title||listing.card_name||"Card")}</b><small>${esc(set)} · #${esc(number)} · ${esc(condition)} · ${esc(finish)} · ${esc(language)}</small><small class="pull">Pull: ${esc(row.pull_location||row.pull_sku||"No location")}</small></td><td>${esc(quantity)}</td><td>${esc(centsText(displayedPrice))}</td><td>${esc(centsText(displayedLineTotal))}</td></tr>`;
    }).join("");
    const totalQty=rows.reduce((sum:number,row:any)=>sum+Number(row.quantity||0),0);
    const shippingCents=firstNumber(orderDetail.shipping_cents,orderDetail.shipping_price_cents,orderDetail.shipping_amount_cents,orderDetail.shipping?.price_cents,orderDetail.shipping?.amount_cents,manaPoolDetail.shipping_cents);
    const taxCents=firstNumber(orderDetail.tax_cents,orderDetail.sales_tax_cents,orderDetail.tax_amount_cents,orderDetail.tax?.cents,orderDetail.tax?.amount_cents,manaPoolDetail.tax_cents);
    const subtotalCents=firstNumber(orderDetail.subtotal_cents,orderDetail.items_total_cents,orderDetail.merchandise_total_cents);
    const totalCents=firstNumber(orderDetail.total_cents,orderDetail.order_total_cents,orderDetail.total_amount_cents,orderDetail.total?.cents,orderDetail.total?.amount_cents,manaPoolDetail.total_cents);
    const derivedItemsCents=detailItems.reduce((sum:number,item:any)=>sum+(firstNumber(item.total_cents,item.line_total_cents,item.subtotal_cents)??((firstNumber(item.unit_price_cents,item.price_cents,item.price?.cents)??0)*Math.max(1,Number(item.quantity||1)))),0);
    const shownSubtotal=subtotalCents??(derivedItemsCents||null);
    const shownShipping=shippingCents??(totalCents!==null&&shownSubtotal!==null?Math.max(0,totalCents-shownSubtotal):null);
    const shownTax=taxCents??(totalCents!==null&&shownSubtotal!==null&&shownShipping!==null?Math.max(0,totalCents-shownSubtotal-shownShipping):null);
    const shownTotal=totalCents??(shownSubtotal!==null&&shownShipping!==null?shownSubtotal+shownShipping+(shownTax||0):null);
    const qrSource=value(orderDetail,"received_qr_url","receive_qr_url","qr_code_url","qr_url")||value(manaPoolDetail,"received_qr_url","receive_qr_url","qr_code_url","qr_url");
    const qrHtml=qrSource?`<img class="qr" src="${esc(qrSource)}" alt="Scan to mark received"><small>Scan to mark received</small>`:"";
    const orderDate=esc(new Date(rows[0].ordered_at).toLocaleDateString("en-US",{timeZone:"America/Los_Angeles",month:"short",day:"numeric",year:"numeric"}));
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Mana Pool ${esc(orderId)} packing slip</title><style>@page{size:4in 6in;margin:0}*{box-sizing:border-box}html,body{margin:0;width:4in;min-height:6in;background:#fff}body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:9pt;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:4in;min-height:6in;padding:.16in .17in}.head{display:grid;grid-template-columns:1fr 1.3fr auto;align-items:center;gap:.08in;margin-bottom:.16in}.brand{font-size:19pt;font-weight:900;letter-spacing:-1px}.shop{text-align:center;font-size:11pt;font-weight:900}.qrwrap{text-align:center}.qr{display:block;width:.48in;height:.48in;object-fit:contain;margin:auto}.qrwrap small{display:block;font-size:5.5pt;font-weight:700;line-height:1.05}.addresses{display:grid;grid-template-columns:1fr 1fr;border:1.5px solid #000;margin-bottom:.16in}.address{min-height:1.02in;font-size:8.5pt;line-height:1.18;font-weight:700}.address h2{font-size:8.5pt;font-weight:900;margin:0;padding:.05in .05in;border-bottom:1.5px solid #000}.address div{padding:0 .05in}.address h2+div{padding-top:.05in}.address+.address{border-left:1.5px solid #000}.orderline{display:flex;justify-content:space-between;align-items:flex-end;gap:.08in;margin-bottom:.09in;font-size:8.5pt}.orderline b{font-size:9.5pt;font-weight:900}.orderline span{white-space:nowrap}table{width:100%;border-collapse:collapse;border:1.5px solid #000;table-layout:fixed}th{background:#000!important;color:#fff!important;font-size:8pt;font-weight:900;padding:.055in .045in;text-align:left}th:nth-child(1){width:55%}th:nth-child(2){width:11%;text-align:center}th:nth-child(3),th:nth-child(4){width:17%;text-align:right}td{padding:.055in .045in;vertical-align:top;font-size:8pt;font-weight:700;border-bottom:1px solid #000}td:nth-child(2){text-align:center}td:nth-child(3),td:nth-child(4){text-align:right;white-space:nowrap}td b{font-weight:900}td small{display:block;font-size:6.6pt;line-height:1.15;margin-top:2px;color:#000;font-weight:700}.pull{font-weight:900}.summary{width:67%;margin-left:auto;margin-top:.06in;font-size:8.5pt}.summary div{display:flex;justify-content:space-between;padding:.025in 0}.summary .grand{font-size:9.5pt;font-weight:900;border-top:1.5px solid #000;padding-top:.045in}.thanks{margin-top:.12in;font-size:8.5pt;font-weight:900}.note{font-size:6.5pt;line-height:1.2;margin-top:.07in;font-weight:700}.method{font-size:6.8pt;margin-top:.08in;font-weight:700}@media print{body{overflow:visible}}</style></head><body><main class="page"><header class="head"><div class="brand">Mana Pool</div><div class="shop">${esc(sender.name)}</div><div class="qrwrap">${qrHtml}</div></header><section class="addresses"><div class="address"><h2>Ship from</h2>${addressHtml(sender)}</div><div class="address"><h2>Ship to</h2>${addressHtml(shipTo)}</div></section><div class="orderline"><b>Order: ${esc(orderId)}</b><span>Order date: ${orderDate}</span></div><table><thead><tr><th>Item</th><th>Qty</th><th>Item price</th><th>Item total</th></tr></thead><tbody>${itemRows}</tbody></table><section class="summary"><div><span>Subtotal</span><b>${esc(centsText(shownSubtotal))}</b></div><div><span>Shipping</span><b>${esc(centsText(shownShipping))}</b></div>${shownTax!==null?`<div><span>Sales tax</span><b>${esc(centsText(shownTax))}</b></div>`:""}<div class="grand"><span>Order total</span><b>${esc(centsText(shownTotal))}</b></div></section><div class="thanks">Thanks for your purchase! We hope you love it!</div><div class="method">${esc(shippingMethod)} · ${totalQty} card${totalQty===1?"":"s"}</div><div class="note">Please keep this packing slip with your order. Mana Pool collects and remits applicable marketplace sales tax.</div></main>${printScript}</body></html>`;
    return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not create print document"},{status:500});}
}
