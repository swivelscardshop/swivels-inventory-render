import { Readable } from "node:stream";
import { parse } from "csv-parse";

const baseUrl = "https://manapool.com/api/v1";

function manaPoolCredentials() {
  const token = process.env.MANAPOOL_API_TOKEN?.trim();
  const email = process.env.MANAPOOL_API_EMAIL?.trim();
  if (!token || !email) throw new Error("MANAPOOL_API_TOKEN and MANAPOOL_API_EMAIL are required in Render");
  return { token, email };
}

function manaPoolHeaders(accept = "application/json") {
  const { token, email } = manaPoolCredentials();
  return {
    "X-ManaPool-Access-Token": token,
    "X-ManaPool-Email": email,
    "User-Agent": "Swivels-Inventory/1.10.22",
    Accept: accept,
  };
}

export function manaPoolConfigured() {
  return Boolean(process.env.MANAPOOL_API_TOKEN && process.env.MANAPOOL_API_EMAIL);
}

export function manaPoolSyncEnabled() {
  return process.env.MANAPOOL_SYNC_ENABLED === "true";
}

export async function manaPool(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...manaPoolHeaders(),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (/<!doctype|<html/i.test(text) || contentType.includes("text/html")) {
        throw new Error(`Mana Pool returned a webpage instead of API data (${response.status}). Verify MANAPOOL_API_EMAIL and MANAPOOL_API_TOKEN in Render, then redeploy.`);
      }
      throw new Error(`Mana Pool returned an unreadable API response (${response.status}, ${contentType || "unknown content type"}).`);
    }
  }
  if (!response.ok) throw new Error(`Mana Pool ${response.status}: ${body?.message || text || "Request failed"}`);
  return body;
}

export function manaPoolPrice(lowestCents: number) {
  const lowest = Math.max(0, Math.round(lowestCents));
  return lowest <= 40 ? 40 : Math.ceil(lowest * 1.3);
}

export type ManaPoolVariantPrice = {
  scryfall_id: string;
  language_id: string;
  condition_id: string | null;
  finish_id: string | null;
  low_price: number;
  available_quantity: number;
};

export type ManaPoolSinglePrice = {
  scryfall_id: string;
  price_cents: number | null;
  price_cents_foil: number | null;
  price_cents_etched: number | null;
};

export async function getManaPoolSinglePrices(): Promise<ManaPoolSinglePrice[]> {
  const body = await manaPool("/prices/singles");
  if (!Array.isArray(body?.data)) throw new Error("Mana Pool returned an invalid singles price list");
  return body.data;
}

export async function getManaPoolSinglePricesFor(scryfallIds: Iterable<string>) {
  const wanted = new Set(Array.from(scryfallIds, (id) => String(id).toLowerCase()));
  const found = new Map<string, ManaPoolSinglePrice>();
  if (!wanted.size) return found;
  const response = await fetch(`${baseUrl}/prices/singles`, {
    cache:"no-store",
    headers:manaPoolHeaders("text/csv"),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !response.body || contentType.includes("text/html")) {
    const detail = (await response.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`Mana Pool price download failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const rows = Readable.fromWeb(response.body as any).pipe(parse({ columns:true, bom:true, relax_column_count:true, skip_empty_lines:true }));
  for await (const row of rows) {
    const id = String(row.scryfall_id || "").toLowerCase();
    if (!wanted.has(id)) continue;
    const cents = (value:any) => value === "" || value == null ? null : Number(value);
    found.set(id, {
      scryfall_id:id,
      price_cents:cents(row.price_cents),
      price_cents_foil:cents(row.price_cents_foil),
      price_cents_etched:cents(row.price_cents_etched),
    });
  }
  return found;
}

export function lowestManaPoolPriceForFinish(row: ManaPoolSinglePrice, finishId: string) {
  const finish = String(finishId || "NF").toUpperCase();
  const value = finish === "FO" ? row.price_cents_foil : finish === "EF" ? row.price_cents_etched : row.price_cents;
  const cents = Number(value);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

export async function getManaPoolVariantPrices(): Promise<ManaPoolVariantPrice[]> {
  const body = await manaPool("/prices/variants");
  if (!Array.isArray(body?.data)) throw new Error("Mana Pool returned an invalid variant price list");
  return body.data;
}

export function manaPoolVariantPriceKey(value: {
  scryfall_id: string;
  language_id?: string | null;
  condition_id?: string | null;
  finish_id?: string | null;
}) {
  return [value.scryfall_id, value.language_id || "EN", value.condition_id || "NM", value.finish_id || "NF"]
    .map((part) => String(part).trim().toUpperCase())
    .join("|");
}

export async function getManaPoolOrders() {
  const all: any[] = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ needs_shipping: "true", limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = await manaPool(`/seller/orders?${query}`);
    all.push(...(page?.orders || []));
    cursor = page?.pagination?.next_cursor || "";
  } while (cursor && all.length < 10000);
  return all;
}

export async function registerManaPoolWebhook(callbackUrl:string) {
  return manaPool("/webhooks/register", {method:"PUT",body:JSON.stringify({topic:"order_created",callback_url:callbackUrl})});
}

export async function listManaPoolWebhooks() {
  return manaPool("/webhooks?topic=order_created");
}

export async function getManaPoolOrder(id: string) {
  return manaPool(`/seller/orders/${encodeURIComponent(id)}`);
}

export type ManaPoolScryfallInventory = {
  scryfall_id: string;
  language_id: string;
  finish_id: string;
  condition_id: string;
  price_cents: number | null;
  quantity: number | null;
  custom_external_id?: string | null;
};

export async function setManaPoolInventory(rows: ManaPoolScryfallInventory[]) {
  if (!manaPoolSyncEnabled()) throw new Error("Mana Pool live sync is disabled. Set MANAPOOL_SYNC_ENABLED=true after reviewing the preview.");
  return manaPool("/seller/inventory/scryfall_id", { method: "POST", body: JSON.stringify(rows) });
}

export async function fulfillManaPoolOrder(id: string, tracking?: { company?: string; number?: string; url?: string }) {
  if (!manaPoolSyncEnabled()) throw new Error("Mana Pool live sync is disabled");
  return manaPool(`/seller/orders/${encodeURIComponent(id)}/fulfillment`, {
    method: "PUT",
    body: JSON.stringify({
      status: tracking?.number ? "in_transit" : "fulfilled",
      tracking_company: tracking?.company || null,
      tracking_number: tracking?.number || null,
      tracking_url: tracking?.url || null,
      in_transit_at: new Date().toISOString(),
    }),
  });
}
