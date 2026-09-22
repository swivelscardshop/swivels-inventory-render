-- Fresh Swivels Inventory schema. Run only against the new Supabase project.
create extension if not exists pgcrypto;

create table if not exists app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- This project is intentionally a clean rebuild. Running this file clears only
-- the inventory-system objects in this Supabase project.
drop view if exists listing_reconciliation;
drop table if exists order_allocations cascade;
drop table if exists marketplace_orders cascade;
drop table if exists reconciliation_issues cascade;
drop table if exists sync_events cascade;
drop table if exists physical_skus cascade;
drop table if exists marketplace_listings cascade;

create table marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  ebay_listing_id text not null unique,
  ebay_sku text,
  title text not null,
  game text not null check (game in ('pokemon','magic','other')),
  set_name text,
  price numeric(12,2),
  ebay_quantity integer not null default 0 check (ebay_quantity >= 0),
  ebay_status text not null default 'active',
  image_url text,
  last_ebay_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table physical_skus (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references marketplace_listings(id) on delete cascade,
  sku text not null unique,
  location_label text not null,
  status text not null default 'available'
    check (status in ('available','allocated','sold','removed','review')),
  source text not null default 'ebay_csv',
  source_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace = 'ebay'),
  marketplace_order_id text not null,
  listing_id uuid references marketplace_listings(id),
  quantity integer not null check (quantity > 0),
  fulfillment_status text not null default 'unfulfilled',
  refunded boolean not null default false,
  ordered_at timestamptz not null,
  raw_payload jsonb,
  unique (marketplace, marketplace_order_id, listing_id)
);

create table order_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references marketplace_orders(id) on delete cascade,
  physical_sku_id uuid not null references physical_skus(id),
  allocated_at timestamptz not null default now(),
  pulled_at timestamptz,
  unique (order_id, physical_sku_id)
);

create table sync_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_key text not null unique,
  event_type text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  payload jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references marketplace_listings(id) on delete cascade,
  issue_type text not null check (issue_type in ('missing_sku','extra_sku','missing_listing','quantity_mismatch','mapping_required')),
  ebay_quantity integer not null,
  active_sku_count integer not null,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  details jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
  ,unique (listing_id, issue_type)
);

create index physical_skus_listing_status_idx on physical_skus(listing_id,status);
create index marketplace_orders_fulfillment_idx on marketplace_orders(fulfillment_status,refunded);
create index reconciliation_issues_status_idx on reconciliation_issues(status);

create view listing_reconciliation as
select l.id, l.ebay_listing_id, l.title, l.ebay_quantity,
       count(s.id) filter (where s.status in ('available','allocated'))::integer as active_sku_count,
       l.ebay_quantity - count(s.id) filter (where s.status in ('available','allocated'))::integer as difference
from marketplace_listings l
left join physical_skus s on s.listing_id = l.id
group by l.id;

alter table marketplace_listings enable row level security;
alter table physical_skus enable row level security;
alter table marketplace_orders enable row level security;
alter table order_allocations enable row level security;
alter table sync_events enable row level security;
alter table reconciliation_issues enable row level security;
alter table app_secrets enable row level security;
