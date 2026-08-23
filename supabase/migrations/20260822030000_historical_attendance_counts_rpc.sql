-- Fix: admin/events list computed "N going" for historical (pre-platform)
-- events by fetching every historical_event_attendances row for the visible
-- ids and counting in JS. historical_event_attendances has 1,600+ rows —
-- PostgREST's default response cap (1000) silently truncates that fetch, so
-- any event whose approved rows fall outside the truncated window shows 0
-- going even though the real count is in the hundreds. Aggregating in
-- Postgres instead returns one row per event (a handful of rows, not
-- thousands), so there's nothing left to truncate.
create or replace function public.historical_attendance_counts(p_event_ids uuid[])
returns table (event_id uuid, going_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select h.event_id, count(*) as going_count
  from public.historical_event_attendances h
  where h.event_id = any(p_event_ids)
    and lower(h.approval_status) = 'approved'
  group by h.event_id;
$$;

revoke all on function public.historical_attendance_counts(uuid[]) from public;
grant  execute on function public.historical_attendance_counts(uuid[])
  to authenticated, service_role;
