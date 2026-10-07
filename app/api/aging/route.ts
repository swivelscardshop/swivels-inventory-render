import { NextResponse } from "next/server";
import { accessToken, getListingTraffic } from "@/lib/ebay";
import { count, db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const dayMs = 24 * 60 * 60 * 1000;
const cutoff = (days: number) => new Date(Date.now() - days * dayMs).toISOString();

const priceFloor = 1.99;
const money = (value: number) => Math.round(value * 100) / 100;

function titleSuggestions(row: any) {
  const title = String(row.title || "");
  const suggestions: string[] = [];
  if (!/\b(NM|Near Mint|LP|Lightly Played|Light Play|MP|Moderately Played|HP|Heavily Played|DMG|Damaged)\b/i.test(title)) suggestions.push("Add the card condition to the title.");
  if (!/\b\d{1,4}[a-z]?\s*\/\s*\d{1,4}[a-z]?\b|\b\d{1,4}[a-z]?\b/i.test(title)) suggestions.push("Add the collector/card number if it is available.");
  if (row.game === "pokemon" && !/pok[eé]mon|pokemon/i.test(title)) suggestions.push("Add Pokémon to the title.");
  if (row.game === "magic" && !/magic|mtg/i.test(title)) suggestions.push("Add Magic: The Gathering or MTG to the title.");
  if (title.length > 75) suggestions.push("Shorten the title so the most important card details appear first.");
  return suggestions;
}

function recommendedPrice(row: any, ageDays: number | null) {
  const current = Number(row.price || 0);
  if (!Number.isFinite(current) || current <= priceFloor) return { current, suggested: priceFloor, change: false, reason: "Your price is already at the $1.99 floor." };
  const impressions = row.traffic_impressions == null ? null : Number(row.traffic_impressions);
  const views = row.traffic_views == null ? null : Number(row.traffic_views);
  const transactions = row.traffic_transactions == null ? null : Number(row.traffic_transactions);
  if (transactions && transactions > 0) return { current, suggested: current, change: false, reason: "Recent sales activity supports keeping the current price." };
  let reduction = ageDays != null && ageDays >= 365 ? 0.15 : ageDays != null && ageDays >= 180 ? 0.10 : 0.05;
  if (impressions != null && impressions >= 10 && views === 0) reduction = Math.max(reduction, 0.10);
  const suggested = money(Math.max(priceFloor, current * (1 - reduction)));
  const trafficReason = impressions == null ? "Traffic has not been collected yet" : `${impressions.toLocaleString()} impressions, ${Number(views || 0).toLocaleString()} views, and no sales in the latest traffic period`;
  return { current, suggested, change: suggested < current, reason: `${trafficReason}; test a ${Math.round(reduction * 100)}% reduction without going below $1.99.` };
}

function recommendation(row: any, ageDays: number | null) {
  const impressions = row.traffic_impressions;
  const views = row.traffic_views;
  const transactions = row.traffic_transactions;
  const price = recommendedPrice(row, ageDays);
  const title = titleSuggestions(row);
  let summary = { key: "keep", label: "Keep listing" };
  if (impressions == null) summary = { key: "collect", label: "Collect traffic data" };
  else if (Number(impressions) < 10) summary = { key: "optimize", label: "Improve title and item specifics" };
  else if (Number(views) === 0) summary = { key: "promote", label: "Review photo or promote" };
  else if (Number(transactions) === 0) summary = { key: "price", label: "Review price" };
  const changes = [
    price.change ? `Test price: $${price.current.toFixed(2)} → $${price.suggested.toFixed(2)}` : `Price: keep at $${price.suggested.toFixed(2)}`,
    ...title,
    ...(impressions != null && Number(impressions) < 10 ? ["Review item specifics so eBay can place the listing in more searches."] : []),
    ...(impressions != null && Number(impressions) >= 10 && Number(views || 0) === 0 ? ["Review the primary photo and consider a small promoted-listing test."] : []),
  ];
  return { ...summary, price, changes };
}

function bucketFilter(bucket: string) {
  if (bucket === "365") return `&ebay_started_at=lte.${encodeURIComponent(cutoff(365))}`;
  if (bucket === "180") return `&ebay_started_at=lte.${encodeURIComponent(cutoff(180))}&ebay_started_at=gt.${encodeURIComponent(cutoff(365))}`;
  if (bucket === "90") return `&ebay_started_at=lte.${encodeURIComponent(cutoff(90))}&ebay_started_at=gt.${encodeURIComponent(cutoff(180))}`;
  return "";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const bucket = ["90", "180", "365"].includes(url.searchParams.get("bucket") || "") ? String(url.searchParams.get("bucket")) : "180";
    const game = ["pokemon", "magic"].includes(url.searchParams.get("game") || "") ? String(url.searchParams.get("game")) : "all";
    const reviewed = url.searchParams.get("reviewed") || "open";
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = 50;
    const gameFilter = game === "all" ? "" : `&game=eq.${game}`;
    const reviewedFilter = reviewed === "reviewed" ? "&aging_reviewed_at=not.is.null" : reviewed === "all" ? "" : "&aging_reviewed_at=is.null";
    const filters = `&ebay_status=eq.active${bucketFilter(bucket)}${gameFilter}${reviewedFilter}`;
    const [rows, total, age90, age180, age365] = await Promise.all([
      db(`marketplace_listings?select=id,ebay_listing_id,ebay_sku,title,game,price,ebay_quantity,ebay_started_at,aging_reviewed_at,aging_action,traffic_impressions,traffic_views,traffic_transactions,traffic_ctr,traffic_conversion,traffic_updated_at${filters}&order=ebay_started_at.asc&limit=${pageSize}&offset=${(page - 1) * pageSize}`),
      count("marketplace_listings", filters),
      count("marketplace_listings", `&ebay_status=eq.active&ebay_started_at=lte.${encodeURIComponent(cutoff(90))}&ebay_started_at=gt.${encodeURIComponent(cutoff(180))}`),
      count("marketplace_listings", `&ebay_status=eq.active&ebay_started_at=lte.${encodeURIComponent(cutoff(180))}&ebay_started_at=gt.${encodeURIComponent(cutoff(365))}`),
      count("marketplace_listings", `&ebay_status=eq.active&ebay_started_at=lte.${encodeURIComponent(cutoff(365))}`),
    ]);
    return NextResponse.json({
      ok: true, rows: (rows || []).map((row: any) => { const ageDays=row.ebay_started_at?Math.floor((Date.now()-new Date(row.ebay_started_at).getTime())/dayMs):null; return {...row,ageDays,recommendation:recommendation(row,ageDays)}; }),
      total, page, pageSize, counts:{age90,age180,age365}, bucket, game, reviewed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aging Report failed";
    const migration = /ebay_started_at|traffic_impressions|aging_reviewed_at/i.test(message);
    return NextResponse.json({ error: migration ? "Run supabase/v1.11.5-aging-report.sql in the Supabase SQL Editor, then import from eBay once." : message, migrationRequired:migration }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action, listingId }: any = await request.json();
    if (action === "review" || action === "unreview") {
      if (!listingId) return NextResponse.json({error:"Listing ID is required"},{status:400});
      await db(`marketplace_listings?id=eq.${encodeURIComponent(String(listingId))}`, {method:"PATCH",body:JSON.stringify({aging_reviewed_at:action==="review"?new Date().toISOString():null,aging_action:action==="review"?"reviewed":null})});
      return NextResponse.json({ok:true,message:action==="review"?"Listing marked reviewed.":"Listing returned to the review queue."});
    }
    if (action === "refresh-traffic") {
      const candidates = await db(`marketplace_listings?select=id,ebay_listing_id&ebay_status=eq.active&ebay_started_at=lte.${encodeURIComponent(cutoff(90))}&order=traffic_updated_at.asc.nullsfirst&limit=200`);
      if (!candidates?.length) return NextResponse.json({ok:true,updated:0,message:"No aged listings are waiting for traffic data."});
      const token = await accessToken();
      let updated=0;
      for(let index=0;index<candidates.length;index+=50){
        const group=candidates.slice(index,index+50);
        const traffic=await getListingTraffic(token,group.map((row:any)=>String(row.ebay_listing_id)));
        const now=new Date().toISOString();
        await Promise.all(group.map((row:any)=>{
          const metric=traffic.get(String(row.ebay_listing_id))||{impressions:0,views:0,transactions:0,ctr:0,conversion:0};
          return db(`marketplace_listings?id=eq.${row.id}`,{method:"PATCH",body:JSON.stringify({traffic_impressions:metric.impressions,traffic_views:metric.views,traffic_transactions:metric.transactions,traffic_ctr:metric.ctr,traffic_conversion:metric.conversion,traffic_updated_at:now})});
        }));
        updated+=group.length;
      }
      return NextResponse.json({ok:true,updated,message:`Traffic updated for ${updated} aged listings. Run again to process the next group.`});
    }
    return NextResponse.json({error:"Unsupported Aging Report action"},{status:400});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error?error.message:"Aging Report action failed"},{status:500});
  }
}
