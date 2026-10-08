import { NextResponse } from "next/server";
import { count, db, dbAll } from "@/lib/supabase";
import { endListing, reviseListingQuantity } from "@/lib/ebay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const secretMap=(rows:any[])=>Object.fromEntries((rows||[]).map((row:any)=>[row.key,row.value]));
const ageMinutes=(value:unknown)=>value?Math.max(0,Math.round((Date.now()-new Date(String(value)).getTime())/60000)):null;

export async function GET(){
  try{
    const [secrets,syncEvents,pending,ledger,runs,listings,issues,orders]=await Promise.all([
      db("app_secrets?select=key,value,updated_at&key=in.(automation_worker_heartbeat,automation_worker_status,automation_worker_error,last_ebay_webhook_at,last_ebay_webhook_result,last_manapool_webhook_at,last_manapool_webhook_result,automation_last_recovery_at,automation_last_recovery_result)&limit=30"),
      db("sync_events?select=id,source,event_type,status,attempts,error_message,received_at,processed_at&order=received_at.desc&limit=50"),
      dbAll("pending_skus?select=id,batch_id,primary_sku,expected_quantity,sku,location_label,attach_status,attached_listing_id,attached_at,error_message,created_at&order=created_at.desc"),
      db("inventory_events?select=id,listing_id,physical_sku_id,sku,event_type,source,quantity_delta,details,created_at&order=created_at.desc&limit=100"),
      db("reconciliation_runs?select=id,source,status,listings_count,sku_count,issues_count,summary,error_message,started_at,completed_at&order=started_at.desc&limit=30"),
      dbAll("marketplace_listings?select=id,game,price,ebay_quantity,ebay_started_at,traffic_impressions,traffic_views,traffic_transactions&ebay_status=eq.active"),
      count("reconciliation_issues","&status=eq.open"),
      dbAll("marketplace_orders?select=id,marketplace,quantity,ordered_at,fulfillment_status,refunded&refunded=eq.false"),
    ]);
    const saved=secretMap(secrets||[]),groups=new Map<string,any[]>();
    for(const row of pending||[]){const key=String(row.batch_id||row.primary_sku||row.id);groups.set(key,[...(groups.get(key)||[]),row]);}
    const batches=[...groups.entries()].map(([id,rows])=>({id,primarySku:rows[0].primary_sku,expectedQuantity:Number(rows[0].expected_quantity||rows.length),storedSkus:rows.length,status:rows.every((x:any)=>x.attach_status==="attached")?"attached":rows.some((x:any)=>x.attach_status==="error")?"error":"pending",createdAt:rows[0].created_at,attachedAt:rows.find((x:any)=>x.attached_at)?.attached_at||null,listingId:rows.find((x:any)=>x.attached_listing_id)?.attached_listing_id||null,skus:rows.map((x:any)=>x.sku),error:rows.find((x:any)=>x.error_message)?.error_message||null})).slice(0,100);
    const now=Date.now(),active=listings||[],physicalUnits=active.reduce((sum:any,row:any)=>sum+Number(row.ebay_quantity||0),0),inventoryValue=active.reduce((sum:any,row:any)=>sum+Number(row.price||0)*Number(row.ebay_quantity||0),0);
    const old180=active.filter((row:any)=>row.ebay_started_at&&now-new Date(row.ebay_started_at).getTime()>=180*86400000).length;
    const noTraffic=active.filter((row:any)=>Number(row.traffic_impressions||0)===0).length;
    const last30=(orders||[]).filter((row:any)=>now-new Date(row.ordered_at).getTime()<=30*86400000).reduce((sum:any,row:any)=>sum+Number(row.quantity||0),0);
    const heartbeatAge=ageMinutes(saved.automation_worker_heartbeat),failed=(syncEvents||[]).filter((x:any)=>x.status==="failed").length,pendingEvents=(syncEvents||[]).filter((x:any)=>x.status==="pending").length;
    return NextResponse.json({ok:true,health:{workerOnline:heartbeatAge!==null&&heartbeatAge<2,workerHeartbeat:saved.automation_worker_heartbeat||null,workerAgeMinutes:heartbeatAge,workerStatus:saved.automation_worker_status||"not started",workerError:saved.automation_worker_error||null,lastEbayWebhookAt:saved.last_ebay_webhook_at||null,lastEbayWebhookResult:saved.last_ebay_webhook_result||null,lastManaPoolWebhookAt:saved.last_manapool_webhook_at||null,lastManaPoolWebhookResult:saved.last_manapool_webhook_result||null,lastRecoveryAt:saved.automation_last_recovery_at||null,lastRecoveryResult:saved.automation_last_recovery_result||null,failedEvents:failed,pendingEvents,openIssues:issues},metrics:{activeListings:active.length,physicalUnits,inventoryValue:Number(inventoryValue.toFixed(2)),soldUnits30Days:last30,olderThan180Days:old180,zeroImpressions:noTraffic,pokemon:active.filter((x:any)=>x.game==="pokemon").length,magic:active.filter((x:any)=>x.game==="magic").length},batches,ledger:ledger||[],runs:runs||[],events:syncEvents||[]});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Operations Center failed"},{status:500});}
}

export async function POST(request:Request){
  const startedAt=new Date().toISOString();
  let runId:string|null=null;
  try{
    const {action}:any=await request.json();
    if(action==="oversell-protection"){
      const issues=await dbAll("reconciliation_issues?select=id,listing_id,ebay_quantity,active_sku_count,marketplace_listings(ebay_listing_id,ebay_status)&status=eq.open&issue_type=eq.missing_sku");
      let reduced=0,ended=0;
      for(const issue of issues||[]){const listing=issue.marketplace_listings;if(!listing||listing.ebay_status!=="active")continue;const quantity=Math.max(0,Number(issue.active_sku_count||0));if(quantity===0){await endListing(String(listing.ebay_listing_id));ended++;}else if(quantity<Number(issue.ebay_quantity||0)){await reviseListingQuantity(String(listing.ebay_listing_id),quantity);reduced++;}await db(`marketplace_listings?id=eq.${issue.listing_id}`,{method:"PATCH",body:JSON.stringify({ebay_quantity:quantity,ebay_status:quantity?"active":"inactive",updated_at:new Date().toISOString()})});await db(`reconciliation_issues?id=eq.${issue.id}`,{method:"PATCH",body:JSON.stringify({status:"resolved",last_seen_at:new Date().toISOString()})});}
      return NextResponse.json({ok:true,message:`Oversell protection completed: ${reduced} quantities reduced and ${ended} empty listings ended.`});
    }
    if(action!=="reconcile")return NextResponse.json({error:"Unsupported operation"},{status:400});
    const inserted=await db("reconciliation_runs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({source:"operations-center",status:"running",started_at:startedAt})});
    runId=inserted?.[0]?.id||null;
    const response=await (await import("@/app/api/sync/route")).POST();
    const result:any=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||"Reconciliation failed");
    const [listingCount,skuCount,issueCount]=await Promise.all([count("marketplace_listings","&ebay_status=eq.active"),count("physical_skus","&status=in.(available,allocated)"),count("reconciliation_issues","&status=eq.open")]);
    if(runId)await db(`reconciliation_runs?id=eq.${runId}`,{method:"PATCH",body:JSON.stringify({status:"completed",listings_count:listingCount,sku_count:skuCount,issues_count:issueCount,summary:result,completed_at:new Date().toISOString()})});
    return NextResponse.json({ok:true,message:`Reconciliation completed with ${issueCount} item(s) needing review.`,result});
  }catch(error){const message=error instanceof Error?error.message:"Reconciliation failed";if(runId)await db(`reconciliation_runs?id=eq.${runId}`,{method:"PATCH",body:JSON.stringify({status:"failed",error_message:message,completed_at:new Date().toISOString()})}).catch(()=>{});return NextResponse.json({error:message},{status:500});}
}
