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
