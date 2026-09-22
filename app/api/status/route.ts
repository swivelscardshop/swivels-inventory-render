import { NextResponse } from "next/server";
import { ebayConfigured } from "@/lib/ebay";
import { count, db, supabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const base = { ebayConfigured: ebayConfigured(), supabaseConfigured: supabaseConfigured() };
  if (!supabaseConfigured()) return NextResponse.json({ ...base, ready: false, error: "Add the Supabase URL and secret key in Render." });
  try {
    const [listings, physical, orders, issues, latest, orderRows, issueRows] = await Promise.all([
      count("marketplace_listings", "&ebay_status=eq.active"),
      count("physical_skus", "&status=in.(available,allocated)"),
      count("marketplace_orders", "&fulfillment_status=eq.unfulfilled&refunded=eq.false"),
      count("reconciliation_issues", "&status=eq.open"),
      db("marketplace_listings?select=last_ebay_sync_at&order=last_ebay_sync_at.desc&limit=1"),
      db("marketplace_orders?select=id,marketplace_order_id,quantity,ordered_at,listing_id,marketplace_listings(title,ebay_sku)&fulfillment_status=eq.unfulfilled&refunded=eq.false&order=ordered_at.desc&limit=5"),
      db("reconciliation_issues?select=id,issue_type,ebay_quantity,active_sku_count,marketplace_listings(title,ebay_listing_id)&status=eq.open&order=last_seen_at.desc&limit=5"),
    ]);
    return NextResponse.json({ ...base, ready: true, listings, physical, orders, issues, lastSync: latest?.[0]?.last_ebay_sync_at || null, orderRows, issueRows });
  } catch (error) {
    return NextResponse.json({ ...base, ready: false, error: error instanceof Error ? error.message : "Supabase is not ready" });
  }
}
