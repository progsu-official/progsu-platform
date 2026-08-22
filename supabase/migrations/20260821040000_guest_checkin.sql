-- Guest check-in (2026-08-21 decision, matching Luma's model: every
-- registrant — member or guest — gets a scannable QR ticket). Mirrors the
-- member checkin_token/event_attendances pattern in
-- 20260816000400_qr_checkin.sql as closely as possible, but additive: a
-- separate event_guest_attendances table rather than widening
-- event_attendances' NOT NULL user_id, so nothing about the existing member
-- roster/analytics queries changes.

-- ============================================================================
-- Column: event_guest_rsvps.checkin_token
-- ============================================================================
alter table public.event_guest_rsvps
  add column if not exists checkin_token uuid;

create unique index if not exists event_guest_rsvps_checkin_token_idx
  on public.event_guest_rsvps (checkin_token)
  where checkin_token is not null;

comment on column public.event_guest_rsvps.checkin_token is
  'Opaque per-guest QR check-in token. Set when status -> going, cleared otherwise. Mirrors event_rsvps.checkin_token (see 20260816000400_qr_checkin.sql) for a guest identity that has no user_id.';

-- ============================================================================
-- event_guest_attendances — same shape as event_attendances, keyed to a
-- guest RSVP row instead of a user_id.
-- ============================================================================
create table public.event_guest_attendances (
  event_id      uuid not null references public.events(id) on delete cascade,
  guest_rsvp_id uuid not null references public.event_guest_rsvps(id) on delete cascade,
  method        public.attendance_method_t not null,
  checked_in_by uuid not null references auth.users(id),
  checked_in_at timestamptz not null default now(),
  note          text,
  primary key (event_id, guest_rsvp_id)
);

alter table public.event_guest_attendances enable row level security;

create policy event_guest_attendances_no_client_access
  on public.event_guest_attendances for all
  to anon, authenticated
  using (false) with check (false);

-- ============================================================================
-- guest_rsvp_to_event — set checkin_token on the 'going' path, same
-- lifecycle rule as the member trigger (present iff status = 'going').
-- Same signature/grants as 20260821010000; only the insert values change.
-- ============================================================================
create or replace function public.guest_rsvp_to_event(
  p_event_id uuid,
  p_name     text,
  p_email    text,
  p_phone    text
)
returns public.rsvp_status_t
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name        text := trim(p_name);
  v_email       citext := trim(p_email);
  v_phone       text := trim(p_phone);
  v_capacity    int;
  v_waitlist    boolean;
  v_status      public.event_status_t;
  v_visibility  public.event_visibility_t;
  v_member_going int;
  v_guest_going  int;
  v_effective   public.rsvp_status_t;
  v_token       uuid;
  v_rate        record;
begin
  if v_name = '' or length(v_name) > 100 then
    raise exception 'guest_rsvp_to_event: name required' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'guest_rsvp_to_event: invalid email' using errcode = 'P0001';
  end if;
  if v_phone !~ '^\+?[0-9\-\(\) ]{7,20}$' then
    raise exception 'guest_rsvp_to_event: invalid phone number' using errcode = 'P0001';
  end if;

  select allowed into v_rate
    from public.consume_rate_limit('guest_event_rsvp', v_email::text, 5, 60);
  if not v_rate.allowed then
    raise exception 'guest_rsvp_to_event: rate limited' using errcode = 'P0001';
  end if;

  select status, visibility, capacity, waitlist_enabled
    into v_status, v_visibility, v_capacity, v_waitlist
  from public.events
  where id = p_event_id
  for update;

  if v_status is null then
    raise exception 'guest_rsvp_to_event: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'published' or v_visibility <> 'members' then
    raise exception 'guest_rsvp_to_event: event not open to guest rsvp' using errcode = 'P0001';
  end if;

  if v_capacity is null then
    v_effective := 'going';
  else
    select count(*)::int into v_member_going
      from public.event_rsvps
     where event_id = p_event_id and status = 'going';
    select count(*)::int into v_guest_going
      from public.event_guest_rsvps
     where event_id = p_event_id and status = 'going' and email <> v_email;
    if (v_member_going + v_guest_going) < v_capacity then
      v_effective := 'going';
    elsif v_waitlist then
      v_effective := 'waitlisted';
    else
      raise exception 'guest_rsvp_to_event: event is full' using errcode = 'P0001';
    end if;
  end if;

  v_token := case when v_effective = 'going' then gen_random_uuid() else null end;

  insert into public.event_guest_rsvps
    (event_id, name, email, phone, status, waitlisted_at, status_changed_at, checkin_token)
  values (
    p_event_id, v_name, v_email, v_phone, v_effective,
    case when v_effective = 'waitlisted' then now() else null end,
    now(),
    v_token
  )
  on conflict (event_id, email) do update
    set name              = excluded.name,
        phone             = excluded.phone,
        status            = excluded.status,
        waitlisted_at      = excluded.waitlisted_at,
        status_changed_at = now(),
        checkin_token     = case
          when excluded.status = 'going'
            then coalesce(public.event_guest_rsvps.checkin_token, excluded.checkin_token)
          else null
        end;

  perform public.write_audit(
    'event.guest_rsvp', null, null,
    jsonb_build_object(
      'event_id',  p_event_id,
      'email',     v_email,
      'effective', v_effective
    )
  );

  return v_effective;
end;
$$;

revoke all on function public.guest_rsvp_to_event(uuid, text, text, text) from public;
grant execute on function public.guest_rsvp_to_event(uuid, text, text, text)
  to anon, authenticated, service_role;

-- ============================================================================
-- guest_ticket_by_token — anon-safe ticket-page projection. No email/phone
-- beyond the guest's own (this IS their ticket, reached only by knowing the
-- opaque token), but nothing else about the event's guest list.
-- ============================================================================
create or replace function public.guest_ticket_by_token(p_token uuid)
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
  checked_in       boolean
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
    exists (
      select 1 from public.event_guest_attendances a where a.guest_rsvp_id = g.id
    )
  from public.event_guest_rsvps g
  join public.events e on e.id = g.event_id
  where g.checkin_token = p_token;
$$;

revoke all on function public.guest_ticket_by_token(uuid) from public;
grant execute on function public.guest_ticket_by_token(uuid)
  to anon, authenticated, service_role;

-- ============================================================================
-- admin_check_in_by_token — unify the door-scan: one token space at check-in
-- regardless of whether the ticket belongs to a member or a guest. Tries
-- event_rsvps first (unchanged member path), falls back to
-- event_guest_rsvps. Same signature/grants as 20260816000400; callers that
-- only care about out_event_id/out_user_id (member path) are unaffected —
-- out_user_id is null for a guest check-in.
-- ============================================================================
create or replace function public.admin_check_in_by_token(
  p_token uuid,
  p_note  text default null
)
returns table (out_event_id uuid, out_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_event_id     uuid;
  v_user_id      uuid;
  v_guest_rsvp_id uuid;
  v_status       public.event_status_t;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_check_in_by_token: admin only' using errcode = 'P0001';
  end if;
  if p_token is null then
    raise exception 'admin_check_in_by_token: invalid token' using errcode = 'P0002';
  end if;

  select r.event_id, r.user_id into v_event_id, v_user_id
    from public.event_rsvps r
   where r.checkin_token = p_token;

  if v_event_id is null then
    select g.event_id, g.id into v_event_id, v_guest_rsvp_id
      from public.event_guest_rsvps g
     where g.checkin_token = p_token;
  end if;

  if v_event_id is null then
    raise exception 'admin_check_in_by_token: invalid token' using errcode = 'P0002';
  end if;

  select status into v_status
    from public.events
   where id = v_event_id;
  if v_status not in ('published', 'cancelled') then
    raise exception 'admin_check_in_by_token: event status must be published|cancelled, got %', v_status
      using errcode = 'P0001';
  end if;

  if v_guest_rsvp_id is not null then
    if exists (
      select 1 from public.event_guest_attendances
       where event_id = v_event_id and guest_rsvp_id = v_guest_rsvp_id
    ) then
      raise exception 'admin_check_in_by_token: already checked in' using errcode = 'P0001';
    end if;

    insert into public.event_guest_attendances (
      event_id, guest_rsvp_id, method, checked_in_by, checked_in_at, note
    ) values (
      v_event_id, v_guest_rsvp_id, 'qr_token', v_uid, now(), p_note
    );

    perform public.write_audit(
      'event.admin_check_in_guest', v_uid, null,
      jsonb_build_object(
        'event_id',       v_event_id,
        'guest_rsvp_id',  v_guest_rsvp_id,
        'method',         'qr_token'
      )
    );

    return query select v_event_id, null::uuid;
  end if;

  if exists (
    select 1 from public.event_attendances
     where event_id = v_event_id and user_id = v_user_id
  ) then
    raise exception 'admin_check_in_by_token: already checked in' using errcode = 'P0001';
  end if;

  insert into public.event_attendances (
    event_id, user_id, method, checked_in_by, checked_in_at, note
  ) values (
    v_event_id, v_user_id, 'qr_token', v_uid, now(), p_note
  );

  perform public.write_audit(
    'event.admin_check_in', v_uid, v_user_id,
    jsonb_build_object(
      'event_id',       v_event_id,
      'target_user_id', v_user_id,
      'method',         'qr_token'
    )
  );

  return query select v_event_id, v_user_id;
end;
$$;

revoke all on function public.admin_check_in_by_token(uuid, text) from public;
grant  execute on function public.admin_check_in_by_token(uuid, text)
  to authenticated, service_role;
