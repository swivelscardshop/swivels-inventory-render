import { NextResponse } from "next/server";
import { reviseListingQuantity } from "@/lib/ebay";
import { db } from "@/lib/supabase";
import { recordInventoryEvents } from "@/lib/inventory-events";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body: any = await request.json();
    const matches = Array.isArray(body.matches)
      ? body.matches.slice(0, 5000)
      : [];
    const pending = Array.isArray(body.pending)
      ? body.pending.slice(0, 5000)
      : [];
    if (body.conflictCount)
      throw new Error(
        "Resolve existing eBay duplicate listings before applying this CSV",
      );
    const grouped = new Map<string, any[]>();
    for (const row of matches)
      if (row.listingId && row.sku && row.matchKey)
        grouped.set(row.listingId, [
          ...(grouped.get(row.listingId) || []),
          row,
        ]);
    let quantitiesUpdated = 0,
      skusStored = 0;
    for (const [listingId, rows] of grouped) {
      const listings = await db(
        `marketplace_listings?select=id,ebay_listing_id,ebay_quantity,match_key&id=eq.${listingId}&limit=1`,
      );
      const listing = listings?.[0];
      if (!listing || rows.some((x) => x.matchKey !== listing.match_key))
        throw new Error("A CSV match changed. Run Preview again.");
      const skus = [...new Set(rows.map((x) => String(x.sku)))];
      const already: any[] = [];
      for (let i = 0; i < skus.length; i += 100)
        already.push(
          ...(await db(
            `physical_skus?select=sku&sku=in.(${skus
              .slice(i, i + 100)
              .map(encodeURIComponent)
              .join(",")})`,
          )),
        );
      const existing = new Set(already.map((x) => x.sku));
      const fresh = rows.filter(
        (x, i, a) =>
          !existing.has(x.sku) && a.findIndex((y) => y.sku === x.sku) === i,
      );
      if (!fresh.length) continue;
      const newQuantity = Number(listing.ebay_quantity) + fresh.length;
      await reviseListingQuantity(String(listing.ebay_listing_id), newQuantity);
      await db("physical_skus?on_conflict=sku", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(
          fresh.map((x) => ({
            listing_id: listing.id,
            sku: x.sku,
            location_label: x.location || x.sku,
            status: "available",
            source: "csv_intake",
            updated_at: new Date().toISOString(),
          })),
        ),
      });
      await db(`marketplace_listings?id=eq.${listing.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          ebay_quantity: newQuantity,
          updated_at: new Date().toISOString(),
        }),
      });
      await recordInventoryEvents(fresh.map((x:any)=>({listing_id:listing.id,sku:x.sku,event_type:"sku_attached",source:"csv_intake_existing",quantity_delta:1,details:{ebay_listing_id:listing.ebay_listing_id}})));
      quantitiesUpdated += 1;
      skusStored += fresh.length;
    }
    const uniquePending = Array.from(
      new Map(
        pending
          .filter((x: any) => x.matchKey && x.sku)
          .map((x: any) => [String(x.sku), x]),
      ).values(),
    ) as any[];
    if (uniquePending.length) {
      const groupIds = new Map<string,string>();
      for(const row of uniquePending){const primary=String(row.primarySku||row.sku);if(!groupIds.has(primary))groupIds.set(primary,crypto.randomUUID());}
      const pendingSkus = uniquePending.map((x: any) => String(x.sku));
      const assigned: any[] = [];
      for (let i = 0; i < pendingSkus.length; i += 100)
        assigned.push(
          ...(await db(
            `physical_skus?select=sku,listing_id&sku=in.(${pendingSkus
              .slice(i, i + 100)
              .map(encodeURIComponent)
              .join(",")})`,
          )),
        );
      if (assigned.length)
        throw new Error(
          `${assigned.length} CSV SKU(s) are already attached to an eBay listing: ${assigned
            .slice(0, 5)
            .map((x) => x.sku)
            .join(", ")}. Remove or correct those rows, then preview again.`,
        );
      await db("pending_skus?on_conflict=sku", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(
          uniquePending.map((x: any) => ({
            batch_id: groupIds.get(String(x.primarySku || x.sku)),
            match_key: x.matchKey,
            primary_sku: x.primarySku || x.sku,
            expected_quantity: Math.max(1, Number(x.expectedQuantity || 1)),
            attach_status: "pending",
            attached_listing_id: null,
            attached_at: null,
            error_message: null,
            sku: x.sku,
            location_label: x.location || x.sku,
            source: "csv_intake",
          })),
        ),
      });
      const verified: any[] = [];
      for (let i = 0; i < pendingSkus.length; i += 100)
        verified.push(
          ...(await db(
            `pending_skus?select=sku,match_key,primary_sku,expected_quantity,attach_status&sku=in.(${pendingSkus
              .slice(i, i + 100)
              .map(encodeURIComponent)
              .join(",")})`,
          )),
        );
      const verifiedBySku = new Map(verified.map((x) => [String(x.sku), x]));
      const missing = uniquePending.filter((x: any) => {
        const saved = verifiedBySku.get(String(x.sku));
        return !saved || saved.match_key !== x.matchKey || saved.primary_sku !== (x.primarySku || x.sku) || Number(saved.expected_quantity) !== Math.max(1, Number(x.expectedQuantity || 1)) || saved.attach_status !== "pending";
      });
      if (missing.length)
        throw new Error(
          `Supabase did not verify ${missing.length} pending SKU(s). Do not upload the generated eBay CSV yet.`,
        );
      await recordInventoryEvents(uniquePending.map((x:any)=>({sku:x.sku,event_type:"sku_pending",source:"csv_intake_new",quantity_delta:1,details:{primary_sku:x.primarySku||x.sku,expected_quantity:Math.max(1,Number(x.expectedQuantity||1))}})));
    }
    return NextResponse.json({
      ok: true,
      quantitiesUpdated,
      skusStored,
      pendingStored: uniquePending.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CSV apply failed" },
      { status: 400 },
    );
  }
}
