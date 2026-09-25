-- Run once in Supabase SQL Editor before enabling Mana Pool.
alter table marketplace_listings add column if not exists tcgplayer_sku bigint;
alter table marketplace_listings add column if not exists manapool_lowest_cents integer;
alter table marketplace_listings add column if not exists manapool_price_cents integer;
alter table marketplace_listings add column if not exists manapool_quantity integer;
alter table marketplace_listings add column if not exists last_manapool_sync_at timestamptz;
alter table marketplace_listings add column if not exists scryfall_id uuid;
alter table marketplace_listings add column if not exists manapool_mapping_status text not null default 'pending';
alter table marketplace_listings add column if not exists manapool_mapping_candidates jsonb not null default '[]'::jsonb;
alter table marketplace_listings add column if not exists language_id text;
alter table marketplace_listings add column if not exists finish_id text;
alter table marketplace_listings add column if not exists condition_id text;
create index if not exists marketplace_listings_scryfall_id_idx on marketplace_listings(scryfall_id) where scryfall_id is not null;
create index if not exists marketplace_listings_tcgplayer_sku_idx on marketplace_listings(tcgplayer_sku) where tcgplayer_sku is not null;

alter table marketplace_orders drop constraint if exists marketplace_orders_marketplace_check;
alter table marketplace_orders add constraint marketplace_orders_marketplace_check check (marketplace in ('ebay','manapool'));
