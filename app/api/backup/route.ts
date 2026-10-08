import { NextResponse } from "next/server";
import { dbAll } from "@/lib/supabase";

export const dynamic="force-dynamic";
export const maxDuration=300;

export async function GET(){
  try{
    const [listings,skus,orders,pending,issues,events,ledger,runs]=await Promise.all([
      dbAll("marketplace_listings?select=*&order=created_at.asc"),dbAll("physical_skus?select=*&order=created_at.asc"),dbAll("marketplace_orders?select=*&order=ordered_at.asc"),dbAll("pending_skus?select=*&order=created_at.asc"),dbAll("reconciliation_issues?select=*&order=first_seen_at.asc"),dbAll("sync_events?select=*&order=received_at.asc"),dbAll("inventory_events?select=*&order=created_at.asc"),dbAll("reconciliation_runs?select=*&order=started_at.asc")
    ]);
    const createdAt=new Date().toISOString(),body=JSON.stringify({format:"swivels-inventory-backup-v1",createdAt,counts:{listings:listings.length,skus:skus.length,orders:orders.length,pending:pending.length,issues:issues.length,events:events.length,ledger:ledger.length,runs:runs.length},data:{listings,skus,orders,pending,issues,events,ledger,runs}},null,2);
    return new NextResponse(body,{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="swivels-inventory-backup-${createdAt.slice(0,10)}.json"`,"Cache-Control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Backup failed"},{status:500});}
}
