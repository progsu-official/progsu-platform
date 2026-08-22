-- Personal check-in QR: each profile gets a stable, rotatable code so a
-- member can be scanned into any event without an existing RSVP, unlike
-- `event_rsvps.checkin_token` (per-RSVP, regenerated on each `going`).
-- Separate column from `profiles.id` so a leaked/screenshotted QR can be
-- rotated without touching the account's PK.

alter table public.profiles
  add column checkin_code uuid not null default gen_random_uuid();

alter table public.profiles
  add constraint profiles_checkin_code_key unique (checkin_code);

-- Self-service rotation (e.g. after a leak). Own-row only, via auth.uid().
create function public.regenerate_checkin_code()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'regenerate_checkin_code: unauthenticated' using errcode = 'P0001';
  end if;

  update public.profiles set checkin_code = v_code where id = v_uid;

  perform public.write_audit(
    'profile.regenerate_checkin_code', v_uid, v_uid, '{}'::jsonb
  );

  return v_code;
end;
$$;

revoke all on function public.regenerate_checkin_code() from public;
grant  execute on function public.regenerate_checkin_code() to authenticated;

-- Widen admin_check_in_by_token with a third lookup: a personal profile code
-- carries no event of its own (unlike an event/guest RSVP token), so it needs
-- the caller to pass p_event_id explicitly. The scanner already has this
-- from its route (app/admin/events/[id]) and just starts passing it through.
--
-- Dropped and recreated rather than a same-signature `create or replace`:
-- adding a parameter changes the signature, so `create or replace` would
-- have created a second overload instead of replacing this one, and calls
-- with only (p_token, p_note) would then be ambiguous between the two.
drop function if exists public.admin_check_in_by_token(uuid, text);

create function public.admin_check_in_by_token(
  p_token    uuid,
  p_note     text default null,
  p_event_id uuid default null
)
returns table (out_event_id uuid, out_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_event_id      uuid;
  v_user_id       uuid;
  v_guest_rsvp_id uuid;
  v_status        public.event_status_t;
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
    select p.id into v_user_id
      from public.profiles p
     where p.checkin_code = p_token;

    if v_user_id is not null then
      if p_event_id is null then
        raise exception 'admin_check_in_by_token: event required for personal code' using errcode = 'P0002';
      end if;
      v_event_id := p_event_id;
    end if;
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
        'event_id',      v_event_id,
        'guest_rsvp_id', v_guest_rsvp_id,
        'method',        'qr_token'
      )
    );

    return query select v_event_id, null::uuid;
    -- Load-bearing: without it, execution falls into the member branch below.
    return;
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

revoke all on function public.admin_check_in_by_token(uuid, text, uuid) from public;
grant  execute on function public.admin_check_in_by_token(uuid, text, uuid)
  to authenticated, service_role;
