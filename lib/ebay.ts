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

function bestEbayImage(item: any) {
  const textValue = (value: any) => typeof value === "string" ? value : value?.["#text"] ? String(value["#text"]) : "";
  const pictureUrls = arr<any>(item.PictureDetails?.PictureURL).map(textValue).filter(Boolean);
  const original = pictureUrls[0] || textValue(item.PictureDetails?.GalleryURL);
  if (!original) return null;
  // eBay uses both modern /s-l### image paths and older /$_#.JPG paths.
  // Convert either thumbnail form to its high-resolution listing rendition.
  return original
    .replace(/\/s-l\d+\.(jpg|jpeg|png|webp)/i, "/s-l1600.$1")
    .replace(/\/\$_\d+\.(jpg|jpeg|png|webp)/i, "/$_57.$1");
}

export type EbayListing = {
  ebay_listing_id: string; ebay_sku: string | null; title: string; game: "pokemon" | "magic" | "other";
  set_name: string | null; price: number; ebay_quantity: number; ebay_status: "active"; image_url: string | null;
  last_ebay_sync_at: string; updated_at: string;
  card_name: string | null; card_number: string | null; finish: string | null;
  language: string | null; condition_name: string | null; parallel_variety: string | null; match_key: string | null;
  started_at: string | null;
};

const specificMap = (item: any) => {
  const map = new Map<string, string>();
  for (const row of arr<any>(item.ItemSpecifics?.NameValueList)) {
    const value = arr<any>(row.Value).map(String).join(", ");
    map.set(String(row.Name || "").toLowerCase(), value);
  }
  return map;
};

async function getMagicSinglesStoreCategoryIds(token: string) {
  // Swivels Card Shop's exact eBay Store category. Keeping this explicit prevents
  // the Magic parent category (and its sealed-products child) from being synced.
  const matches = new Set<string>(["45236711016", "name:magic the gathering singles"]);
  const xml = `<?xml version="1.0" encoding="utf-8"?><GetStoreRequest xmlns="urn:ebay:apis:eBLBaseComponents"><CategoryStructureOnly>true</CategoryStructureOnly></GetStoreRequest>`;
  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST", cache: "no-store",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetStore", "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423", "X-EBAY-API-IAF-TOKEN": token,
      "Content-Type": "text/xml",
    }, body: xml,
  });
  const text = await response.text();
  if (!response.ok) return matches;
  const parsed: any = new XMLParser({ ignoreAttributes: false, parseTagValue: true }).parse(text)?.GetStoreResponse;
  if (!["Success", "Warning"].includes(parsed?.Ack)) return matches;
  const visit = (category: any) => {
    if (!category) return;
    const name = String(category.Name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (name === "magic the gathering singles") {
      matches.add(String(category.CategoryID));
      matches.add(`name:${name}`);
    }
    for (const child of arr<any>(category.ChildCategory)) visit(child);
  };
  for (const category of arr<any>(parsed?.Store?.CustomCategories?.CustomCategory)) visit(category);
  return matches;
}

async function getActiveStoreCategoryIds(token: string) {
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const categoryByItemId = new Map<string, string[]>();
  const endFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endTo = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
  let page = 1;
  let more = true;
  while (more) {
    const xml = `<?xml version="1.0" encoding="utf-8"?><GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><EndTimeFrom>${endFrom}</EndTimeFrom><EndTimeTo>${endTo}</EndTimeTo><IncludeWatchCount>false</IncludeWatchCount><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></GetSellerListRequest>`;
    const response = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST", cache: "no-store",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetSellerList", "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1423", "X-EBAY-API-IAF-TOKEN": token,
        "Content-Type": "text/xml",
      }, body: xml,
    });
    const text = await response.text();
    if (!response.ok) break;
    const parsed: any = parser.parse(text)?.GetSellerListResponse;
    if (!["Success", "Warning"].includes(parsed?.Ack)) break;
    for (const item of arr<any>(parsed?.ItemArray?.Item)) {
      if (!item?.ItemID) continue;
      const ids = [item.Storefront?.StoreCategoryID, item.Storefront?.StoreCategory2ID]
        .filter(Boolean).map(String);
      const names = [item.Storefront?.StoreCategoryName, item.Storefront?.StoreCategory2Name]
        .filter(Boolean)
        .map((name) => `name:${String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`);
      categoryByItemId.set(String(item.ItemID), [...ids, ...names]);
    }
    const totalPages = Number(parsed?.PaginationResult?.TotalNumberOfPages || page);
    more = page < totalPages;
    page += 1;
  }
  return categoryByItemId;
}

export async function getActiveListings(token: string) {
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const results: EbayListing[] = [];
  const magicSinglesStoreCategoryIds = await getMagicSinglesStoreCategoryIds(token);
  const sellerListStoreCategories = await getActiveStoreCategoryIds(token);
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
      const gameSpecific = String(specifics.get("game") || "").toLowerCase();
      const categoryId = String(item.PrimaryCategory?.CategoryID || "");
      const categoryName = String(item.PrimaryCategory?.CategoryName || "").toLowerCase();
      const sealedTerms = /\b(booster box|booster pack|bundle|collection box|collector booster|draft booster|set booster|play booster|starter kit|commander deck|precon|sealed case|fat pack|theme deck)\b/;
      const isSealedMagic = categoryName.includes("sealed") || sealedTerms.test(lower);
      const isMagic = gameSpecific.includes("magic") || gameSpecific === "mtg" || lower.includes("magic: the gathering") || /\bmtg\b/.test(lower);
      const isSingleCardCategory = categoryId === "183454" || /\b(individual|single|singles)\b/.test(categoryName) ||
        (/\b(card|cards)\b/.test(categoryName) && !/\b(sealed|pack|box|deck|lot|set)\b/.test(categoryName));
      const hasCardIdentity = Boolean(
        specifics.get("card name") || specifics.get("card number") || specifics.get("collector number") || specifics.get("set number")
      ) || /\b\d{1,4}[a-z]?\s*\/\s*\d{1,4}\b/i.test(title);
      const fallbackStoreCategories = [item.Storefront?.StoreCategoryID, item.Storefront?.StoreCategory2ID]
        .filter(Boolean).map(String);
      fallbackStoreCategories.push(...[item.Storefront?.StoreCategoryName, item.Storefront?.StoreCategory2Name]
        .filter(Boolean)
        .map((name) => `name:${String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`));
      const storeCategoryIds = sellerListStoreCategories.get(String(item.ItemID)) || fallbackStoreCategories;
      const isMagicStoreSingle = storeCategoryIds.some((id) => magicSinglesStoreCategoryIds.has(id));
      const hasInventorySku = Boolean(String(item.SKU || "").trim());
      const magicEligible = isMagicStoreSingle || (isMagic && !isSealedMagic && hasInventorySku);
      const game: EbayListing["game"] = magicEligible
        ? "magic"
        : gameSpecific.includes("pokemon") || gameSpecific.includes("pokémon") || lower.includes("pokemon") || lower.includes("pokémon") ? "pokemon" : "other";
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
        game,
        set_name: identity.setName, card_name: identity.cardName, card_number: identity.cardNumber,
        finish: identity.finish, language: identity.language, condition_name: identity.condition,
        parallel_variety: identity.parallel, match_key: cardMatchKey(identity) || null,
        price: Number(item.SellingStatus?.CurrentPrice?.["#text"] ?? item.SellingStatus?.CurrentPrice ?? 0),
        ebay_quantity: quantity, ebay_status: "active", image_url: bestEbayImage(item),
        last_ebay_sync_at: now, updated_at: now,
        started_at: item.ListingDetails?.StartTime ? String(item.ListingDetails.StartTime) : null,
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
  const parsed: any = new XMLParser({ ignoreAttributes: false }).parse(text);
  return parsed?.[`${callName}Response`];
}

export async function configureEbayWebhooks(callbackUrl: string) {
  if (!/^https:\/\//i.test(callbackUrl)) throw new Error("eBay webhook URL must use HTTPS");
  // eBay requires the seller's event subscriptions and the application's
  // delivery URL to be set in separate calls.
  await tradingCall("SetNotificationPreferences", `<?xml version="1.0" encoding="utf-8"?>
    <SetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <UserDeliveryPreferenceArray>
        <NotificationEnable><EventType>FixedPriceTransaction</EventType><EventEnable>Enable</EventEnable></NotificationEnable>
        <NotificationEnable><EventType>ItemListed</EventType><EventEnable>Enable</EventEnable></NotificationEnable>
      </UserDeliveryPreferenceArray>
    </SetNotificationPreferencesRequest>`);
  await tradingCall("SetNotificationPreferences", `<?xml version="1.0" encoding="utf-8"?>
    <SetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <ApplicationDeliveryPreferences>
        <ApplicationEnable>Enable</ApplicationEnable>
        <ApplicationURL>${xmlEscape(callbackUrl)}</ApplicationURL>
        <PayloadVersion>1423</PayloadVersion>
      </ApplicationDeliveryPreferences>
    </SetNotificationPreferencesRequest>`);
  return getEbayWebhookStatus(callbackUrl);
}

const xmlValue = (value:any) => String(value?.["#text"] ?? value ?? "");

export async function getEbayWebhookStatus(expectedUrl?:string) {
  const [application,user]=await Promise.all([
    tradingCall("GetNotificationPreferences",`<?xml version="1.0" encoding="utf-8"?><GetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><PreferenceLevel>Application</PreferenceLevel></GetNotificationPreferencesRequest>`),
    tradingCall("GetNotificationPreferences",`<?xml version="1.0" encoding="utf-8"?><GetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><PreferenceLevel>User</PreferenceLevel></GetNotificationPreferencesRequest>`),
  ]);
  const applicationUrl=xmlValue(application?.ApplicationDeliveryPreferences?.ApplicationURL);
  const applicationEnabled=xmlValue(application?.ApplicationDeliveryPreferences?.ApplicationEnable).toLowerCase()==="enable";
  const preferences=arr<any>(user?.UserDeliveryPreferenceArray?.NotificationEnable);
  const enabled=new Map(preferences.map((x:any)=>[xmlValue(x.EventType),xmlValue(x.EventEnable).toLowerCase()==="enable"]));
  const fixedPriceTransaction=enabled.get("FixedPriceTransaction")===true;
  const itemListed=enabled.get("ItemListed")===true;
  const urlMatches=!expectedUrl||applicationUrl.replace(/\/$/,"")===expectedUrl.replace(/\/$/,"");
  return {live:applicationEnabled&&urlMatches&&fixedPriceTransaction&&itemListed,applicationEnabled,applicationUrl,urlMatches,fixedPriceTransaction,itemListed};
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
  // Prefer the modern Fulfillment API. Some eBay seller accounts have
  // intermittently returned an empty result (or rejected its status filter),
  // so an empty/error response is verified against Trading GetOrders below.
  const filter = encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");
  const orders: any[] = [];
  let offset = 0;
  try {
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
  } catch (error) {
    console.warn("eBay Fulfillment order feed failed; checking Trading GetOrders", error);
  }
  if (orders.length) return orders;

  const tradingOrders: any[] = [];
  let page = 1;
  while (page <= 10) {
    const root: any = await tradingCall("GetOrders", `<?xml version="1.0" encoding="utf-8"?>
      <GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <NumberOfDays>30</NumberOfDays>
        <OrderRole>Seller</OrderRole>
        <OrderStatus>All</OrderStatus>
        <Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>
      </GetOrdersRequest>`);
    const batch = arr<any>(root?.OrderArray?.Order);
    for (const order of batch) {
      const cancelState = xmlValue(order.CancelStatus).toUpperCase();
      const paid = Boolean(xmlValue(order.PaidTime)) || xmlValue(order.CheckoutStatus?.Status).toUpperCase() === "COMPLETE";
      const shipped = Boolean(xmlValue(order.ShippedTime));
      if (!paid || shipped || ["CANCELLED", "CANCELED", "CANCELPENDING", "CANCELCOMPLETE"].includes(cancelState)) continue;
      const transactions = arr<any>(order.TransactionArray?.Transaction);
      const lineItems = transactions
        .filter((transaction: any) => !xmlValue(transaction.ShippedTime))
        .map((transaction: any) => ({
          lineItemId: xmlValue(transaction.OrderLineItemID) || `${xmlValue(transaction.Item?.ItemID)}-${xmlValue(transaction.TransactionID)}`,
          legacyItemId: xmlValue(transaction.Item?.ItemID),
          quantity: Math.max(1, Number(xmlValue(transaction.QuantityPurchased) || 1)),
          lineItemFulfillmentStatus: "NOT_STARTED",
          lineItemCost: {
            value: xmlValue(transaction.TransactionPrice),
            currency: transaction.TransactionPrice?.["@currencyID"] || "USD",
          },
        }))
        .filter((line: any) => line.legacyItemId);
      if (!lineItems.length) continue;
      tradingOrders.push({
        orderId: xmlValue(order.OrderID),
        creationDate: xmlValue(order.CreatedTime) || new Date().toISOString(),
        orderFulfillmentStatus: "NOT_STARTED",
        cancelStatus: { cancelState },
        pricingSummary: {
          total: { value: xmlValue(order.Total), currency: order.Total?.["@currencyID"] || "USD" },
        },
        lineItems,
      });
    }
    const totalPages = Number(xmlValue(root?.PaginationResult?.TotalNumberOfPages) || 1);
    if (page >= totalPages || !batch.length) break;
    page += 1;
  }
  return tradingOrders;
}

export async function getOrder(token: string, orderId: string) {
  if (!orderId || orderId.length > 100) throw new Error("Invalid eBay order ID");
  const response = await fetch(`https://api.ebay.com/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID || "EBAY_US" },
  });
  const body: any = await response.json();
  if (!response.ok) throw new Error(`eBay order ${orderId} request failed: ${body.errors?.[0]?.message || response.status}`);
  return body;
}

export async function getListingImage(itemId: string) {
  if (!/^\d+$/.test(itemId)) throw new Error("Invalid eBay listing ID");
  const token = await accessToken();
  const xml = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${xmlEscape(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>false</IncludeItemSpecifics></GetItemRequest>`;
  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST", cache: "no-store",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetItem", "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423", "X-EBAY-API-IAF-TOKEN": token,
      "Content-Type": "text/xml",
    }, body: xml,
  });
  const text = await response.text();
  const parsed: any = new XMLParser({ ignoreAttributes: false, parseTagValue: true }).parse(text)?.GetItemResponse;
  if (!response.ok || !["Success", "Warning"].includes(parsed?.Ack)) throw new Error("Could not load the eBay listing image");
  const image = bestEbayImage(parsed?.Item);
  if (!image) throw new Error("This eBay listing has no image");
  const host = new URL(image).hostname.toLowerCase();
  if (host !== "i.ebayimg.com" && !host.endsWith(".ebayimg.com")) throw new Error("Unexpected eBay image host");
  return image;
}
