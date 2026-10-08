alter table public.pending_skus
  add column if not exists batch_id uuid,
  add column if not exists primary_sku text,
  add column if not exists expected_quantity integer not null default 1,
  add column if not exists attach_status text not null default 'pending',
  add column if not exists attached_listing_id uuid references public.marketplace_listings(id) on delete set null,
  add column if not exists attached_at timestamptz,
  add column if not exists error_message text;

create index if not exists pending_skus_primary_sku_idx on public.pending_skus(primary_sku);
create index if not exists pending_skus_attach_status_idx on public.pending_skus(attach_status);

create table if not exists public.inventory_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  physical_sku_id uuid references public.physical_skus(id) on delete set null,
  sku text,
  event_type text not null,
  source text not null,
  quantity_delta integer,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',
  status text not null default 'running',
  listings_count integer,
  sku_count integer,
  issues_count integer,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.bin_audit_results (
  physical_sku_id uuid primary key references public.physical_skus(id) on delete cascade,
  status text not null default 'verified',
  note text,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists inventory_events_created_idx on public.inventory_events(created_at desc);
create index if not exists inventory_events_sku_idx on public.inventory_events(sku);
create index if not exists inventory_events_listing_idx on public.inventory_events(listing_id);
create index if not exists reconciliation_runs_started_idx on public.reconciliation_runs(started_at desc);

alter table public.inventory_events enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.bin_audit_results enable row level security;
