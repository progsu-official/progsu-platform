-- Migration — QR check-in (D12, docs/09-events-platform-plan.md §7.5).
-- Additive second check-in path alongside the existing shared code (D5), not
-- a replacement. Adds a per-attendee opaque token to event_rsvps, maintained
-- by the existing waitlist-timestamp trigger the same way waitlisted_at
-- already is (set on entry to `going`, cleared on exit). Staff resolve a
-- scanned token via admin_check_in_by_token(), which writes through the same
-- event_attendances insert path as admin_check_in_member().

-- ============================================================================
-- Enum: attendance_method_t gains qr_token
-- ============================================================================
alter type public.attendance_method_t add value if not exists 'qr_token';

-- ============================================================================
-- Column: event_rsvps.checkin_token
-- ============================================================================
alter table public.event_rsvps
  add column if not exists checkin_token uuid;

-- Partial unique index: only `going` RSVPs ever carry a token, so this is
-- effectively unique-while-going, matching the waitlist partial-index style
-- already used on this table.
create unique index if not exists event_rsvps_checkin_token_idx
  on public.event_rsvps (checkin_token)
  where checkin_token is not null;

comment on column public.event_rsvps.checkin_token is
  'Opaque per-attendee QR check-in token (D12). Set when status -> going, cleared otherwise. See docs/09 §7.5.';

-- ============================================================================
-- Trigger: extend the existing waitlist-timestamp trigger to also maintain
-- checkin_token, same lifecycle rule as waitlisted_at.
-- ============================================================================
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
    if new.status = 'going' and new.checkin_token is null then
      new.checkin_token := gen_random_uuid();
    elsif new.status <> 'going' then
      new.checkin_token := null;
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
      if new.status = 'going' then
        new.checkin_token := coalesce(old.checkin_token, gen_random_uuid());
      else
        new.checkin_token := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- admin_check_in_by_token(token, note) — resolves a scanned QR token to its
-- (event_id, user_id), then writes through the same insert path as
-- admin_check_in_member(). Admin only (D7). Unlike admin_check_in_member's
-- upsert-as-no-op, a duplicate scan raises explicitly, so the caller can show
-- a distinct "already checked in" outcome (see SCOPE.md "done looks like").
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
  v_uid      uuid := auth.uid();
  v_event_id uuid;
  v_user_id  uuid;
  v_status   public.event_status_t;
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
    raise exception 'admin_check_in_by_token: invalid token' using errcode = 'P0002';
  end if;

  select status into v_status
    from public.events
   where id = v_event_id;
  if v_status not in ('published', 'cancelled') then
    raise exception 'admin_check_in_by_token: event status must be published|cancelled, got %', v_status
      using errcode = 'P0001';
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
