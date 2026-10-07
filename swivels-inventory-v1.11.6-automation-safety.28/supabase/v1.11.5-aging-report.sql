-- Run once in Supabase SQL Editor before opening the Aging Report.
alter table public.marketplace_listings add column if not exists ebay_started_at timestamptz;
alter table public.marketplace_listings add column if not exists aging_reviewed_at timestamptz;
alter table public.marketplace_listings add column if not exists aging_action text;
alter table public.marketplace_listings add column if not exists traffic_impressions integer;
alter table public.marketplace_listings add column if not exists traffic_views integer;
alter table public.marketplace_listings add column if not exists traffic_transactions integer;
alter table public.marketplace_listings add column if not exists traffic_ctr numeric(12,4);
alter table public.marketplace_listings add column if not exists traffic_conversion numeric(12,4);
alter table public.marketplace_listings add column if not exists traffic_updated_at timestamptz;
create index if not exists marketplace_listings_aging_idx
  on public.marketplace_listings (ebay_status, ebay_started_at)
  where ebay_status = 'active';
