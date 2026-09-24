const baseUrl = "https://manapool.com/api/v1";

export function manaPoolConfigured() {
  return Boolean(process.env.MANAPOOL_API_TOKEN && process.env.MANAPOOL_API_EMAIL);
}

export function manaPoolSyncEnabled() {
  return process.env.MANAPOOL_SYNC_ENABLED === "true";
}

export async function manaPool(path: string, init: RequestInit = {}) {
  const token = process.env.MANAPOOL_API_TOKEN?.trim();
  const email = process.env.MANAPOOL_API_EMAIL?.trim();
  if (!token || !email) throw new Error("MANAPOOL_API_TOKEN and MANAPOOL_API_EMAIL are required in Render");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "X-ManaPool-Access-Token": token,
      "X-ManaPool-Email": email,
      "User-Agent": "Swivels-Inventory/1.10.20",
      Accept: "application/json",
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
