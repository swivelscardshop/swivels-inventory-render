import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { accessToken, endListing, getActiveListings, reviseListingQuantity } from "@/lib/ebay";
import { cardMatchKey } from "@/lib/matching";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const numericId = (value: unknown) => typeof value === "string" && /^\d+$/.test(value);
const ignoreEventKey = (ids: string[]) => `duplicate-ignore:${[...ids].sort().join("-")}`;

export async function GET() {
  try {
    const token = await accessToken();
    const listings = await getActiveListings(token);
    const map = new Map<string, any[]>();
    let comparable = 0;
    for (const listing of listings) {
      const matchKey = cardMatchKey({ title: listing.title, condition: listing.condition_name });
      if (!matchKey) continue;
      comparable += 1;
      const detectedCondition = matchKey.split("|").at(-1);
      map.set(matchKey, [...(map.get(matchKey) || []), { ...listing, detected_condition: detectedCondition }]);
    }
    const groups = [...map.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([matchKey, rows]) => ({
        matchKey,
        listings: [...rows].sort((a, b) => {
          const aTime = a.started_at ? Date.parse(a.started_at) : 0;
          const bTime = b.started_at ? Date.parse(b.started_at) : 0;
          return bTime - aTime || Number(b.ebay_listing_id) - Number(a.ebay_listing_id);
        }),
      }));
    const ignored = await db(
      "sync_events?select=event_key&event_type=eq.duplicate_ignored&status=eq.processed&limit=10000",
    );
    const ignoredKeys = new Set((ignored || []).map((row: any) => String(row.event_key)));
    const visibleGroups = groups.filter((group) => {
      const ids = group.listings.map((listing: any) => String(listing.ebay_listing_id));
      return !ignoredKeys.has(ignoreEventKey(ids));
    });
    return NextResponse.json({ groups: visibleGroups, scanned: listings.length, comparable, source: "ebay-live" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Live eBay duplicate scan failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action = "combine", matchKey, survivorEbayId, listingEbayIds, game }: any = await request.json();
    const ids = Array.isArray(listingEbayIds)
      ? ([...new Set(listingEbayIds)].filter(numericId).slice(0, 20) as string[])
      : [];
    if (action === "ignore") {
      if (game !== "pokemon" || ids.length < 2 || typeof matchKey !== "string" || !matchKey)
        throw new Error("Only a valid Pokémon duplicate group can be dismissed");
      const now = new Date().toISOString();
      await db("sync_events?on_conflict=event_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          source: "duplicate-center",
          event_key: ignoreEventKey(ids),
          event_type: "duplicate_ignored",
          status: "processed",
          attempts: 1,
          payload: { match_key: matchKey, listing_ebay_ids: [...ids].sort(), game: "pokemon" },
          processed_at: now,
        }),
      });
      return NextResponse.json({ ok: true, ignored: true });
    }
    if (!numericId(survivorEbayId) || ids.length < 2 || !ids.includes(survivorEbayId))
      throw new Error("Duplicate eBay selection could not be verified");

    const token = await accessToken();
    const live = await getActiveListings(token);
    const group = live.filter((x) => ids.includes(x.ebay_listing_id));
    if (group.length !== ids.length)
      throw new Error("One or more selected eBay listings are no longer active. Scan again.");
    if (group.some((row) => cardMatchKey({ title: row.title, condition: row.condition_name }) !== matchKey))
      throw new Error("The selected eBay listings are no longer an exact title-and-condition match");
    const survivor = group.find((x) => x.ebay_listing_id === survivorEbayId);
    if (!survivor) throw new Error("Selected eBay survivor could not be verified");
    const newest = [...group].sort((a, b) => {
      const aTime = a.started_at ? Date.parse(a.started_at) : 0;
      const bTime = b.started_at ? Date.parse(b.started_at) : 0;
      return bTime - aTime || Number(b.ebay_listing_id) - Number(a.ebay_listing_id);
    })[0];
    if (newest.ebay_listing_id !== survivorEbayId)
      throw new Error("For safety, duplicates can only be combined into the newest active eBay listing");
    const duplicates = group.filter((x) => x.ebay_listing_id !== survivorEbayId);
    const totalQuantity = group.reduce((sum, x) => sum + Number(x.ebay_quantity || 0), 0);

    await reviseListingQuantity(survivorEbayId, totalQuantity);
    for (const duplicate of duplicates) await endListing(duplicate.ebay_listing_id);

    const records = await db(`marketplace_listings?select=id,ebay_listing_id&ebay_listing_id=in.(${ids.join(",")})`);
    const survivorRecord = records?.find((x: any) => String(x.ebay_listing_id) === survivorEbayId);
    if (!survivorRecord)
      throw new Error("eBay was updated, but the survivor is missing from Supabase. Run Import from eBay now.");
    const duplicateRecords = (records || []).filter((x: any) => String(x.ebay_listing_id) !== survivorEbayId);
    for (const duplicate of duplicateRecords) {
      await db(`physical_skus?listing_id=eq.${duplicate.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ listing_id: survivorRecord.id, updated_at: new Date().toISOString() }),
      });
    }
    await db(`marketplace_listings?id=eq.${survivorRecord.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ebay_quantity: totalQuantity, updated_at: new Date().toISOString() }),
    });
    for (const duplicate of duplicateRecords)
      await db(`marketplace_listings?id=eq.${duplicate.id}`, { method: "DELETE" });

    return NextResponse.json({ ok: true, ended: duplicates.length, quantity: totalQuantity });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Combine failed" }, { status: 400 });
  }
}
