-- Guest ticket surfacing (2026-08-21, follow-on to 20260821040000).
--
-- Two projections grew a column each; both are drop-and-recreate rather than
-- `create or replace` because Postgres refuses to replace a function whose
-- OUT-parameter list changed ("cannot change return type of existing
-- function"). Neither is referenced by a view or another function, so the
-- drop is local.
--
-- 1. admin_event_guest_rsvps_for: + checkin_token, + checked_in_at. The admin
--    Guests tab needs the token to drive a per-row check-in (one token space
--    at the door, member or guest — see admin_check_in_by_token) and the
--    timestamp to render the same "Yes · <time>" attended cell the member
--    roster already uses. Admin-only SECURITY DEFINER, so the token is not
--    newly exposed to anyone who couldn't already scan the guest's QR.
-- 2. guest_ticket_by_token: + checked_in_at, so the public ticket page can
--    say *when* rather than just *that* the holder was scanned in. Still
--    reachable only by knowing the opaque token.

-- ============================================================================
-- admin_event_guest_rsvps_for
-- ============================================================================
drop function if exists public.admin_event_guest_rsvps_for(uuid);

create function public.admin_event_guest_rsvps_for(p_event_id uuid)
returns table (
  id                uuid,
  name              text,
  email             citext,
  phone             text,
  status            public.rsvp_status_t,
  waitlisted_at     timestamptz,
  created_at        timestamptz,
  checkin_token     uuid,
  checked_in_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_event_guest_rsvps_for: admin only' using errcode = 'P0001';
  end if;

  return query
  select
    g.id, g.name, g.email, g.phone, g.status, g.waitlisted_at, g.created_at,
    g.checkin_token, a.checked_in_at
  from public.event_guest_rsvps g
  left join public.event_guest_attendances a on a.guest_rsvp_id = g.id
  where g.event_id = p_event_id
  order by
    case when g.status = 'going' then 0
         when g.status = 'waitlisted' then 1
         else 2
    end,
    g.created_at asc;
end;
$$;

revoke all on function public.admin_event_guest_rsvps_for(uuid) from public;
grant execute on function public.admin_event_guest_rsvps_for(uuid)
  to authenticated, service_role;

-- ============================================================================
-- guest_ticket_by_token
-- ============================================================================
drop function if exists public.guest_ticket_by_token(uuid);

create function public.guest_ticket_by_token(p_token uuid)
returns table (
  guest_name       text,
  guest_email      citext,
  event_title      text,
  event_slug       text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  location_text    text,
  location_url     text,
  cover_image_path text,
  status           public.rsvp_status_t,
  checked_in       boolean,
  checked_in_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.name,
    g.email,
    e.title,
    e.slug,
    e.starts_at,
    e.ends_at,
    e.location_text,
    e.location_url,
    e.cover_image_path,
    g.status,
    a.checked_in_at is not null,
    a.checked_in_at
  from public.event_guest_rsvps g
  join public.events e on e.id = g.event_id
  left join public.event_guest_attendances a on a.guest_rsvp_id = g.id
  where g.checkin_token = p_token;
$$;

comment on function public.guest_ticket_by_token(uuid) is
  'Anonymous-safe guest ticket projection, keyed on the opaque per-RSVP checkin_token. Backs the public /tickets/[token] page — no session required, Luma-style. Returns the holder''s own name/email and nothing else about the event''s guest list. Do not add columns here without confirming they are safe for anyone holding the token.';

revoke all on function public.guest_ticket_by_token(uuid) from public;
grant execute on function public.guest_ticket_by_token(uuid)
  to anon, authenticated, service_role;
