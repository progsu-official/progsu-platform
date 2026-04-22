-- Migration 000050 — small SECURITY DEFINER helper exposing a member's own
-- waitlist position on a given event. event_rsvps SELECT policy is self-only,
-- so a user-context client can't compute "how many are ahead of me" via a
-- direct query. This helper does the count under security definer without
-- leaking any peer identity.

-- ============================================================================
-- my_waitlist_position(p_event_id uuid) returns int
-- Returns the caller's 1-indexed waitlist position for the event, or null if
-- the caller is not currently waitlisted. Ordering mirrors the event_rsvps
-- waitlist index: (waitlisted_at asc, user_id asc).
-- ============================================================================

create or replace function public.my_waitlist_position(p_event_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_waitlisted_at timestamptz;
  v_position int;
begin
  if v_uid is null then
    return null;
  end if;

  select waitlisted_at
    into v_waitlisted_at
  from public.event_rsvps
  where event_id = p_event_id
    and user_id = v_uid
    and status = 'waitlisted';

  if v_waitlisted_at is null then
    return null;
  end if;

  select count(*) + 1
    into v_position
  from public.event_rsvps
  where event_id = p_event_id
    and status = 'waitlisted'
    and (
      waitlisted_at < v_waitlisted_at
      or (waitlisted_at = v_waitlisted_at and user_id < v_uid)
    );

  return v_position;
end;
$$;

revoke all on function public.my_waitlist_position(uuid) from public;
grant  execute on function public.my_waitlist_position(uuid) to authenticated, service_role;

comment on function public.my_waitlist_position(uuid) is
  'Returns the caller''s 1-indexed waitlist position for an event, or null if not waitlisted. security definer reads event_rsvps past the self-only RLS policy without exposing peer identities.';
