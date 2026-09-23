-- Non-destructive upgrade for Duplicate Center, CSV Intake, and order locations.
alter table public.marketplace_listings add column if not exists card_name text;
alter table public.marketplace_listings add column if not exists card_number text;
alter table public.marketplace_listings add column if not exists finish text;
alter table public.marketplace_listings add column if not exists language text;
alter table public.marketplace_listings add column if not exists condition_name text;
alter table public.marketplace_listings add column if not exists parallel_variety text;
alter table public.marketplace_listings add column if not exists match_key text;

alter table public.marketplace_orders add column if not exists order_title text;
alter table public.marketplace_orders add column if not exists pull_sku text;
alter table public.marketplace_orders add column if not exists pull_location text;
alter table public.marketplace_orders add column if not exists sku_removed_at timestamptz;
alter table public.marketplace_orders drop constraint if exists marketplace_orders_listing_id_fkey;
alter table public.marketplace_orders add constraint marketplace_orders_listing_id_fkey
  foreign key (listing_id) references public.marketplace_listings(id) on delete set null;

create table if not exists public.pending_skus (
  id uuid primary key default gen_random_uuid(),
  match_key text not null,
  sku text not null unique,
  location_label text not null,
  source text not null default 'csv_intake',
  created_at timestamptz not null default now()
);

create index if not exists marketplace_listings_match_key_idx
  on public.marketplace_listings(match_key) where ebay_status = 'active';
create index if not exists pending_skus_match_key_idx on public.pending_skus(match_key);
alter table public.pending_skus enable row level security;
