import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { endListing, reviseListingQuantity } from "@/lib/ebay";
import { cardMatchKey } from "@/lib/matching";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const rows = await db(
      "marketplace_listings?select=id,ebay_listing_id,ebay_sku,title,set_name,card_number,finish,language,condition_name,parallel_variety,price,ebay_quantity&ebay_status=eq.active&order=title.asc&limit=10000",
    );
    const map = new Map<string, any[]>();
    let comparable = 0;
    for (const row of rows || []) {
      const matchKey = cardMatchKey({ title: row.title, condition: row.condition_name });
      if (!matchKey) continue;
      comparable += 1;
      const detectedCondition = matchKey.split("|").at(-1);
      map.set(matchKey, [...(map.get(matchKey) || []), { ...row, detected_condition: detectedCondition }]);
    }
    const groups = [...map.entries()]
      .filter(([, listings]) => listings.length > 1)
      .map(([matchKey, listings]) => ({ matchKey, listings }));
    return NextResponse.json({ groups, scanned: rows?.length || 0, comparable });
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
    const { matchKey, survivorId, listingIds }: any = await request.json();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ids = Array.isArray(listingIds) ? [...new Set(listingIds)].filter((x): x is string => typeof x === "string" && uuid.test(x)).slice(0, 20) : [];
    if (!uuid.test(String(survivorId)) || ids.length < 2 || !ids.includes(survivorId))
      throw new Error("Duplicate selection could not be verified");
    const group = await db(
      `marketplace_listings?select=id,ebay_listing_id,ebay_quantity,title,condition_name&ebay_status=eq.active&id=in.(${ids.join(",")})`,
    );
    if (!group || group.length < 2)
      throw new Error("This duplicate group no longer exists");
    if (group.some((row: any) => cardMatchKey({ title: row.title, condition: row.condition_name }) !== matchKey))
      throw new Error("The selected listings are no longer an exact title-and-condition match");
    const survivor = group.find((x: any) => x.id === survivorId);
    if (!survivor) throw new Error("Selected survivor could not be verified");
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
