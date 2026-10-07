import { NextResponse } from "next/server";
import { dbAll } from "@/lib/supabase";
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
    const rows=await dbAll("physical_skus?select=id,sku,location_label,status,source_order_id,listing_id,marketplace_listings(ebay_listing_id,title,game,set_name,condition_name,condition_id,ebay_status)&status=in.(available,allocated)&order=sku.asc");
    const items=(rows||[]).map((row:any)=>{const location=String(row.location_label||row.sku||"").trim(),parsed=locationParts(location),listing=row.marketplace_listings||{};return{
      id:row.id,sku:String(row.sku||location),location,bin:parsed.bin,position:parsed.position,positionLabel:parsed.positionLabel,status:row.status,sourceOrderId:row.source_order_id||null,
      listingId:row.listing_id,ebayListingId:listing.ebay_listing_id||null,title:listing.title||"Listing unavailable",game:listing.game||"other",setName:listing.set_name||null,condition:listing.condition_id||listing.condition_name||null,ebayStatus:listing.ebay_status||null,
    };}).sort((a:any,b:any)=>natural(a.bin).localeCompare(natural(b.bin))||a.position-b.position||natural(a.sku).localeCompare(natural(b.sku)));
    const groups=new Map<string,any[]>();for(const item of items)groups.set(item.bin,[...(groups.get(item.bin)||[]),item]);
    return NextResponse.json({total:items.length,bins:groups.size,groups:[...groups.entries()].map(([bin,cards])=>({bin,count:cards.length,cards}))});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Bin reconciliation failed"},{status:500});}
}
