import { NextResponse } from "next/server";
import { reviseListingQuantity } from "@/lib/ebay";
import { db } from "@/lib/supabase";

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
      quantitiesUpdated += 1;
      skusStored += fresh.length;
    }
    if (pending.length)
      await db("pending_skus?on_conflict=sku", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(
          pending.map((x: any) => ({
            match_key: x.matchKey,
            sku: x.sku,
            location_label: x.location || x.sku,
            source: "csv_intake",
          })),
        ),
      });
    return NextResponse.json({
      ok: true,
      quantitiesUpdated,
      skusStored,
      pendingStored: pending.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CSV apply failed" },
      { status: 400 },
    );
  }
}
