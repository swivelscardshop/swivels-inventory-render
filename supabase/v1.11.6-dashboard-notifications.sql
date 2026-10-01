-- Persistent dashboard alerts. Safe to run more than once.
create table if not exists public.dashboard_notifications (
  id uuid primary key default gen_random_uuid(), alert_key text not null unique,
  category text not null, severity text not null default 'warning' check (severity in ('info','warning','error')),
  title text not null, message text not null, status text not null default 'open' check (status in ('open','resolved')),
  read_at timestamptz, source_id text, first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), resolved_at timestamptz
);
create index if not exists dashboard_notifications_status_idx on public.dashboard_notifications(status,last_seen_at desc);
alter table public.dashboard_notifications enable row level security;
revoke all on table public.dashboard_notifications from anon, authenticated;
grant all on table public.dashboard_notifications to service_role;
