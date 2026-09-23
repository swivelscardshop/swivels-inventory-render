-- Safe, non-destructive upgrade for existing Swivels Inventory databases.
-- Run this once in Supabase SQL Editor before using Connect eBay.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;

-- No public policies are created. Only the server-side Supabase service role
-- used by the Render application can read or write this table.
