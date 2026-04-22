-- Migration 000070 — fix pgcrypto lookup for check-in helpers.
--
-- rotate_check_in_code_with_raw() and self_check_in() call crypt() / gen_salt()
-- unqualified. pgcrypto lives in the `extensions` schema on Supabase, so
-- `set search_path = public` prevents resolution and raises:
--   function gen_salt(unknown, integer) does not exist
-- Fix: extend search_path to include `extensions` on both helpers.

create or replace function public.rotate_check_in_code_with_raw(
  p_event_id   uuid,
  p_raw_code   text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, extensions
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

create or replace function public.self_check_in(p_event_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions
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
grant  execute on function public.self_check_in(uuid, text)
  to authenticated, service_role;
