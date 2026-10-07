alter table public.pending_skus
  add column if not exists primary_sku text;

create index if not exists pending_skus_primary_sku_idx
  on public.pending_skus(primary_sku);
