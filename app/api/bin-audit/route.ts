import { NextResponse } from "next/server";
import { db, dbAll } from "@/lib/supabase";
import { recordInventoryEvents } from "@/lib/inventory-events";
export const dynamic="force-dynamic";

const natural=(value:string)=>value.split(/(\d+)/).map(part=>/^\d+$/.test(part)?part.padStart(12,"0"):part.toLowerCase()).join("");
function locationParts(value:string){
  const sku=String(value||"").trim().replace(/[–—_\s]+/g,"-").replace(/-+/g,"-");
  const parts=sku.split("-").filter(Boolean),numbers=parts.map((part,index)=>/^\d+$/.test(part)?index:-1).filter(index=>index>=0);
  if(numbers.length>=2){
    const positionIndex=numbers[numbers.length-1],binIndex=numbers[numbers.length-2];
    const binParts=parts.slice(0,positionIndex);binParts[binIndex]=String(Number(binParts[binIndex])).padStart(3,"0");
    return{bin:binParts.join("-"),position:Number(parts[positionIndex]),positionLabel:String(Number(parts[positionIndex])).padStart(3,"0")};
  }
  if(numbers.length===1){const index=numbers[0],binParts=[...parts];binParts[index]=String(Number(binParts[index])).padStart(3,"0");return{bin:binParts.join("-"),position:0,positionLabel:"—"};}
  return{bin:"Other / unrecognized",position:Number.MAX_SAFE_INTEGER,positionLabel:"—"};
}

export async function GET(){
  try{
    const [rows,audits]=await Promise.all([dbAll("physical_skus?select=id,sku,location_label,status,source_order_id,listing_id,marketplace_listings(ebay_listing_id,title,game,set_name,condition_name,condition_id,ebay_status)&status=in.(available,allocated)&order=sku.asc"),dbAll("bin_audit_results?select=physical_sku_id,status,note,verified_at")]);
    const auditMap=new Map((audits||[]).map((row:any)=>[String(row.physical_sku_id),row]));
    const items=(rows||[]).map((row:any)=>{const location=String(row.location_label||row.sku||"").trim(),parsed=locationParts(location),listing=row.marketplace_listings||{};return{
      id:row.id,sku:String(row.sku||location),location,bin:parsed.bin,position:parsed.position,positionLabel:parsed.positionLabel,status:row.status,sourceOrderId:row.source_order_id||null,
      listingId:row.listing_id,ebayListingId:listing.ebay_listing_id||null,title:listing.title||"Listing unavailable",game:listing.game||"other",setName:listing.set_name||null,condition:listing.condition_id||listing.condition_name||null,ebayStatus:listing.ebay_status||null,audit:auditMap.get(String(row.id))||null,
    };}).sort((a:any,b:any)=>natural(a.bin).localeCompare(natural(b.bin))||a.position-b.position||natural(a.sku).localeCompare(natural(b.sku)));
    const groups=new Map<string,any[]>();for(const item of items)groups.set(item.bin,[...(groups.get(item.bin)||[]),item]);
    return NextResponse.json({total:items.length,bins:groups.size,groups:[...groups.entries()].map(([bin,cards])=>({bin,count:cards.length,cards}))});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Bin reconciliation failed"},{status:500});}
}

export async function POST(request:Request){
  try{const{action,id,location,note}:any=await request.json(),rows=await db(`physical_skus?select=id,sku,listing_id,location_label&id=eq.${encodeURIComponent(String(id||""))}&limit=1`),row=rows?.[0];if(!row)return NextResponse.json({error:"SKU location was not found"},{status:404});const now=new Date().toISOString();
    if(action==="verify"||action==="missing"){await db("bin_audit_results?on_conflict=physical_sku_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({physical_sku_id:row.id,status:action==="verify"?"verified":"missing",note:note||null,verified_at:action==="verify"?now:null,updated_at:now})});await recordInventoryEvents([{listing_id:row.listing_id,physical_sku_id:row.id,sku:row.sku,event_type:action==="verify"?"bin_verified":"bin_missing",source:"bin_audit",quantity_delta:0,details:{note:note||null}}]);return NextResponse.json({ok:true});}
    if(action==="move"){const target=String(location||"").trim();if(!/^[A-Za-z0-9][A-Za-z0-9 _.-]{2,79}$/.test(target))return NextResponse.json({error:"Enter a valid destination SKU/location"},{status:400});const conflict=await db(`physical_skus?select=id&sku=eq.${encodeURIComponent(target)}&id=neq.${row.id}&limit=1`);if(conflict?.length)return NextResponse.json({error:`${target} is already assigned to another card.`},{status:409});await db(`physical_skus?id=eq.${row.id}`,{method:"PATCH",body:JSON.stringify({sku:target,location_label:target,updated_at:now})});await recordInventoryEvents([{listing_id:row.listing_id,physical_sku_id:row.id,sku:target,event_type:"sku_moved",source:"bin_audit",quantity_delta:0,details:{from:row.location_label,to:target}}]);return NextResponse.json({ok:true});}
    return NextResponse.json({error:"Unsupported bin action"},{status:400});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Bin action failed"},{status:500});}
}
