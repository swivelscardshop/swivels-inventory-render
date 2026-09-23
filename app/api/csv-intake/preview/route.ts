import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { csvIdentity, cardMatchKey } from "@/lib/matching";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a Card Uploader CSV file");
    if (file.size > 15_000_000) throw new Error("CSV is larger than the 15 MB safety limit");
    const text = await file.text();
    const headerRows = parse(text, { bom: true, to_line: 1, relax_quotes: true }) as string[][];
    const headers = headerRows[0] || [];
    const required = ["*Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)", "*Title", "CustomLabel", "*Quantity", "*C:Set", "*C:Card Name", "*C:Card Number"];
    for (const name of required) if (!headers.includes(name)) throw new Error(`CSV is missing required column: ${name}`);
    const rows = parse(text, { bom: true, columns: true, skip_empty_lines: true, relax_quotes: true }) as Record<string, string>[];
    const listings = await db("marketplace_listings?select=id,ebay_listing_id,title,ebay_sku,ebay_quantity,price,match_key&ebay_status=eq.active&match_key=not.is.null&limit=10000");
    const existingByKey = new Map<string, any[]>();
    for (const listing of listings || []) if (listing.match_key) existingByKey.set(listing.match_key, [...(existingByKey.get(listing.match_key) || []), listing]);

    const incoming = new Map<string, Record<string, string>[]>();
    const invalid: any[] = [];
    for (const row of rows) {
      const key = cardMatchKey(csvIdentity(row));
      if (!key || !row.CustomLabel) { invalid.push({ title: row["*Title"], sku: row.CustomLabel, reason: "Missing card identity or CustomLabel" }); continue; }
      incoming.set(key, [...(incoming.get(key) || []), row]);
    }

    const matches: any[] = [], pending: any[] = [], conflicts: any[] = [], newOutput: Record<string, string>[] = [];
    for (const [key, group] of incoming) {
      const existing = existingByKey.get(key) || [];
      if (existing.length > 1) {
        conflicts.push({ matchKey: key, title: group[0]["*Title"], skus: group.map(x => x.CustomLabel), listings: existing });
        continue;
      }
      if (existing.length === 1) {
        for (const row of group) matches.push({ matchKey: key, listingId: existing[0].id, ebayListingId: existing[0].ebay_listing_id, existingTitle: existing[0].title, existingQuantity: existing[0].ebay_quantity, sku: row.CustomLabel, location: row.CustomLabel, incomingTitle: row["*Title"] });
        continue;
      }
      const first = { ...group[0] };
      first["*Quantity"] = String(group.reduce((sum, row) => sum + Math.max(1, Number(row["*Quantity"] || 1)), 0));
      newOutput.push(first);
      for (const row of group) pending.push({ matchKey: key, sku: row.CustomLabel, location: row.CustomLabel, title: row["*Title"] });
    }
    const newCsv = stringify(newOutput, { header: true, columns: headers, quoted: true, record_delimiter: "\r\n" });
    return NextResponse.json({ fileName: file.name.replace(/\.csv$/i, "") + "_NEW-LISTINGS-ONLY.csv", totalRows: rows.length, newListings: newOutput.length, newCopies: pending.length, matchedCopies: matches.length, conflicts, invalid, matches, pending, newCsv });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CSV preview failed" }, { status: 400 });
  }
}
