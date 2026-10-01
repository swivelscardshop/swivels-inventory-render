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
