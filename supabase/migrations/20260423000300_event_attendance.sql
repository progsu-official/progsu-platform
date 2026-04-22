-- Migration 000011 — event_attendances, self/admin check-in helpers, correction
-- helper, raw-code rotation helper, and a final can_view_event() that includes
-- attendance in the cancelled-event branch. Raw check-in codes enter the DB only
-- via rotate_check_in_code_with_raw() / self_check_in() — never stored plaintext.

-- ============================================================================
-- Enums
-- ============================================================================

do $$ begin
  create type public.attendance_method_t as enum (
    'admin_click',
    'self_code'
  );
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Table: event_attendances
-- One row per (event, user). Admin check-ins set checked_in_by = admin; self
-- check-ins set method = self_code. Correction history recorded in audit_log.
-- ============================================================================
create table public.event_attendances (
  event_id        uuid not null references public.events(id)   on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  checked_in_at   timestamptz not null default now(),
  checked_in_by   uuid references public.profiles(id) on delete set null,
  method          public.attendance_method_t not null,
  note            text check (note is null or length(note) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint event_attendances_pk primary key (event_id, user_id)
);

comment on table public.event_attendances is
  'One row per (event, user). Admin check-ins set checked_in_by = admin; self check-ins set method = self_code. Correction history recorded in audit_log.';

-- Admin roster join: attendance exists?
create index event_attendances_event_idx
  on public.event_attendances (event_id);

-- Self history: who attended what and when.
create index event_attendances_user_idx
  on public.event_attendances (user_id, checked_in_at desc);

create trigger event_attendances_set_updated_at
  before update on public.event_attendances
  for each row execute function public.set_updated_at();

alter table public.event_attendances enable row level security;

-- -------- event_attendances policies --------

create policy event_attendances_select_own
  on public.event_attendances for select
  to authenticated
  using (auth.uid() = user_id);

create policy event_attendances_select_admin
  on public.event_attendances for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy event_attendances_no_client_insert
  on public.event_attendances for insert
  to authenticated
  with check (false);

create policy event_attendances_no_client_update
  on public.event_attendances for update
  to authenticated
  using (false) with check (false);

create policy event_attendances_no_client_delete
  on public.event_attendances for delete
  to authenticated
  using (false);

-- ============================================================================
-- can_view_event — final version. Adds attendance branch for cancelled events:
-- users with either an existing RSVP or an attendance row keep detail access.
-- ============================================================================
create or replace function public.can_view_event(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select id, status, visibility
    from public.events
    where id = p_event_id
  ),
  invited as (
    select exists (
      select 1 from public.event_invites ei
      where ei.event_id = p_event_id
        and ei.user_id  = p_user_id
        and ei.revoked_at is null
    ) as ok
  ),
  rsvp_or_attend as (
    select
      (
        exists (
          select 1 from public.event_rsvps r
          where r.event_id = p_event_id
            and r.user_id  = p_user_id
            and r.status in ('going', 'waitlisted')
        )
        or exists (
          select 1 from public.event_attendances a
          where a.event_id = p_event_id
            and a.user_id  = p_user_id
        )
      ) as ok
  )
  select
    case
      when public.is_admin(p_user_id) then true
      when (select id from e) is null then false
      when (select status from e) in ('draft', 'archived') then false
      when (select status from e) = 'cancelled' then (select ok from rsvp_or_attend)
      when (select visibility from e) = 'members' then true
      when (select visibility from e) = 'private_invite' then (select ok from invited)
      else false
    end;
$$;

revoke all on function public.can_view_event(uuid, uuid) from public;
grant  execute on function public.can_view_event(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- Check-in rotation — raw-code only. App hands the DB a plaintext code over
-- TLS; pgcrypto.crypt() bcrypts it with a fresh salt. No pre-hashed variant
-- exists (see migration 1 note).
-- ============================================================================
create or replace function public.rotate_check_in_code_with_raw(
  p_event_id   uuid,
  p_raw_code   text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows int;
begin
  if not public.is_admin(v_uid) then
    raise exception 'rotate_check_in_code_with_raw: admin only' using errcode = 'P0001';
  end if;
  if p_raw_code is null or length(p_raw_code) < 4 or length(p_raw_code) > 20 then
    raise exception 'rotate_check_in_code_with_raw: code length out of range'
      using errcode = 'P0001';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'rotate_check_in_code_with_raw: expires_at must be in the future'
      using errcode = 'P0001';
  end if;

  update public.events
     set check_in_code_hash       = crypt(p_raw_code, gen_salt('bf', 10)),
         check_in_code_expires_at = p_expires_at,
         updated_by               = v_uid
   where id = p_event_id;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'rotate_check_in_code_with_raw: event not found'
      using errcode = 'P0002';
  end if;

  perform public.write_audit(
    'event.rotate_check_in_code', v_uid, null,
    jsonb_build_object('event_id', p_event_id, 'expires_at', p_expires_at)
  );
end;
$$;

revoke all on function public.rotate_check_in_code_with_raw(uuid, text, timestamptz) from public;
grant  execute on function public.rotate_check_in_code_with_raw(uuid, text, timestamptz)
  to authenticated, service_role;

-- ============================================================================
-- Attendance helpers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admin_check_in_member(event_id, user_id, note) — admin walk-in or roster click.
-- Event must exist; status in (published|cancelled). Allows walk-ins (no RSVP).
-- Upsert: if a row already exists this is a no-op on method/checked_in_at (use
-- correct_attendance to change an existing row). Note may be appended.
-- ----------------------------------------------------------------------------
create or replace function public.admin_check_in_member(
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
  v_uid      uuid := auth.uid();
  v_status   public.event_status_t;
  v_had_rsvp boolean;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_check_in_member: admin only' using errcode = 'P0001';
  end if;

  select status into v_status
    from public.events
   where id = p_event_id;
  if v_status is null then
    raise exception 'admin_check_in_member: event not found' using errcode = 'P0002';
  end if;
  if v_status not in ('published', 'cancelled') then
    raise exception 'admin_check_in_member: event status must be published|cancelled, got %', v_status
      using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.event_rsvps
     where event_id = p_event_id and user_id = p_user_id
  ) into v_had_rsvp;

  insert into public.event_attendances (
    event_id, user_id, method, checked_in_by, checked_in_at, note
  )
  values (
    p_event_id, p_user_id, 'admin_click', v_uid, now(), p_note
  )
  on conflict (event_id, user_id) do update
    set note = coalesce(excluded.note, public.event_attendances.note);

  perform public.write_audit(
    'event.admin_check_in', v_uid, p_user_id,
    jsonb_build_object(
      'event_id',       p_event_id,
      'target_user_id', p_user_id,
      'had_rsvp',       v_had_rsvp
    )
  );
end;
$$;

revoke all on function public.admin_check_in_member(uuid, uuid, text) from public;
grant  execute on function public.admin_check_in_member(uuid, uuid, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- self_check_in(event_id, raw_code) — member self-service.
-- Rate limited 10/60s. Window check: now() between starts_at - 2h and ends_at + 2h.
-- Requires RSVP status = going. Rejects duplicate attendance. Uses pgcrypto.crypt
-- for bcrypt verification (events.check_in_code_hash stored as bcrypt hash).
-- ----------------------------------------------------------------------------
create or replace function public.self_check_in(p_event_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_hash    text;
  v_expires timestamptz;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_status  public.event_status_t;
  v_rsvp    public.rsvp_status_t;
  v_exists  boolean;
  v_rate    record;
begin
  if v_uid is null then
    raise exception 'self_check_in: unauthenticated' using errcode = 'P0001';
  end if;

  select allowed into v_rate
    from public.consume_rate_limit('event_self_checkin', v_uid::text, 10, 60);
  if not v_rate.allowed then
    raise exception 'self_check_in: rate limited' using errcode = 'P0001';
  end if;

  select status, starts_at, ends_at, check_in_code_hash, check_in_code_expires_at
    into v_status, v_starts, v_ends, v_hash, v_expires
  from public.events
  where id = p_event_id
  for update;

  if v_status is null then
    raise exception 'self_check_in: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'published' then
    raise exception 'self_check_in: event not published' using errcode = 'P0001';
  end if;
  if now() < v_starts - interval '2 hours' or now() > v_ends + interval '2 hours' then
    raise exception 'self_check_in: outside event window' using errcode = 'P0001';
  end if;
  if v_hash is null then
    raise exception 'self_check_in: no code configured' using errcode = 'P0001';
  end if;
  if v_expires is not null and v_expires <= now() then
    raise exception 'self_check_in: code expired' using errcode = 'P0001';
  end if;
  if crypt(p_code, v_hash) <> v_hash then
    raise exception 'self_check_in: invalid code' using errcode = 'P0001';
  end if;

  select status into v_rsvp
    from public.event_rsvps
   where event_id = p_event_id and user_id = v_uid;
  if v_rsvp is distinct from 'going' then
    raise exception 'self_check_in: no going RSVP' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.event_attendances
     where event_id = p_event_id and user_id = v_uid
  ) into v_exists;
  if v_exists then
    raise exception 'self_check_in: already checked in' using errcode = 'P0001';
  end if;

  insert into public.event_attendances (
    event_id, user_id, method, checked_in_by
  ) values (
    p_event_id, v_uid, 'self_code', v_uid
  );

  perform public.write_audit(
    'event.self_check_in', v_uid, null,
    jsonb_build_object('event_id', p_event_id, 'method', 'self_code')
  );
end;
$$;

revoke all on function public.self_check_in(uuid, text) from public;
grant  execute on function public.self_check_in(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- correct_attendance(event_id, user_id, action, note) — admin correction helper.
-- action in ('set', 'remove', 'update_note'). Records before/after in audit.
-- ----------------------------------------------------------------------------
create or replace function public.correct_attendance(
  p_event_id uuid,
  p_user_id  uuid,
  p_action   text,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_before jsonb;
  v_after  jsonb;
  v_rows   int;
begin
  if not public.is_admin(v_uid) then
    raise exception 'correct_attendance: admin only' using errcode = 'P0001';
  end if;
  if p_action not in ('set', 'remove', 'update_note') then
    raise exception 'correct_attendance: action must be set|remove|update_note'
      using errcode = 'P0001';
  end if;

  select to_jsonb(a.*) into v_before
    from public.event_attendances a
   where a.event_id = p_event_id and a.user_id = p_user_id
   for update;

  if p_action = 'set' then
    insert into public.event_attendances (
      event_id, user_id, method, checked_in_by, checked_in_at, note
    )
    values (
      p_event_id, p_user_id, 'admin_click', v_uid, now(), p_note
    )
    on conflict (event_id, user_id) do update
      set method        = 'admin_click',
          checked_in_by = v_uid,
          checked_in_at = now(),
          note          = coalesce(excluded.note, public.event_attendances.note);

  elsif p_action = 'remove' then
    if v_before is null then
      raise exception 'correct_attendance: attendance not found' using errcode = 'P0002';
    end if;
    delete from public.event_attendances
     where event_id = p_event_id and user_id = p_user_id;

  elsif p_action = 'update_note' then
    if v_before is null then
      raise exception 'correct_attendance: attendance not found' using errcode = 'P0002';
    end if;
    update public.event_attendances
       set note = p_note
     where event_id = p_event_id and user_id = p_user_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'correct_attendance: attendance not found' using errcode = 'P0002';
    end if;
  end if;

  select to_jsonb(a.*) into v_after
    from public.event_attendances a
   where a.event_id = p_event_id and a.user_id = p_user_id;

  perform public.write_audit(
    'event.correct_attendance', v_uid, p_user_id,
    jsonb_build_object(
      'event_id',       p_event_id,
      'target_user_id', p_user_id,
      'action',         p_action,
      'before',         v_before,
      'after',          v_after
    )
  );
end;
$$;

revoke all on function public.correct_attendance(uuid, uuid, text, text) from public;
grant  execute on function public.correct_attendance(uuid, uuid, text, text)
  to authenticated, service_role;
