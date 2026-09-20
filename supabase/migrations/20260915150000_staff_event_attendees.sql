-- Read-only attendee list for door staff (/checkin): search by name/email,
-- see who's checked in. service_role-only, same enforcement as
-- staff_check_in_by_token — no admin check needed since the app's own
-- STAFF_CHECKIN_TOKEN cookie gate is the only caller. Deliberately excludes
-- invites, waitlist position, and historical/legacy attendees: this is a
-- door-duty search, not the admin roster.
create function public.staff_event_attendees_for(p_event_id uuid)
returns table (
  id            text,
  kind          text,
  name          text,
  email         text,
  status        text,
  checked_in    boolean,
  checked_in_at timestamptz
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
    a.checked_in_at
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
    ga.checked_in_at
  from public.event_guest_rsvps g
  left join public.event_guest_attendances ga
    on ga.event_id = g.event_id and ga.guest_rsvp_id = g.id
  where g.event_id = p_event_id;
$$;

revoke all on function public.staff_event_attendees_for(uuid) from public;
grant  execute on function public.staff_event_attendees_for(uuid) to service_role;
