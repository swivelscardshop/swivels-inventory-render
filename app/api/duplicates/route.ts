import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { endListing, reviseListingQuantity } from "@/lib/ebay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const rows = await db(
      "marketplace_listings?select=id,ebay_listing_id,ebay_sku,title,set_name,card_number,finish,language,condition_name,parallel_variety,price,ebay_quantity,match_key&ebay_status=eq.active&match_key=not.is.null&order=title.asc&limit=10000",
    );
    const map = new Map<string, any[]>();
    for (const row of rows || [])
      map.set(row.match_key, [...(map.get(row.match_key) || []), row]);
    const groups = [...map.entries()]
      .filter(([, listings]) => listings.length > 1)
      .map(([matchKey, listings]) => ({ matchKey, listings }));
    return NextResponse.json({ groups });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Duplicate scan failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { matchKey, survivorId }: any = await request.json();
    const rows = await db(
      `marketplace_listings?select=id,ebay_listing_id,ebay_quantity,match_key&id=in.(${survivorId})`,
    );
    const survivor = rows?.[0];
    if (!survivor || survivor.match_key !== matchKey)
      throw new Error("Selected survivor could not be verified");
    const group = await db(
      `marketplace_listings?select=id,ebay_listing_id,ebay_quantity,match_key&ebay_status=eq.active&match_key=eq.${encodeURIComponent(matchKey)}`,
    );
    if (!group || group.length < 2)
      throw new Error("This duplicate group no longer exists");
    const duplicates = group.filter((x: any) => x.id !== survivor.id);
    const totalQuantity = group.reduce(
      (sum: number, x: any) => sum + Number(x.ebay_quantity || 0),
      0,
    );
    await reviseListingQuantity(
      String(survivor.ebay_listing_id),
      totalQuantity,
    );
    for (const duplicate of duplicates)
      await endListing(String(duplicate.ebay_listing_id));
    for (const duplicate of duplicates)
      await db(`physical_skus?listing_id=eq.${duplicate.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          listing_id: survivor.id,
          updated_at: new Date().toISOString(),
        }),
      });
    await db(`marketplace_listings?id=eq.${survivor.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ebay_quantity: totalQuantity,
        updated_at: new Date().toISOString(),
      }),
    });
    for (const duplicate of duplicates)
      await db(`marketplace_listings?id=eq.${duplicate.id}`, {
        method: "DELETE",
      });
    return NextResponse.json({
      ok: true,
      ended: duplicates.length,
      quantity: totalQuantity,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Combine failed" },
      { status: 400 },
    );
  }
}
