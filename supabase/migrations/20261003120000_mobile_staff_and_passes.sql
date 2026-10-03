-- Mobile staff check-in with per-user, per-event assignments and a real actor.
--
-- The web /checkin door (STAFF_CHECKIN_TOKEN cookie, null actor) is left
-- untouched. The mobile flow never uses that token: the caller is a signed-in
-- member, the assignment is checked live on every call, and checked_in_by is
-- the scanner.
--
-- Also: event_pass_tokens, the opaque per-RSVP token a Wallet pass carries.
-- Only a SHA-256 of the token is stored. serial is stable per (event, user)
-- so re-downloading a pass replaces the one already in Wallet; each issue
-- revokes the previous token.

-- ============================================================================
-- event_staff_assignments
-- ============================================================================
create table public.event_staff_assignments (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id) on delete set null,

  constraint event_staff_assignments_revoke_pair check (
    (revoked_at is null and revoked_by is null) or revoked_at is not null
  )
);

create unique index event_staff_assignments_active_uniq
  on public.event_staff_assignments (event_id, user_id)
  where revoked_at is null;

create index event_staff_assignments_user_idx
  on public.event_staff_assignments (user_id)
  where revoked_at is null;

alter table public.event_staff_assignments enable row level security;

create policy event_staff_assignments_select_own
  on public.event_staff_assignments for select
  to authenticated
  using (auth.uid() = user_id);

create policy event_staff_assignments_select_admin
  on public.event_staff_assignments for select
  to authenticated
  using (public.is_admin(auth.uid()));

revoke insert, update, delete, truncate on public.event_staff_assignments from anon, authenticated;

create or replace function public.is_active_event_staff(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_staff_assignments s
     where s.event_id = p_event_id
       and s.user_id = p_user_id
       and s.revoked_at is null
       and (s.expires_at is null or s.expires_at > now())
  );
$$;

revoke all on function public.is_active_event_staff(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.is_active_event_staff(uuid, uuid) to authenticated, service_role;

create or replace function public.admin_grant_event_staff(
  p_event_id   uuid,
  p_user_id    uuid,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_grant_event_staff: admin only' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'admin_grant_event_staff: event not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'admin_grant_event_staff: member not found' using errcode = 'P0002';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'admin_grant_event_staff: expiry must be in the future' using errcode = 'P0001';
  end if;

  -- Re-granting replaces the active assignment's expiry rather than stacking.
  update public.event_staff_assignments
     set expires_at = p_expires_at
   where event_id = p_event_id and user_id = p_user_id and revoked_at is null
  returning id into v_id;

  if v_id is null then
    insert into public.event_staff_assignments (event_id, user_id, granted_by, expires_at)
    values (p_event_id, p_user_id, v_uid, p_expires_at)
    returning id into v_id;
  end if;

  perform public.write_audit(
    'event.staff_grant', v_uid, p_user_id,
    jsonb_build_object('event_id', p_event_id, 'assignment_id', v_id, 'expires_at', p_expires_at)
  );
  return v_id;
end;
$$;

revoke all on function public.admin_grant_event_staff(uuid, uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.admin_grant_event_staff(uuid, uuid, timestamptz) to authenticated, service_role;

create or replace function public.admin_revoke_event_staff(p_event_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows int;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_revoke_event_staff: admin only' using errcode = 'P0001';
  end if;

  update public.event_staff_assignments
     set revoked_at = now(), revoked_by = v_uid
   where event_id = p_event_id and user_id = p_user_id and revoked_at is null;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    perform public.write_audit(
      'event.staff_revoke', v_uid, p_user_id,
      jsonb_build_object('event_id', p_event_id)
    );
  end if;
  return v_rows > 0;
end;
$$;

revoke all on function public.admin_revoke_event_staff(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_revoke_event_staff(uuid, uuid) to authenticated, service_role;

-- Admin listing for the event page (names + emails are admin-visible anyway).
create or replace function public.admin_event_staff_for(p_event_id uuid)
returns table (
  user_id    uuid,
  name       text,
  email      text,
  granted_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin_event_staff_for: admin only' using errcode = 'P0001';
  end if;
  return query
    select s.user_id,
           btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
           p.google_email::text,
           s.granted_at,
           s.expires_at
      from public.event_staff_assignments s
      join public.profiles p on p.id = s.user_id
     where s.event_id = p_event_id and s.revoked_at is null
     order by s.granted_at;
end;
$$;

revoke all on function public.admin_event_staff_for(uuid) from public, anon, authenticated;
grant  execute on function public.admin_event_staff_for(uuid) to authenticated, service_role;

-- ============================================================================
-- event_pass_tokens
-- ============================================================================
create table public.event_pass_tokens (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  serial      uuid not null,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create unique index event_pass_tokens_active_uniq
  on public.event_pass_tokens (event_id, user_id)
  where revoked_at is null;

create index event_pass_tokens_serial_idx on public.event_pass_tokens (serial);

alter table public.event_pass_tokens enable row level security;
-- No policies for authenticated/anon: the hash is useless to a client and the
-- raw token is only ever returned once, by issue_event_pass().
revoke all on public.event_pass_tokens from anon, authenticated;

-- Issues a fresh token for the caller's going RSVP, revoking any previous one.
-- Returns the raw token exactly once.
create or replace function public.issue_event_pass(p_event_id uuid)
returns table (token text, serial uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_serial uuid;
  v_token  text;
begin
  if v_uid is null then
    raise exception 'issue_event_pass: unauthenticated' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.event_rsvps r
     where r.event_id = p_event_id and r.user_id = v_uid and r.status = 'going'
  ) then
    raise exception 'issue_event_pass: going RSVP required' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pass:' || p_event_id::text || ':' || v_uid::text, 0));

  select t.serial into v_serial
    from public.event_pass_tokens t
   where t.event_id = p_event_id and t.user_id = v_uid
   order by t.created_at desc
   limit 1;
  v_serial := coalesce(v_serial, gen_random_uuid());

  update public.event_pass_tokens
     set revoked_at = now()
   where event_id = p_event_id and user_id = v_uid and revoked_at is null;

  v_token := 'pp1.' || translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

  insert into public.event_pass_tokens (event_id, user_id, serial, token_hash)
  values (p_event_id, v_uid, v_serial, encode(extensions.digest(v_token, 'sha256'), 'hex'));

  perform public.write_audit(
    'event.pass_issued', v_uid, v_uid,
    jsonb_build_object('event_id', p_event_id, 'serial', v_serial)
  );

  return query select v_token, v_serial;
end;
$$;

revoke all on function public.issue_event_pass(uuid) from public, anon, authenticated;
grant  execute on function public.issue_event_pass(uuid) to authenticated;

-- ============================================================================
-- mobile_staff_events — assignments that are live right now, for the caller.
-- ============================================================================
create or replace function public.mobile_staff_events()
returns table (
  event_id   uuid,
  slug       text,
  title      text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  status     text,
  expires_at timestamptz,
  going      int,
  checked_in int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'mobile_staff_events: unauthenticated' using errcode = 'P0001';
  end if;
  return query
    select e.id, e.slug, e.title, e.starts_at, e.ends_at, e.status::text, s.expires_at,
           (select count(*)::int from public.event_rsvps r where r.event_id = e.id and r.status = 'going'),
           (select count(*)::int from public.event_attendances a where a.event_id = e.id)
      from public.event_staff_assignments s
      join public.events e on e.id = s.event_id
     where s.user_id = v_uid
       and s.revoked_at is null
       and (s.expires_at is null or s.expires_at > now())
       and e.status in ('published', 'cancelled')
     order by e.starts_at;
end;
$$;

revoke all on function public.mobile_staff_events() from public, anon, authenticated;
grant  execute on function public.mobile_staff_events() to authenticated;

-- ============================================================================
-- mobile_staff_scan
-- Results: checked_in | already_checked_in | wrong_event | revoked |
--          not_rsvpd | outside_window | invalid_code
-- Raises 'not event staff' (P0001) when the caller has no live assignment.
-- ============================================================================
create or replace function public.mobile_staff_scan(p_event_id uuid, p_code text)
returns table (
  result          text,
  attendee_name   text,
  attendee_kind   text,
  points_awarded  int,
  checked_in_at   timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_code      text := btrim(coalesce(p_code, ''));
  v_uuid      uuid;
  v_event     record;
  v_user_id   uuid;
  v_guest_id     uuid;
  v_guest_event  uuid;
  v_guest_name   text;
  v_guest_status public.rsvp_status_t;
  v_tok       record;
  v_tok_event uuid;
  v_name      text;
  v_inserted  timestamptz;
  v_existing  timestamptz;
  v_points    int := 0;
  v_matches   int;
begin
  if v_uid is null then
    raise exception 'mobile_staff_scan: unauthenticated' using errcode = 'P0001';
  end if;
  if not public.is_active_event_staff(p_event_id, v_uid) then
    raise exception 'mobile_staff_scan: not event staff' using errcode = 'P0001';
  end if;

  select e.id, e.status, e.starts_at, e.ends_at into v_event
    from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'mobile_staff_scan: event not found' using errcode = 'P0002';
  end if;

  if length(v_code) = 0 or length(v_code) > 200 then
    return query select 'invalid_code', null::text, null::text, 0, null::timestamptz;
    return;
  end if;

  -- 1. Resolve the code to a member (v_user_id) or a guest RSVP (v_guest).
  if v_code ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_code::uuid;

    select p.id into v_user_id from public.profiles p where p.checkin_code = v_uuid;

    if v_user_id is null then
      select r.event_id, r.user_id into v_tok_event, v_user_id
        from public.event_rsvps r where r.checkin_token = v_uuid;
      if v_user_id is not null and v_tok_event <> p_event_id then
        return query select 'wrong_event', null::text, 'member', 0, null::timestamptz;
        return;
      end if;
    end if;

    if v_user_id is null then
      select g.id, g.event_id, g.name, g.status
        into v_guest_id, v_guest_event, v_guest_name, v_guest_status
        from public.event_guest_rsvps g where g.checkin_token = v_uuid;
      if v_guest_id is not null and v_guest_event <> p_event_id then
        return query select 'wrong_event', null::text, 'guest', 0, null::timestamptz;
        return;
      end if;
    end if;

  elsif v_code like 'pp1.%' then
    select t.event_id, t.user_id, t.revoked_at into v_tok
      from public.event_pass_tokens t
     where t.token_hash = encode(extensions.digest(v_code, 'sha256'), 'hex');
    if v_tok.user_id is null then
      return query select 'invalid_code', null::text, null::text, 0, null::timestamptz;
      return;
    end if;
    if v_tok.event_id <> p_event_id then
      return query select 'wrong_event', null::text, 'member', 0, null::timestamptz;
      return;
    end if;
    if v_tok.revoked_at is not null then
      return query select 'revoked', null::text, 'member', 0, null::timestamptz;
      return;
    end if;
    v_user_id := v_tok.user_id;

  elsif v_code ~* '^[0-9a-f]{8}$' then
    -- Readable short code from /me/pass (first 8 hex of checkin_code), for
    -- typing at the door when a camera can't read the screen.
    select count(*)::int, min(p.id::text)::uuid into v_matches, v_user_id
      from public.profiles p
     where left(p.checkin_code::text, 8) = lower(v_code);
    if v_matches <> 1 then
      v_user_id := null;
    end if;
  end if;

  if v_user_id is null and v_guest_id is null then
    return query select 'invalid_code', null::text, null::text, 0, null::timestamptz;
    return;
  end if;

  -- 2. Event state + window.
  if v_event.status <> 'published'
     or now() < v_event.starts_at - interval '2 hours'
     or now() > v_event.ends_at + interval '2 hours' then
    return query select 'outside_window', null::text, null::text, 0, null::timestamptz;
    return;
  end if;

  -- 3a. Guest path (no points: guests have no ledger).
  if v_guest_id is not null then
    if v_guest_status <> 'going' then
      return query select 'not_rsvpd', v_guest_name, 'guest', 0, null::timestamptz;
      return;
    end if;
    insert into public.event_guest_attendances (event_id, guest_rsvp_id, method, checked_in_by, checked_in_at)
    values (p_event_id, v_guest_id, 'qr_token', v_uid, now())
    on conflict do nothing
    returning event_guest_attendances.checked_in_at into v_inserted;
    if v_inserted is null then
      select ga.checked_in_at into v_existing from public.event_guest_attendances ga
       where ga.event_id = p_event_id and ga.guest_rsvp_id = v_guest_id;
      return query select 'already_checked_in', v_guest_name, 'guest', 0, v_existing;
      return;
    end if;
    perform public.write_audit(
      'event.mobile_staff_check_in_guest', v_uid, null,
      jsonb_build_object('event_id', p_event_id, 'guest_rsvp_id', v_guest_id, 'method', 'qr_token', 'via', 'mobile_staff')
    );
    return query select 'checked_in', v_guest_name, 'guest', 0, v_inserted;
    return;
  end if;

  -- 3b. Member path.
  select coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.first_name), ''), 'Member')
         || coalesce(' ' || left(nullif(btrim(p.last_name), ''), 1) || '.', '')
    into v_name
    from public.profiles p where p.id = v_user_id;

  select a.checked_in_at into v_existing
    from public.event_attendances a
   where a.event_id = p_event_id and a.user_id = v_user_id;
  if v_existing is not null then
    return query select 'already_checked_in', v_name, 'member', 0, v_existing;
    return;
  end if;

  if not exists (
    select 1 from public.event_rsvps r
     where r.event_id = p_event_id and r.user_id = v_user_id and r.status = 'going'
  ) then
    return query select 'not_rsvpd', v_name, 'member', 0, null::timestamptz;
    return;
  end if;

  insert into public.event_attendances (event_id, user_id, method, checked_in_by, checked_in_at)
  values (p_event_id, v_user_id, 'qr_token', v_uid, now())
  on conflict (event_id, user_id) do nothing
  returning event_attendances.checked_in_at into v_inserted;

  if v_inserted is null then
    select a.checked_in_at into v_existing from public.event_attendances a
     where a.event_id = p_event_id and a.user_id = v_user_id;
    return query select 'already_checked_in', v_name, 'member', 0, v_existing;
    return;
  end if;

  v_points := public._points_award_attendance(p_event_id, v_user_id, v_uid, 'mobile_staff_scan');

  perform public.write_audit(
    'event.mobile_staff_check_in', v_uid, v_user_id,
    jsonb_build_object('event_id', p_event_id, 'method', 'qr_token', 'via', 'mobile_staff', 'points_awarded', v_points)
  );

  return query select 'checked_in', v_name, 'member', v_points, v_inserted;
end;
$$;

revoke all on function public.mobile_staff_scan(uuid, text) from public, anon, authenticated;
grant  execute on function public.mobile_staff_scan(uuid, text) to authenticated;

-- ============================================================================
-- mobile_staff_manual_checkin — same rules as a scan, by user id, with reason.
-- ============================================================================
create or replace function public.mobile_staff_manual_checkin(
  p_event_id uuid,
  p_user_id  uuid,
  p_reason   text
)
returns table (
  result          text,
  attendee_name   text,
  points_awarded  int,
  checked_in_at   timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_event    record;
  v_name     text;
  v_inserted timestamptz;
  v_existing timestamptz;
  v_points   int := 0;
begin
  if v_uid is null then
    raise exception 'mobile_staff_manual_checkin: unauthenticated' using errcode = 'P0001';
  end if;
  if not public.is_active_event_staff(p_event_id, v_uid) then
    raise exception 'mobile_staff_manual_checkin: not event staff' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 500 then
    raise exception 'mobile_staff_manual_checkin: reason required' using errcode = 'P0001';
  end if;

  select e.id, e.status, e.starts_at, e.ends_at into v_event
    from public.events e where e.id = p_event_id;
  if v_event.id is null then
    raise exception 'mobile_staff_manual_checkin: event not found' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.first_name), ''), 'Member')
         || coalesce(' ' || left(nullif(btrim(p.last_name), ''), 1) || '.', '')
    into v_name
    from public.profiles p where p.id = p_user_id;
  if v_name is null then
    return query select 'invalid_code', null::text, 0, null::timestamptz;
    return;
  end if;

  if v_event.status <> 'published'
     or now() < v_event.starts_at - interval '2 hours'
     or now() > v_event.ends_at + interval '2 hours' then
    return query select 'outside_window', null::text, 0, null::timestamptz;
    return;
  end if;

  select a.checked_in_at into v_existing from public.event_attendances a
   where a.event_id = p_event_id and a.user_id = p_user_id;
  if v_existing is not null then
    return query select 'already_checked_in', v_name, 0, v_existing;
    return;
  end if;

  if not exists (
    select 1 from public.event_rsvps r
     where r.event_id = p_event_id and r.user_id = p_user_id and r.status = 'going'
  ) then
    return query select 'not_rsvpd', v_name, 0, null::timestamptz;
    return;
  end if;

  insert into public.event_attendances (event_id, user_id, method, checked_in_by, checked_in_at, note)
  values (p_event_id, p_user_id, 'admin_click', v_uid, now(), left(btrim(p_reason), 500))
  on conflict (event_id, user_id) do nothing
  returning event_attendances.checked_in_at into v_inserted;

  if v_inserted is null then
    select a.checked_in_at into v_existing from public.event_attendances a
     where a.event_id = p_event_id and a.user_id = p_user_id;
    return query select 'already_checked_in', v_name, 0, v_existing;
    return;
  end if;

  v_points := public._points_award_attendance(p_event_id, p_user_id, v_uid, 'mobile_staff_manual');

  perform public.write_audit(
    'event.mobile_staff_check_in', v_uid, p_user_id,
    jsonb_build_object('event_id', p_event_id, 'method', 'admin_click', 'via', 'mobile_staff_manual',
                       'reason', btrim(p_reason), 'points_awarded', v_points)
  );

  return query select 'checked_in', v_name, v_points, v_inserted;
end;
$$;

revoke all on function public.mobile_staff_manual_checkin(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.mobile_staff_manual_checkin(uuid, uuid, text) to authenticated;

-- ============================================================================
-- mobile_staff_roster — minimal fields only: no email, phone or profile data.
-- ============================================================================
create or replace function public.mobile_staff_roster(p_event_id uuid, p_query text default null)
returns table (
  user_id       uuid,
  display_name  text,
  rsvp_status   text,
  checked_in    boolean,
  checked_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_uid is null then
    raise exception 'mobile_staff_roster: unauthenticated' using errcode = 'P0001';
  end if;
  if not public.is_active_event_staff(p_event_id, v_uid) then
    raise exception 'mobile_staff_roster: not event staff' using errcode = 'P0001';
  end if;
  if v_q is not null and length(v_q) > 100 then
    v_q := left(v_q, 100);
  end if;

  return query
    select r.user_id,
           btrim(coalesce(nullif(btrim(p.preferred_name), ''), coalesce(p.first_name, '')) || ' ' || coalesce(p.last_name, '')),
           r.status::text,
           (a.user_id is not null),
           a.checked_in_at
      from public.event_rsvps r
      join public.profiles p on p.id = r.user_id
      left join public.event_attendances a on a.event_id = r.event_id and a.user_id = r.user_id
     where r.event_id = p_event_id
       and r.status in ('going', 'waitlisted')
       and (
         v_q is null
         or (coalesce(p.preferred_name, '') || ' ' || coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
              ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       )
     order by lower(coalesce(p.last_name, '')), lower(coalesce(p.first_name, '')), r.user_id
     limit 200;
end;
$$;

revoke all on function public.mobile_staff_roster(uuid, text) from public, anon, authenticated;
grant  execute on function public.mobile_staff_roster(uuid, text) to authenticated;

grant select on public.event_staff_assignments to authenticated;
grant all    on public.event_staff_assignments to service_role;
grant all    on public.event_pass_tokens to service_role;
