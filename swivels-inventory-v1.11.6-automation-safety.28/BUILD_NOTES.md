# Swivels Inventory — fresh build

## Authority rules

1. eBay listing quantity is always authoritative.
2. Supabase stores one physical SKU/location row per physical card.
3. Reconciliation compares active Supabase SKU rows to eBay quantity.
4. A mismatch never changes eBay to match Supabase.
5. An eBay order allocates the primary SKU first, exposes it as the pull location, and keeps it reserved until the user confirms shipment.
6. A Manapool sale updates eBay first; the new eBay quantity then becomes authoritative.
7. Manapool is used only for Magic listings.

## Important CSV constraint

The source CSV may contain multiple physical SKUs that later become one eBay
listing. The ingestion worker must retain each row before consolidation. If
Seller Hub exposes only the final listing SKU through the API, the original
per-copy SKUs cannot be reconstructed from the active listing alone. In that
case the exact CSV feed/export must be made available to the worker.

## Included

- Responsive dashboard, inventory, orders, Magic mapping, reconciliation, and connection views
- Fresh Supabase schema in `supabase/schema.sql`
- Environment-variable contract in `.env.example`
- Explicit eBay-master reconciliation states

The UI uses representative preview records until live credentials and the new
Supabase project are connected.
## 1.11.5-sync-control.1

- Added a dedicated Sync Control Center with live eBay and Mana Pool webhook health.
- Records webhook processing in the existing `sync_events` audit table.
- Added a recent event timeline with processing state, attempts, and error details.
- Added duplicate-safe single-event and bulk failed-event retries.
- Added on-demand quantity reconciliation and full eBay recovery import controls.
- Sync Control refreshes its Supabase-backed status every 15 seconds; it does not poll either marketplace.
## 1.11.5-sync-control.2

- Fixed Sync Control incorrectly presenting a configured eBay webhook as waiting/not connected before its first new event.
- Connection status and latest-event activity are now displayed as separate signals.
## 1.11.5-aging-report.1

- Added a safe, review-only Aging Report with 90–179, 180–364, and 365+ day queues.
- Added Pokémon/Magic and reviewed/open filters, pagination, eBay links, and review tracking.
- Added listing-level 30-day eBay Analytics traffic collection in rotating batches of 200.
- Added recommendations based on impressions, views, transactions, and listing age.
- Added the `sell.analytics.readonly` OAuth scope; reconnect eBay once after deployment.
- Run `supabase/v1.11.5-aging-report.sql`, then import from eBay once to populate original listing dates.
## 1.11.5-shipped-order-recovery.1

- Fixed missed eBay orders becoming invisible after they were shipped directly on eBay.
- Recovery now reads all non-cancelled eBay orders created within the last 72 hours, including fulfilled orders.
- Newly recovered fulfilled orders remove their sold physical SKUs and are stored as fulfilled without reappearing in the pull queue.
- Listing quantity is read directly from eBay during recovery, preventing double deductions after a catalog refresh.
- Existing app orders that were later shipped on eBay are completed and their allocated SKUs are removed automatically.
## 1.11.5-hosted-automation.1

- Moved missed-order recovery and retry processing out of the browser and into the always-running Render server process.
- Added a durable Supabase-backed event queue with atomic claims and stale-job recovery.
- Webhooks remain the immediate primary path; the worker claims unprocessed events after 20 seconds and retries failures with backoff.
- Added a two-minute recent-order safety check for webhook deliveries that never arrive.
- Added automatic eBay and Mana Pool webhook verification/repair every 30 minutes.
- Added worker heartbeat, last recovery result, and verified subscription status to Sync Control and `/api/health`.
- Removed the order import that previously ran only when somebody opened the website.
- Run `supabase/v1.11.5-hosted-automation.sql` once after deployment.

## 1.11.6-automation-safety.17

- Fixed the hosted worker exhausting eBay's Trading API quota with full-catalog imports every 10 minutes.
- Webhook events are still claimed every 15 seconds and missed orders are still checked every 2 minutes.
- Full catalog safety reconciliation now checks counts every 10 minutes and performs a full import at most every 2 hours unless the count differs.
- Coalesced bursts of ItemListed, ItemRevised, and ItemClosed notifications into one catalog import per claimed batch.
- Quantity and end-listing actions now explain that eBay made no change when its daily API quota is exhausted.

## 1.11.6-automation-safety.18

- Fixed successfully ended eBay listings being recreated in Exception Center during the immediate refresh.
- Inventory reconciliation now considers active eBay listings only in both normal imports and Exception Center refreshes.
- Existing stale exceptions for inactive/ended listings are automatically resolved the next time Exception Center loads.

## 1.11.6-automation-safety.19

- Removed duplicate full-catalog processing for ItemListed webhooks; the durable worker now owns catalog webhook imports.
- Added a 30-minute hard cooldown shared by catalog webhooks and mismatch recovery scans.
- Persistent dashboard count differences can no longer force a 60+ call catalog scan every 10 minutes.
- Lightweight eBay order recovery remains every 2 minutes and sale webhooks remain immediate.

## 1.11.6-automation-safety.20

- Fixed the Orders page visibly clearing and showing its loading state every 15 seconds.
- Live order polling now refreshes silently while the page remains visible.
- Initial page loading and manual post-action refreshes still display the normal loading state.

## 1.11.6-automation-safety.21

- Fixed refunded Mana Pool orders remaining in Orders to fulfill when refund or cancellation status is nested in the order response.
- Checks both Mana Pool order summaries and full order details for refund/cancellation state.
- A detected refund closes the stored order and releases its allocated physical SKU back to available inventory.

## 1.11.6-automation-safety.22

- Treats Mana Pool's `Replaced by a Different Order` state as a closed/voided order.
- Removes the replaced order from Orders to fulfill and releases its allocated SKU.
- Any separate replacement order remains eligible for normal import and fulfillment.

## 1.11.6-automation-safety.23

- New CSV duplicate groups now show the primary eBay SKU separately from every Supabase pull SKU.
- CSV download stays locked until all physical SKUs have been saved and verified in `pending_skus`.
- Pending SKU attachment verifies the final listing relationship before removing its queue record.
- A SKU already attached to a different listing is never silently moved or reported as saved.

## 1.11.6-automation-safety.24

- Fixed Magic `Combine as same card` appearing to do nothing while a full eBay catalog scan ran.
- The combine action now uses the synchronized records for only the selected listings and proceeds directly to eBay quantity/end-listing calls.
- Added a persistent progress, completion, or error status directly above the Mana Pool conflict list.
- Render HTML/error responses are surfaced instead of being swallowed as an unreadable JSON failure.

## 1.11.6-automation-safety.25

- Added a per-listing `Recommend changes` button beside the Aging Report actions.
- Recommendations now include title, item-specific, photo/promotion, and price guidance.
- Price suggestions use listing age and stored 30-day traffic and never go below the $1.99 floor.
- Suggestions remain review-only and never modify a live eBay listing automatically.

## 1.11.6-automation-safety.26

- Keeps Open eBay, Mark reviewed, and Recommend changes on one line at desktop widths.
- Preserves responsive wrapping on smaller screens.

## 1.11.6-automation-safety.27

- Expanded Aging Report recommendations into a full stored-listing audit.
- Checks title coverage, card identity, set, number, condition, finish, language, image, SKU, quantity, price, and traffic freshness.
- Adds a listing-quality score and an improved-title preview for every aged listing.
- Keeps all recommendations review-only and preserves the $1.99 price floor.

## 1.11.6-automation-safety.28

- Fixed false missing-data warnings when Pokémon identity exists in the eBay title but its structured Supabase columns are blank.
- Infers card name, number, set, finish, condition, and language from the current title before auditing it.
- Keeps the current eBay title when no real title issue is detected instead of rebuilding it from incomplete fields.
