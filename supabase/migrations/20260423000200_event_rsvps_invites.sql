-- Migration 000010 — event_invites + event_rsvps tables, invite/RSVP helpers,
-- waitlist-ordering trigger, and an updated can_view_event() that honours
-- private-invite visibility. event_attendances is still absent in this
-- migration, so the cancelled-event branch only resolves via RSVP here;
-- migration 3 replaces can_view_event() again to include attendance.

-- ============================================================================
-- Enums
-- ============================================================================

do $$ begin
  create type public.rsvp_status_t as enum (
    'going',
    'waitlisted',
    'declined',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Table: event_invites
-- Explicit invites for private_invite events. Revocation is soft via revoked_at
-- so the audit trail persists across re-invites.
-- ============================================================================
create table public.event_invites (
  event_id     uuid not null references public.events(id)   on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  invited_by   uuid references public.profiles(id) on delete set null,
  invited_at   timestamptz not null default now(),
  revoked_at   timestamptz,

  constraint event_invites_pk primary key (event_id, user_id)
);

comment on table public.event_invites is
  'Explicit invites for private_invite events. Revocation is soft via revoked_at so audit trail persists.';

create index event_invites_user_idx
  on public.event_invites (user_id)
  where revoked_at is null;

alter table public.event_invites enable row level security;

-- -------- event_invites policies --------

create policy event_invites_select_admin
  on public.event_invites for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy event_invites_select_own
  on public.event_invites for select
  to authenticated
  using (auth.uid() = user_id and revoked_at is null);

create policy event_invites_admin_all
  on public.event_invites for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- No client INSERT/UPDATE/DELETE for members on invites — admins go through
-- invite_member_to_event / revoke_event_invite helpers.

-- ============================================================================
-- Table: event_rsvps
-- One row per (event, user). Mutable. Correction history recorded in audit_log.
-- ============================================================================
create table public.event_rsvps (
  event_id           uuid not null references public.events(id)   on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  status             public.rsvp_status_t not null,
  comment            text check (comment is null or length(comment) <= 500),
  rsvp_at            timestamptz not null default now(),
  status_changed_at  timestamptz not null default now(),
  waitlisted_at      timestamptz,
  updated_at         timestamptz not null default now(),

  constraint event_rsvps_pk primary key (event_id, user_id),
  constraint event_rsvps_waitlist_consistency check (
    (status = 'waitlisted' and waitlisted_at is not null)
    or (status <> 'waitlisted' and waitlisted_at is null)
  )
);

comment on table public.event_rsvps is
  'One row per (event, user). Mutable. Correction history recorded in audit_log.';
comment on column public.event_rsvps.waitlisted_at is
  'Deterministic waitlist ordering timestamp. Set when status transitions to waitlisted; cleared on exit. Queue order = (waitlisted_at asc, user_id asc).';

-- ----------------------------------------------------------------------------
-- Indexes (event_rsvps)
-- ----------------------------------------------------------------------------

-- Roster + capacity counts: `going` and `waitlisted` are the hot states.
create index event_rsvps_event_status_idx
  on public.event_rsvps (event_id, status);

-- Waitlist FIFO query.
create index event_rsvps_event_waitlist_idx
  on public.event_rsvps (event_id, waitlisted_at asc, user_id asc)
  where status = 'waitlisted';

-- Member "My Plans" feed: latest per-user status.
create index event_rsvps_user_idx
  on public.event_rsvps (user_id, status_changed_at desc);

-- ----------------------------------------------------------------------------
-- Triggers (event_rsvps)
-- ----------------------------------------------------------------------------

create trigger event_rsvps_set_updated_at
  before update on public.event_rsvps
  for each row execute function public.set_updated_at();

-- Maintain waitlisted_at + status_changed_at invariants automatically.
-- waitlisted_at is set on transition to waitlisted (preserving prior stamp on
-- re-entry to the same waitlist is not desired — we start a fresh spot).
create or replace function public.event_rsvps_maintain_waitlist_ts()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'waitlisted' and new.waitlisted_at is null then
      new.waitlisted_at := now();
    elsif new.status <> 'waitlisted' then
      new.waitlisted_at := null;
    end if;
    new.status_changed_at := now();
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      new.status_changed_at := now();
      if new.status = 'waitlisted' then
        new.waitlisted_at := coalesce(old.waitlisted_at, now());
      else
        new.waitlisted_at := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger event_rsvps_waitlist_ts
  before insert or update on public.event_rsvps
  for each row execute function public.event_rsvps_maintain_waitlist_ts();

alter table public.event_rsvps enable row level security;

-- -------- event_rsvps policies --------

create policy event_rsvps_select_own
  on public.event_rsvps for select
  to authenticated
  using (auth.uid() = user_id);

create policy event_rsvps_select_admin
  on public.event_rsvps for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- Direct client writes denied — mutations go through rsvp_to_event and
-- promote_waitlisted_member (D7).
create policy event_rsvps_no_client_insert
  on public.event_rsvps for insert
  to authenticated
  with check (false);

create policy event_rsvps_no_client_update
  on public.event_rsvps for update
  to authenticated
  using (false) with check (false);

create policy event_rsvps_no_client_delete
  on public.event_rsvps for delete
  to authenticated
  using (false);

-- ============================================================================
-- can_view_event — replace stub from migration 1 with the invite-aware variant.
-- Cancelled remains RSVP-only here (attendance branch added in migration 3).
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
  rsvp_ok as (
    select exists (
      select 1 from public.event_rsvps r
      where r.event_id = p_event_id
        and r.user_id  = p_user_id
        and r.status in ('going', 'waitlisted')
    ) as ok
  )
  select
    case
      when public.is_admin(p_user_id) then true
      when (select id from e) is null then false
      when (select status from e) in ('draft', 'archived') then false
      when (select status from e) = 'cancelled' then (select ok from rsvp_ok)
      when (select visibility from e) = 'members' then true
      when (select visibility from e) = 'private_invite' then (select ok from invited)
      else false
    end;
$$;

revoke all on function public.can_view_event(uuid, uuid) from public;
grant  execute on function public.can_view_event(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- Invite helpers (admin-only)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- invite_member_to_event(event_id, user_id) — upsert, un-revoke on conflict.
-- ----------------------------------------------------------------------------
create or replace function public.invite_member_to_event(
  p_event_id uuid,
  p_user_id  uuid
)
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
    raise exception 'invite_member_to_event: admin only' using errcode = 'P0001';
  end if;

  select status into v_status
    from public.events
   where id = p_event_id;
  if v_status is null then
    raise exception 'invite_member_to_event: event not found' using errcode = 'P0002';
  end if;
  if v_status = 'archived' then
    raise exception 'invite_member_to_event: event is archived' using errcode = 'P0001';
  end if;

  insert into public.event_invites (event_id, user_id, invited_by)
  values (p_event_id, p_user_id, v_uid)
  on conflict (event_id, user_id) do update
    set revoked_at = null,
        invited_by = v_uid,
        invited_at = now();

  perform public.write_audit(
    'event.invite', v_uid, p_user_id,
    jsonb_build_object('event_id', p_event_id, 'target_user_id', p_user_id)
  );
end;
$$;

revoke all on function public.invite_member_to_event(uuid, uuid) from public;
grant  execute on function public.invite_member_to_event(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- revoke_event_invite(event_id, user_id) — set revoked_at.
-- ----------------------------------------------------------------------------
create or replace function public.revoke_event_invite(
  p_event_id uuid,
  p_user_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if not public.is_admin(v_uid) then
    raise exception 'revoke_event_invite: admin only' using errcode = 'P0001';
  end if;

  update public.event_invites
     set revoked_at = now()
   where event_id = p_event_id
     and user_id  = p_user_id
     and revoked_at is null;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'revoke_event_invite: no active invite' using errcode = 'P0002';
  end if;

  perform public.write_audit(
    'event.invite_revoke', v_uid, p_user_id,
    jsonb_build_object('event_id', p_event_id, 'target_user_id', p_user_id)
  );
end;
$$;

revoke all on function public.revoke_event_invite(uuid, uuid) from public;
grant  execute on function public.revoke_event_invite(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- RSVP helpers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- rsvp_to_event(event_id, desired, comment) — member RSVP.
-- Preconditions: authenticated, fully onboarded, can_view_event,
--   desired in (going|declined|cancelled), rate-limited at 20/60s.
-- Capacity/waitlist logic: when desired=going and event is full, fall back to
-- waitlisted if waitlist_enabled else raise P0001 'event is full'.
-- Returns the effective status actually stored.
-- ----------------------------------------------------------------------------
create or replace function public.rsvp_to_event(
  p_event_id uuid,
  p_desired  public.rsvp_status_t,
  p_comment  text default null
)
returns public.rsvp_status_t
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_capacity    int;
  v_waitlist    boolean;
  v_status      public.event_status_t;
  v_current     public.rsvp_status_t;
  v_going_count int;
  v_effective   public.rsvp_status_t;
  v_rate        record;
begin
  if v_uid is null then
    raise exception 'rsvp_to_event: unauthenticated' using errcode = 'P0001';
  end if;
  if not public.is_fully_onboarded(v_uid) then
    raise exception 'rsvp_to_event: not fully onboarded' using errcode = 'P0001';
  end if;
  if not public.can_view_event(p_event_id, v_uid) then
    raise exception 'rsvp_to_event: not visible' using errcode = 'P0001';
  end if;
  if p_desired not in ('going', 'declined', 'cancelled') then
    raise exception 'rsvp_to_event: desired must be going|declined|cancelled'
      using errcode = 'P0001';
  end if;

  select allowed into v_rate
    from public.consume_rate_limit('event_rsvp', v_uid::text, 20, 60);
  if not v_rate.allowed then
    raise exception 'rsvp_to_event: rate limited' using errcode = 'P0001';
  end if;

  select status, capacity, waitlist_enabled
    into v_status, v_capacity, v_waitlist
  from public.events
  where id = p_event_id
  for update;

  if v_status is null then
    raise exception 'rsvp_to_event: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'published' then
    raise exception 'rsvp_to_event: event not published' using errcode = 'P0001';
  end if;

  select status into v_current
    from public.event_rsvps
   where event_id = p_event_id and user_id = v_uid
   for update;

  if p_desired = 'going' then
    if v_capacity is null then
      v_effective := 'going';
    else
      select count(*)::int into v_going_count
        from public.event_rsvps
       where event_id = p_event_id
         and status = 'going'
         and user_id <> v_uid;
      if v_going_count < v_capacity then
        v_effective := 'going';
      elsif v_waitlist then
        v_effective := 'waitlisted';
      else
        raise exception 'rsvp_to_event: event is full' using errcode = 'P0001';
      end if;
    end if;
  else
    v_effective := p_desired;
  end if;

  insert into public.event_rsvps (event_id, user_id, status, comment)
  values (p_event_id, v_uid, v_effective, p_comment)
  on conflict (event_id, user_id) do update
    set status  = excluded.status,
        comment = coalesce(excluded.comment, public.event_rsvps.comment);

  perform public.write_audit(
    'event.rsvp', v_uid, null,
    jsonb_build_object(
      'event_id',         p_event_id,
      'previous',         v_current,
      'effective',        v_effective,
      'capacity',         v_capacity,
      'waitlist_enabled', v_waitlist
    )
  );
  return v_effective;
end;
$$;

revoke all on function public.rsvp_to_event(uuid, public.rsvp_status_t, text) from public;
grant  execute on function public.rsvp_to_event(uuid, public.rsvp_status_t, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- promote_waitlisted_member(event_id, user_id) — admin manual promotion (D4).
-- Respects capacity: raise P0001 'event is full' if capacity would be exceeded.
-- ----------------------------------------------------------------------------
create or replace function public.promote_waitlisted_member(
  p_event_id uuid,
  p_user_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_status      public.event_status_t;
  v_capacity    int;
  v_going_count int;
  v_current     public.rsvp_status_t;
begin
  if not public.is_admin(v_uid) then
    raise exception 'promote_waitlisted_member: admin only' using errcode = 'P0001';
  end if;

  select status, capacity
    into v_status, v_capacity
  from public.events
  where id = p_event_id
  for update;
  if v_status is null then
    raise exception 'promote_waitlisted_member: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'published' then
    raise exception 'promote_waitlisted_member: event not published'
      using errcode = 'P0001';
  end if;

  select status into v_current
    from public.event_rsvps
   where event_id = p_event_id and user_id = p_user_id
   for update;
  if v_current is null or v_current <> 'waitlisted' then
    raise exception 'promote_waitlisted_member: target not waitlisted'
      using errcode = 'P0001';
  end if;

  if v_capacity is not null then
    select count(*)::int into v_going_count
      from public.event_rsvps
     where event_id = p_event_id
       and status = 'going';
    if v_going_count >= v_capacity then
      raise exception 'promote_waitlisted_member: event is full'
        using errcode = 'P0001';
    end if;
  end if;

  update public.event_rsvps
     set status = 'going'
   where event_id = p_event_id
     and user_id  = p_user_id;

  perform public.write_audit(
    'event.promote_waitlist', v_uid, p_user_id,
    jsonb_build_object('event_id', p_event_id, 'target_user_id', p_user_id)
  );
end;
$$;

revoke all on function public.promote_waitlisted_member(uuid, uuid) from public;
grant  execute on function public.promote_waitlisted_member(uuid, uuid)
  to authenticated, service_role;
