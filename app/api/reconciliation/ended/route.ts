import { NextResponse } from "next/server";
import { accessToken, getActiveListings, getRecentlyEndedListings } from "@/lib/ebay";
import { db, dbAll } from "@/lib/supabase";
import { cardMatchKey } from "@/lib/matching";
import { incidentEndedListings } from "@/lib/reconciliation-2026-09-28";

export const dynamic="force-dynamic";
export const maxDuration=300;

// The recovery scope is intentionally limited to the known combine incident
// date. September 28, 2026 was PDT (UTC-7).
const INCIDENT_START = Date.parse("2026-09-28T07:00:00.000Z");
const INCIDENT_END = Date.parse("2026-09-29T07:00:00.000Z");

async function candidates(){
  const token=await accessToken();
  const [active,ended,stored,orders]=await Promise.all([
    getActiveListings(token), getRecentlyEndedListings(60),
    dbAll("physical_skus?select=sku,status"),
    dbAll("marketplace_orders?select=pull_sku,raw_payload"),
  ]);
  const activeByKey=new Map<string,any[]>();
  for(const row of active.filter((x:any)=>x.ebay_status==="active"&&x.match_key)) activeByKey.set(row.match_key!,[...(activeByKey.get(row.match_key!)||[]),row]);
  const storedSkus=new Set(stored.map((x:any)=>String(x.sku).toLowerCase()));
  const soldSkus=new Set<string>();
  for(const order of orders){
    for(const value of String(order.pull_sku||"").split(",")) if(value.trim())soldSkus.add(value.trim().toLowerCase());
    const raw=order.raw_payload||{}; const sku=String(raw.sku||raw?.lineItem?.sku||"").trim(); if(sku)soldSkus.add(sku.toLowerCase());
  }
  const byId=new Map<string,any>();
  for(const raw of [...ended,...incidentEndedListings]){
    const row:any=raw;
    byId.set(String(row.ebay_listing_id),{...row,match_key:row.match_key||cardMatchKey({title:row.title,condition:row.condition_name})||null});
  }
  return [...byId.values()].flatMap((old:any)=>{
    const sku=String(old.ebay_sku||"").trim();
    const matches=old.match_key?activeByKey.get(old.match_key)||[]:[];
    const endedAt=Date.parse(String(old.ended_at||""));
    if(!Number.isFinite(endedAt)||endedAt<INCIDENT_START||endedAt>=INCIDENT_END)return [];
    if(!sku||storedSkus.has(sku.toLowerCase())||soldSkus.has(sku.toLowerCase())||old.quantity_sold>0||matches.length!==1)return [];
    const target=matches[0];
    return [{endedEbayId:old.ebay_listing_id,endedTitle:old.title,endedAt:old.ended_at,sku,matchKey:old.match_key,
      survivorEbayId:target.ebay_listing_id,survivorTitle:target.title,survivorQuantity:target.ebay_quantity}];
  });
}

export async function GET(){
  try{const rows=await candidates();return NextResponse.json({ok:true,rows,count:rows.length,reviewRequired:true,dateScope:"2026-09-28 America/Los_Angeles"});}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Ended listing reconciliation failed"},{status:500});}
}

async function applyCandidate(verified:any){
  const {endedEbayId,survivorEbayId,sku,matchKey}=verified;
  const listing=(await db(`marketplace_listings?select=id,title,match_key&ebay_listing_id=eq.${survivorEbayId}&ebay_status=eq.active&limit=1`))?.[0];
  if(!listing||listing.match_key!==matchKey)throw new Error("The surviving Supabase listing no longer matches");
  const existing=await db(`physical_skus?select=id&sku=eq.${encodeURIComponent(sku)}&limit=1`);
  if(existing?.length)throw new Error(`SKU ${sku} is already stored`);
  const now=new Date().toISOString();
  await db("physical_skus",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({listing_id:listing.id,sku,location_label:sku,status:"available",source:"ended_listing_recovery",updated_at:now})});
  // The SKU write and the Exception Center issue are separate records. Close
  // the issue only after the live reconciliation view confirms the quantities
  // now agree, so a partially repaired listing remains visible.
  const reconciliation=(await db(`listing_reconciliation?select=id,difference,ebay_quantity,active_sku_count&id=eq.${listing.id}&limit=1`))?.[0];
  const resolvedIssue=Number(reconciliation?.difference)===0;
  if(resolvedIssue){
    await db(`reconciliation_issues?listing_id=eq.${listing.id}&status=eq.open`,{method:"PATCH",body:JSON.stringify({status:"resolved",last_seen_at:now})});
  }
  try{
    await db("sync_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({source:"ended-reconciliation",event_key:`ended-sku:${endedEbayId}:${sku}`,event_type:"ended_sku_recovered",status:"processed",attempts:1,payload:verified,received_at:now,processed_at:now})});
  }catch(error){
    // The inventory link is the durable result. A duplicate or unavailable audit
    // row must not make a successful recovery appear to have failed.
    console.warn("Could not write ended-listing recovery audit",error);
  }
  return {sku,title:listing.title,endedEbayId,survivorEbayId,resolvedIssue};
}

export async function POST(request:Request){
  try{
    const body:any=await request.json();
    if(body.mode==="apply-all"){
      const safeRows=await candidates();
      const added:any[]=[]; const skipped:any[]=[];
      for(const row of safeRows){
        try{added.push(await applyCandidate(row));}
        catch(error){skipped.push({sku:row.sku,reason:error instanceof Error?error.message:"Could not add SKU"});}
      }
      return NextResponse.json({ok:true,added,skipped,addedCount:added.length,skippedCount:skipped.length});
    }
    const endedEbayId=String(body.endedEbayId||""),survivorEbayId=String(body.survivorEbayId||""),sku=String(body.sku||"").trim(),matchKey=String(body.matchKey||"");
    if(!/^\d+$/.test(endedEbayId)||!/^\d+$/.test(survivorEbayId)||!sku||!matchKey)throw new Error("Invalid reconciliation selection");
    const verified=(await candidates()).find((x:any)=>x.endedEbayId===endedEbayId&&x.survivorEbayId===survivorEbayId&&x.sku===sku&&x.matchKey===matchKey);
    if(!verified)throw new Error("This ended listing is no longer a safe unique match. Scan again.");
    return NextResponse.json({ok:true,...await applyCandidate(verified)});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not recover ended SKU"},{status:400});}
}
