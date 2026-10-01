import { db, dbAll } from "@/lib/supabase";
export async function repairMissingPrimarySkus(){
  const issues=await dbAll("reconciliation_issues?select=id,listing_id,ebay_quantity,active_sku_count,marketplace_listings(ebay_sku,ebay_status)&status=eq.open&issue_type=eq.missing_sku");
  const result={repaired:0,alreadyLinked:0,missingEbaySku:0,conflicts:0,checked:issues.length},now=new Date().toISOString();
  for(const issue of issues||[]){const listing=issue.marketplace_listings,sku=String(listing?.ebay_sku||"").trim();if(listing?.ebay_status!=="active"||!sku){result.missingEbaySku++;continue;}
    const existing=await db(`physical_skus?select=id,listing_id,status&sku=eq.${encodeURIComponent(sku)}&limit=1`);
    if(existing?.length){if(String(existing[0].listing_id)!==String(issue.listing_id)||existing[0].status!=="available"){result.conflicts++;continue;}result.alreadyLinked++;}
    else{await db("physical_skus",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({listing_id:issue.listing_id,sku,location_label:sku,status:"available",source:"ebay_scheduled_activation",updated_at:now})});result.repaired++;}
    if(Number(issue.active_sku_count)+(existing?.length?0:1)>=Number(issue.ebay_quantity))await db(`reconciliation_issues?id=eq.${issue.id}`,{method:"PATCH",body:JSON.stringify({status:"resolved",last_seen_at:now})});
  }return result;
}
