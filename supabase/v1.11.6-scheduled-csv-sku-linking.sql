alter table public.pending_skus
  add column if not exists batch_id uuid,
  add column if not exists primary_sku text,
  add column if not exists expected_quantity integer not null default 1,
  add column if not exists attach_status text not null default 'pending',
  add column if not exists attached_listing_id uuid references public.marketplace_listings(id) on delete set null,
  add column if not exists attached_at timestamptz,
  add column if not exists error_message text;

create index if not exists pending_skus_primary_sku_idx
  on public.pending_skus(primary_sku);

create index if not exists pending_skus_attach_status_idx
  on public.pending_skus(attach_status);

update public.pending_skus
set attach_status = 'pending'
where attach_status is null;
