-- Run once in Supabase SQL Editor. This provides an atomic work-queue claim so
-- multiple Render requests can never process the same marketplace event at once.
create or replace function public.claim_sync_events(batch_limit integer default 10)
returns setof public.sync_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.sync_events as event
     set status = 'processing',
         attempts = event.attempts + 1,
         processed_at = now(),
         error_message = null
   where event.id in (
     select candidate.id
       from public.sync_events as candidate
      where candidate.attempts < 10
        and (
          (candidate.status = 'pending' and candidate.received_at < now() - interval '20 seconds')
          or (candidate.status = 'failed' and candidate.processed_at < now() - make_interval(mins => least(greatest(candidate.attempts, 1), 10)))
          or (candidate.status = 'processing' and candidate.processed_at < now() - interval '5 minutes')
        )
      order by candidate.received_at asc
      for update skip locked
      limit greatest(1, least(batch_limit, 25))
   )
   returning event.*;
end;
$$;

revoke all on function public.claim_sync_events(integer) from public;
grant execute on function public.claim_sync_events(integer) to service_role;
