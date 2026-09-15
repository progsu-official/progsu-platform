-- Migration — staff manual check-in + guest filter support.
-- The door /checkin surface was QR-scan-only (staff_check_in_by_token);
-- this adds a walk-in path for members, same trust model as that RPC
-- (service_role only, no admin check, no real actor to attribute the
-- check-in to) and mirroring admin_check_in_member's walk-in/upsert
-- behavior. Guests don't get a new RPC: their checkin_token is now also
-- returned by staff_event_attendees_for, so a manual guest check-in
-- reuses staff_check_in_by_token exactly like the QR scan does — same as
-- how the admin Attendees tab's guest "Check in" button already works
-- (see guests-tab.tsx GuestRowActions).

create or replace function public.staff_check_in_member(
  p_event_id uuid,
  p_user_id  uuid,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.event_status_t;
begin
  select status into v_status from public.events where id = p_event_id;
  if v_status is null then
    raise exception 'staff_check_in_member: event not found' using errcode = 'P0002';
  end if;
  if v_status not in ('published', 'cancelled') then
    raise exception 'staff_check_in_member: event status must be published|cancelled, got %', v_status
      using errcode = 'P0001';
  end if;

  insert into public.event_attendances (
    event_id, user_id, method, checked_in_by, checked_in_at, note
  )
  values (
    p_event_id, p_user_id, 'admin_click', null, now(), p_note
  )
  on conflict (event_id, user_id) do update
    set note = coalesce(excluded.note, public.event_attendances.note);

  perform public.write_audit(
    'event.staff_check_in', null, p_user_id,
    jsonb_build_object(
      'event_id',       p_event_id,
      'target_user_id', p_user_id,
      'method',         'admin_click',
      'via',            'staff_manual'
    )
  );
end;
$$;

revoke all on function public.staff_check_in_member(uuid, uuid, text) from public;
grant  execute on function public.staff_check_in_member(uuid, uuid, text)
  to service_role;

-- Widen staff_event_attendees_for with checkin_token so the door page's
-- manual "Check in" button on a guest row can redeem it — null for members
-- (they don't need one, staff_check_in_member above takes them by user_id
-- directly) and null for a guest who isn't 'going' (no ticket to redeem,
-- same restriction the admin tab already has). Everything else unchanged
-- from the original definition (20260915150000). Dropped first: adding an
-- OUT column changes the return type, which `create or replace` refuses.
drop function if exists public.staff_event_attendees_for(uuid);

create function public.staff_event_attendees_for(p_event_id uuid)
returns table (
  id            text,
  kind          text,
  name          text,
  email         text,
  status        text,
  checked_in    boolean,
  checked_in_at timestamptz,
  checkin_token uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.user_id::text,
    'member',
    coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), r.user_id::text),
    coalesce(p.student_email, p.google_email)::text,
    r.status::text,
    (a.user_id is not null),
    a.checked_in_at,
    null::uuid
  from public.event_rsvps r
  join public.profiles p on p.id = r.user_id
  left join public.event_attendances a
    on a.event_id = r.event_id and a.user_id = r.user_id
  where r.event_id = p_event_id

  union all

  select
    g.id::text,
    'guest',
    g.name,
    g.email::text,
    g.status::text,
    (ga.guest_rsvp_id is not null),
    ga.checked_in_at,
    g.checkin_token
  from public.event_guest_rsvps g
  left join public.event_guest_attendances ga
    on ga.event_id = g.event_id and ga.guest_rsvp_id = g.id
  where g.event_id = p_event_id;
$$;

revoke all on function public.staff_event_attendees_for(uuid) from public;
grant  execute on function public.staff_event_attendees_for(uuid) to service_role;
