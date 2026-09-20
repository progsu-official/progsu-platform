-- admin_event_export_for(event_id) — one row per registrant for the admin
-- "Export CSV" button on the event page. Officers were rebuilding this by
-- hand: read the Attendees tab, read the Guests rows, chase the historical
-- import separately, paste three lists together. One RPC, one row shape, all
-- three sources.
--
-- Row shape is deliberately flat and denormalized (event columns repeat on
-- every row) because the consumer is a spreadsheet, not a join.
--
-- attendee_type tells the three sources apart:
--   member     — event_rsvps + profiles
--   guest      — event_guest_rsvps (+ profiles when the guest's email matches
--                a member, so school/major land on the row; the guest may not
--                have claimed the account, so this is a best-effort match on
--                email, not an identity link)
--   historical — historical_event_attendances + legacy_members (Luma import)
--
-- PII: this returns google_email, school_email and phone for members. Same
-- sensitivity as the recruiter export (app/api/admin/export/route.ts), so it
-- is admin-gated and writes an audit row on every call.

create or replace function public.admin_event_export_for(p_event_id uuid)
returns table (
  event_id          uuid,
  event_title       text,
  event_slug        text,
  event_status      text,
  event_starts_at   timestamptz,
  event_ends_at     timestamptz,
  event_location    text,
  event_capacity    int,
  attendee_type     text,
  profile_id        uuid,
  full_name         text,
  preferred_name    text,
  google_email      text,
  school_email      text,
  phone_number      text,
  school            text,
  major             text,
  minor             text,
  class_standing    text,
  grad_year         int,
  grad_term         text,
  interested_roles  text,
  linkedin_url      text,
  github_url        text,
  portfolio_url     text,
  discord_username  text,
  rsvp_status       text,
  rsvp_at           timestamptz,
  checked_in        boolean,
  checked_in_at     timestamptz,
  checkin_method    text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_event record;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_event_export_for: admin only' using errcode = 'P0001';
  end if;

  select e.id, e.title, e.slug, e.status::text, e.starts_at, e.ends_at,
         e.location_text, e.capacity
    into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    raise exception 'admin_event_export_for: event not found' using errcode = 'P0002';
  end if;

  perform public.write_audit(
    'event.export_csv', v_uid, null,
    jsonb_build_object('event_id', p_event_id)
  );

  return query
  -- Members
  select
    v_event.id, v_event.title, v_event.slug, v_event.status,
    v_event.starts_at, v_event.ends_at, v_event.location_text, v_event.capacity,
    'member'::text,
    p.id,
    nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    p.preferred_name,
    p.google_email,
    p.student_email::text,
    p.phone_number,
    p.school, p.major, p.minor,
    p.class_standing::text, p.grad_year, p.grad_term,
    array_to_string(p.interested_roles::text[], ';'),
    p.linkedin_url, p.github_url, p.portfolio_url, p.discord_username,
    r.status::text,
    r.rsvp_at,
    (a.user_id is not null),
    a.checked_in_at,
    a.method::text
  from public.event_rsvps r
  join public.profiles p on p.id = r.user_id
  left join public.event_attendances a
    on a.event_id = r.event_id and a.user_id = r.user_id
  where r.event_id = p_event_id

  union all

  -- Member walk-ins: checked in with no RSVP row, so the block above misses
  -- them. Same case admin_event_analytics_for counts as walk_ins.
  select
    v_event.id, v_event.title, v_event.slug, v_event.status,
    v_event.starts_at, v_event.ends_at, v_event.location_text, v_event.capacity,
    'member'::text,
    p.id,
    nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    p.preferred_name,
    p.google_email,
    p.student_email::text,
    p.phone_number,
    p.school, p.major, p.minor,
    p.class_standing::text, p.grad_year, p.grad_term,
    array_to_string(p.interested_roles::text[], ';'),
    p.linkedin_url, p.github_url, p.portfolio_url, p.discord_username,
    null::text,
    null::timestamptz,
    true,
    a.checked_in_at,
    a.method::text
  from public.event_attendances a
  join public.profiles p on p.id = a.user_id
  where a.event_id = p_event_id
    and not exists (
      select 1 from public.event_rsvps r
      where r.event_id = a.event_id and r.user_id = a.user_id
    )

  union all

  -- Guests. Profile columns are a best-effort email match (see header).
  select
    v_event.id, v_event.title, v_event.slug, v_event.status,
    v_event.starts_at, v_event.ends_at, v_event.location_text, v_event.capacity,
    'guest'::text,
    p.id,
    g.name,
    p.preferred_name,
    coalesce(p.google_email, g.email),
    coalesce(p.student_email::text,
             case when split_part(lower(g.email), '@', 2) like '%.edu'
                  then lower(g.email) end),
    coalesce(p.phone_number, g.phone),
    p.school, p.major, p.minor,
    p.class_standing::text, p.grad_year, p.grad_term,
    array_to_string(p.interested_roles::text[], ';'),
    p.linkedin_url, p.github_url, p.portfolio_url, p.discord_username,
    g.status::text,
    g.created_at,
    (ga.guest_rsvp_id is not null),
    ga.checked_in_at,
    ga.method::text
  from public.event_guest_rsvps g
  left join public.event_guest_attendances ga
    on ga.event_id = g.event_id and ga.guest_rsvp_id = g.id
  left join public.profiles p
    on lower(p.google_email) = lower(g.email)
    or lower(p.student_email::text) = lower(g.email)
  where g.event_id = p_event_id

  union all

  -- Historical (Luma import). legacy_members carries a subset of the profile
  -- columns — whatever the import form asked — so school/minor/links/discord
  -- stay null rather than being faked from a claimed profile.
  select
    v_event.id, v_event.title, v_event.slug, v_event.status,
    v_event.starts_at, v_event.ends_at, v_event.location_text, v_event.capacity,
    'historical'::text,
    lm.claimed_profile_id,
    coalesce(lm.full_name,
             nullif(trim(coalesce(lm.first_name, '') || ' ' || coalesce(lm.last_name, '')), '')),
    null::text,
    lm.personal_email::text,
    lm.campus_email::text,
    coalesce(lm.phone_e164, lm.phone_number),
    null::text, lm.major, null::text,
    lm.class_standing::text, lm.grad_year, null::text,
    array_to_string(lm.interested_roles::text[], ';'),
    null::text, null::text, null::text, null::text,
    -- Luma's approval_status is the closest thing the import has to an RSVP
    -- status; 'approved' is what every going-count surface folds in.
    coalesce(h.approval_status, 'unknown'),
    h.registered_at,
    (h.checked_in_at is not null),
    h.checked_in_at,
    case when h.checked_in_at is not null then 'historical_import' end
  from public.historical_event_attendances h
  join public.legacy_members lm on lm.id = h.legacy_member_id
  where h.event_id = p_event_id

  order by 9, 11 nulls last;
end;
$$;

comment on function public.admin_event_export_for(uuid) is
  'One flat row per event registrant (member RSVPs, member walk-ins, guest RSVPs, historical Luma import) for the admin CSV export. Admin-gated, writes an event.export_csv audit row per call. Returns PII (emails, phone) — treat like the recruiter export.';

revoke all on function public.admin_event_export_for(uuid) from public;
-- Hard rule 10: Supabase default privileges hand anon/authenticated EXECUTE on
-- every new public function as explicit per-role grants, and the `revoke ...
-- from public` above does not touch those. Revoke anon explicitly; the
-- is_admin() check above is what gates authenticated callers.
revoke all on function public.admin_event_export_for(uuid) from anon;
grant  execute on function public.admin_event_export_for(uuid)
  to authenticated, service_role;
