-- Migration 000700 — mark admin_event_roster_for as volatile.
--
-- The function writes a row to audit_log via write_audit(). It should never
-- have been declared `stable`. PostgREST reads the volatility marker to
-- decide whether to call the RPC in a read-only (GET) or read-write (POST)
-- transaction. With `stable` + a GET the INSERT inside write_audit() fails
-- with "cannot execute INSERT in a read-only transaction", which means the
-- admin Guests tab has never actually loaded for anyone.
--
-- Fix: drop `stable` (default volatility is `volatile`). No other changes.

create or replace function public.admin_event_roster_for(p_event_id uuid)
returns table (
  user_id            uuid,
  first_name         text,
  last_name          text,
  preferred_name     text,
  google_email       citext,
  student_email      citext,
  rsvp_status        public.rsvp_status_t,
  rsvp_comment       text,
  rsvp_changed_at    timestamptz,
  waitlisted_at      timestamptz,
  waitlist_position  int,
  attended           boolean,
  checked_in_at      timestamptz,
  checked_in_by      uuid,
  attendance_method  public.attendance_method_t,
  invited            boolean,
  invited_by         uuid,
  invited_at         timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_event_roster_for: admin only' using errcode = 'P0001';
  end if;

  perform public.write_audit(
    'event.roster_view', v_uid, null,
    jsonb_build_object('event_id', p_event_id)
  );

  return query
  with waitlist_pos as (
    select r.user_id,
           row_number() over (order by r.waitlisted_at asc, r.user_id asc) as pos
    from public.event_rsvps r
    where r.event_id = p_event_id and r.status = 'waitlisted'
  ),
  roster_users as (
    select ru.user_id from public.event_rsvps       ru where ru.event_id = p_event_id
    union
    select ra.user_id from public.event_attendances ra where ra.event_id = p_event_id
    union
    select ri.user_id from public.event_invites     ri
      where ri.event_id = p_event_id and ri.revoked_at is null
  )
  select
    u.user_id,
    p.first_name,
    p.last_name,
    p.preferred_name,
    p.google_email,
    p.student_email,
    r.status,
    r.comment,
    r.status_changed_at,
    r.waitlisted_at,
    wp.pos::int,
    (a.event_id is not null),
    a.checked_in_at,
    a.checked_in_by,
    a.method,
    (ei.event_id is not null),
    ei.invited_by,
    ei.invited_at
  from roster_users u
  join public.profiles p on p.id = u.user_id
  left join public.event_rsvps       r  on r.event_id = p_event_id and r.user_id = u.user_id
  left join public.event_attendances a  on a.event_id = p_event_id and a.user_id = u.user_id
  left join public.event_invites     ei on ei.event_id = p_event_id and ei.user_id = u.user_id
  left join waitlist_pos             wp on wp.user_id = u.user_id
  order by
    case when r.status = 'going' then 0
         when r.status = 'waitlisted' then 1
         when r.status = 'declined' then 2
         when r.status = 'cancelled' then 3
         else 4
    end,
    wp.pos asc nulls last,
    p.last_name, p.first_name;
end;
$$;

revoke all on function public.admin_event_roster_for(uuid) from public;
grant  execute on function public.admin_event_roster_for(uuid)
  to authenticated, service_role;
