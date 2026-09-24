const baseUrl = "https://manapool.com/api/v1";

export function manaPoolConfigured() {
  return Boolean(process.env.MANAPOOL_API_TOKEN);
}

export function manaPoolSyncEnabled() {
  return process.env.MANAPOOL_SYNC_ENABLED === "true";
}

export async function manaPool(path: string, init: RequestInit = {}) {
  const token = process.env.MANAPOOL_API_TOKEN;
  if (!token) throw new Error("MANAPOOL_API_TOKEN is missing in Render");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Mana Pool ${response.status}: ${body?.message || text || "Request failed"}`);
  return body;
}

export function manaPoolPrice(lowestCents: number) {
  return Math.max(40, Math.ceil(Math.max(0, lowestCents) * 1.3));
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
