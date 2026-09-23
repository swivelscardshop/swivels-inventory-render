-- Run once in Supabase SQL Editor before enabling Mana Pool.
alter table marketplace_listings add column if not exists tcgplayer_sku bigint;
alter table marketplace_listings add column if not exists manapool_lowest_cents integer;
alter table marketplace_listings add column if not exists manapool_price_cents integer;
alter table marketplace_listings add column if not exists manapool_quantity integer;
alter table marketplace_listings add column if not exists last_manapool_sync_at timestamptz;
create index if not exists marketplace_listings_tcgplayer_sku_idx on marketplace_listings(tcgplayer_sku) where tcgplayer_sku is not null;

alter table marketplace_orders drop constraint if exists marketplace_orders_marketplace_check;
alter table marketplace_orders add constraint marketplace_orders_marketplace_check check (marketplace in ('ebay','manapool'));
