import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { cardMatchKey,csvIdentity } from "@/lib/matching";
import { db,dbAll } from "@/lib/supabase";
export const dynamic="force-dynamic"; export const maxDuration=300;

async function preview(file:File){
  const rows=parse(await file.text(),{bom:true,columns:true,skip_empty_lines:true,relax_quotes:true}) as Record<string,string>[];
  const groups=new Map<string,Record<string,string>[]>();
  for(const row of rows){const key=cardMatchKey(csvIdentity(row)),sku=String(row.CustomLabel||"").trim();if(key&&sku)groups.set(key,[...(groups.get(key)||[]),row]);}
  const listings=await dbAll("marketplace_listings?select=id,ebay_listing_id,ebay_sku,title,match_key,ebay_quantity,physical_skus(sku,status)&ebay_status=eq.active");
  const byPrimary=new Map(listings.filter((x:any)=>x.ebay_sku).map((x:any)=>[String(x.ebay_sku),x]));
  const byKey=new Map<string,any[]>();for(const row of listings)if(row.match_key)byKey.set(row.match_key,[...(byKey.get(row.match_key)||[]),row]);
  const recovery:any[]=[];
  for(const[key,group]of groups){const primary=String(group[0].CustomLabel||"").trim();let listing=byPrimary.get(primary);if(!listing){const matches=byKey.get(key)||[];if(matches.length===1)listing=matches[0];}if(!listing)continue;
    const stored=new Set((listing.physical_skus||[]).map((x:any)=>String(x.sku))),incoming=[...new Set(group.map(x=>String(x.CustomLabel||"").trim()).filter(Boolean))],missing=incoming.filter(sku=>!stored.has(sku));
    const available=(listing.physical_skus||[]).filter((x:any)=>["available","allocated"].includes(String(x.status))).length,difference=Math.max(0,Number(listing.ebay_quantity)-available),safe=missing.slice(0,difference);
    if(safe.length)recovery.push({listingId:listing.id,ebayListingId:listing.ebay_listing_id,title:listing.title,primarySku:primary,ebayQuantity:Number(listing.ebay_quantity),storedLocations:available,missingSkus:safe});
  }return{rows:rows.length,recovery,skuCount:recovery.reduce((n,x)=>n+x.missingSkus.length,0)};
}
export async function POST(request:Request){try{const type=request.headers.get("content-type")||"";if(type.includes("multipart/form-data")){const form=await request.formData(),file=form.get("file");if(!(file instanceof File))throw new Error("Choose the original Card Uploader CSV");return NextResponse.json(await preview(file));}
  const body:any=await request.json(),items=Array.isArray(body.items)?body.items:[];let added=0;const now=new Date().toISOString();
  for(const item of items){const listing=(await db(`marketplace_listings?select=id,ebay_quantity,physical_skus(sku,status)&id=eq.${encodeURIComponent(String(item.listingId||""))}&ebay_status=eq.active&limit=1`))?.[0];if(!listing)continue;const stored=new Set((listing.physical_skus||[]).map((x:any)=>String(x.sku))),active=(listing.physical_skus||[]).filter((x:any)=>["available","allocated"].includes(String(x.status))).length,capacity=Math.max(0,Number(listing.ebay_quantity)-active);const safe=(Array.isArray(item.missingSkus)?item.missingSkus:[]).map(String).filter((sku:string)=>sku&&!stored.has(sku)).slice(0,capacity);
    let listingAdded=0;
    for(const sku of safe){const conflict=await db(`physical_skus?select=id&sku=eq.${encodeURIComponent(sku)}&limit=1`);if(conflict?.length)continue;await db("physical_skus",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({listing_id:listing.id,sku,location_label:sku,status:"available",source:"csv_recovery",updated_at:now})});added++;listingAdded++;}
    if(active+listingAdded>=Number(listing.ebay_quantity))await db(`reconciliation_issues?listing_id=eq.${listing.id}&status=eq.open`,{method:"PATCH",body:JSON.stringify({status:"resolved",last_seen_at:now})});
  }return NextResponse.json({ok:true,added});
}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"CSV recovery failed"},{status:400});}}
