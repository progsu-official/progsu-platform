-- Hard-delete for a non-draft event. delete_draft_event (migration 1) only
-- ever allowed drafts — there was no path to remove a junk/test archived or
-- cancelled event short of a manual multi-table cleanup (see the
-- test-mercedes-internship-ama removal, 2026-08-23). Every event_id FK is
-- already `on delete cascade` (event_hosts, event_rsvps, event_invites,
-- event_guest_rsvps, event_notification_jobs, historical_event_attendances),
-- so this only needs to delete the events row itself — Postgres does the
-- rest. Storage cover cleanup stays in the app layer (lib/actions/events.ts),
-- same as deleteEventCover: Postgres can't reach into Supabase Storage.
create or replace function public.delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.event_status_t;
begin
  if not public.is_admin(v_uid) then
    raise exception 'delete_event: admin only' using errcode = 'P0001';
  end if;

  select status into v_status
    from public.events
   where id = p_event_id
   for update;
  if v_status is null then
    raise exception 'delete_event: event not found' using errcode = 'P0002';
  end if;
  if v_status not in ('archived', 'cancelled') then
    raise exception 'delete_event: expected archived or cancelled, got %', v_status
      using errcode = 'P0001';
  end if;

  delete from public.events where id = p_event_id;
end;
$$;

comment on function public.delete_event(uuid) is
  'Admin-only hard delete for an archived/cancelled event. Published/draft events go through their own lifecycle actions (archive/cancel/delete_draft_event) first — this is the terminal cleanup step, not a shortcut around the lifecycle.';

revoke all on function public.delete_event(uuid) from public;
grant  execute on function public.delete_event(uuid) to authenticated, service_role;
