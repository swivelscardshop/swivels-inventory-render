import { XMLParser } from "fast-xml-parser";
import { db } from "@/lib/supabase";
import { cardMatchKey } from "@/lib/matching";

const clientId = () => process.env.EBAY_CLIENT_ID || "";
const clientSecret = () => process.env.EBAY_CLIENT_SECRET || "";
const ruName = () => process.env.EBAY_RU_NAME || "";

export function ebayAppConfigured() {
  return Boolean(clientId() && clientSecret() && ruName());
}

export async function getRefreshToken() {
  if (process.env.EBAY_REFRESH_TOKEN) return process.env.EBAY_REFRESH_TOKEN;
  try {
    const rows = await db("app_secrets?select=value&key=eq.ebay_refresh_token&limit=1");
    return rows?.[0]?.value || "";
  } catch {
    return "";
  }
}

export async function ebayConfigured() {
  return Boolean(clientId() && clientSecret() && await getRefreshToken());
}

export async function accessToken() {
  const refreshToken = await getRefreshToken();
  if (!clientId() || !clientSecret() || !refreshToken) throw new Error("Connect eBay before importing");
  const auth = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    cache: "no-store",
  });
  const body: any = await response.json();
  if (!response.ok) throw new Error(`eBay authorization failed: ${body.error_description || body.error || response.status}`);
  return body.access_token as string;
}

const oauthScopes = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
];

export function ebayAuthorizationUrl(state: string) {
  if (!ebayAppConfigured()) throw new Error("Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_RU_NAME in Render");
  const query = new URLSearchParams({
    client_id: clientId(), redirect_uri: ruName(), response_type: "code",
    scope: oauthScopes.join(" "), state,
  });
  return `https://auth.ebay.com/oauth2/authorize?${query}`;
}

export async function exchangeAuthorizationCode(code: string) {
  if (!ebayAppConfigured()) throw new Error("eBay OAuth application settings are incomplete");
  const auth = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ruName() }),
  });
  const body: any = await response.json();
  if (!response.ok || !body.refresh_token) throw new Error(body.error_description || body.error || "eBay did not return a refresh token");
  return body.refresh_token as string;
}

const arr = <T>(value: T | T[] | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value];

export type EbayListing = {
  ebay_listing_id: string; ebay_sku: string | null; title: string; game: "pokemon" | "magic" | "other";
  set_name: string | null; price: number; ebay_quantity: number; ebay_status: "active"; image_url: string | null;
  last_ebay_sync_at: string; updated_at: string;
  card_name: string | null; card_number: string | null; finish: string | null;
  language: string | null; condition_name: string | null; parallel_variety: string | null; match_key: string | null;
};

const specificMap = (item: any) => {
  const map = new Map<string, string>();
  for (const row of arr<any>(item.ItemSpecifics?.NameValueList)) {
    const value = arr<any>(row.Value).map(String).join(", ");
    map.set(String(row.Name || "").toLowerCase(), value);
  }
  return map;
};

export async function getActiveListings(token: string) {
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const results: EbayListing[] = [];
  let page = 1, more = true;
  while (more) {
    const xml = `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><DetailLevel>ReturnAll</DetailLevel></GetMyeBaySellingRequest>`;
    const response = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST", cache: "no-store",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling", "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1423", "X-EBAY-API-IAF-TOKEN": token,
        "Content-Type": "text/xml",
      }, body: xml,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`eBay listings request failed (${response.status})`);
    const parsed = parser.parse(text).GetMyeBaySellingResponse;
    if (!parsed || !["Success", "Warning"].includes(parsed.Ack)) {
      const error = arr(parsed?.Errors).map((x: any) => x.LongMessage || x.ShortMessage).filter(Boolean).join("; ");
      throw new Error(error || "eBay returned an unknown listings error");
    }
    const items = arr<any>(parsed.ActiveList?.ItemArray?.Item);
    const now = new Date().toISOString();
    for (const item of items) {
      const title = String(item.Title || "Untitled listing");
      const lower = title.toLowerCase();
      const specifics = specificMap(item);
      const quantity = Math.max(0, Number(item.Quantity || 0) - Number(item.SellingStatus?.QuantitySold || 0));
      const identity = {
        title, game: specifics.get("game") || (lower.includes("magic") || lower.includes("mtg") ? "Magic" : "Pokémon TCG"),
        setName: specifics.get("set") || null, cardName: specifics.get("card name") || null,
        cardNumber: specifics.get("card number") || null, finish: specifics.get("finish") || null,
        language: specifics.get("language") || null,
        condition: specifics.get("card condition") || item.ConditionDisplayName || null,
        parallel: specifics.get("parallel/variety") || null,
      };
      results.push({
        ebay_listing_id: String(item.ItemID), ebay_sku: item.SKU ? String(item.SKU) : null, title,
        game: lower.includes("magic") || lower.includes("mtg") ? "magic" : lower.includes("pokemon") || lower.includes("pokémon") ? "pokemon" : "other",
        set_name: identity.setName, card_name: identity.cardName, card_number: identity.cardNumber,
        finish: identity.finish, language: identity.language, condition_name: identity.condition,
        parallel_variety: identity.parallel, match_key: cardMatchKey(identity) || null,
        price: Number(item.SellingStatus?.CurrentPrice?.["#text"] ?? item.SellingStatus?.CurrentPrice ?? 0),
        ebay_quantity: quantity, ebay_status: "active", image_url: item.PictureDetails?.GalleryURL || null,
        last_ebay_sync_at: now, updated_at: now,
      });
    }
    const totalPages = Number(parsed.ActiveList?.PaginationResult?.TotalNumberOfPages || 1);
    more = page < totalPages;
    page += 1;
    if (page > 100) throw new Error("Stopped after 20,000 listings for safety");
  }
  return results;
}

const xmlEscape = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

async function tradingCall(callName: string, xml: string) {
  const token = await accessToken();
  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST", cache: "no-store",
    headers: { "X-EBAY-API-CALL-NAME": callName, "X-EBAY-API-SITEID": "0", "X-EBAY-API-COMPATIBILITY-LEVEL": "1423", "X-EBAY-API-IAF-TOKEN": token, "Content-Type": "text/xml" },
    body: xml,
  });
  const text = await response.text();
  if (!response.ok || !/<Ack>(Success|Warning)<\/Ack>/.test(text)) {
    const parsed: any = new XMLParser({ ignoreAttributes: false }).parse(text);
    const root = parsed?.[`${callName}Response`];
    const message = arr<any>(root?.Errors).map(x => x.LongMessage || x.ShortMessage).filter(Boolean).join("; ");
    throw new Error(message || `eBay ${callName} failed (${response.status})`);
  }
}

export async function reviseListingQuantity(itemId: string, quantity: number) {
  if (!/^\d+$/.test(itemId) || !Number.isInteger(quantity) || quantity < 0) throw new Error("Invalid eBay quantity update");
  return tradingCall("ReviseInventoryStatus", `<?xml version="1.0" encoding="utf-8"?><ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents"><InventoryStatus><ItemID>${xmlEscape(itemId)}</ItemID><Quantity>${quantity}</Quantity></InventoryStatus></ReviseInventoryStatusRequest>`);
}

export async function endListing(itemId: string) {
  if (!/^\d+$/.test(itemId)) throw new Error("Invalid eBay listing ID");
  return tradingCall("EndFixedPriceItem", `<?xml version="1.0" encoding="utf-8"?><EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${xmlEscape(itemId)}</ItemID><EndingReason>NotAvailable</EndingReason></EndFixedPriceItemRequest>`);
}

export async function getOpenOrders(token: string) {
  const filter = encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");
  const orders: any[] = [];
  let offset = 0;
  while (true) {
    const response = await fetch(`https://api.ebay.com/sell/fulfillment/v1/order?filter=${filter}&limit=200&offset=${offset}`, {
      cache: "no-store", headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID || "EBAY_US" },
    });
    const body: any = await response.json();
    if (!response.ok) throw new Error(`eBay orders request failed: ${body.errors?.[0]?.message || response.status}`);
    orders.push(...(body.orders || []));
    offset += body.orders?.length || 0;
    if (!body.next || !body.orders?.length) break;
  }
  return orders;
}
