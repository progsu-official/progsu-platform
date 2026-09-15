-- Staff door check-in: a shared-secret token (STAFF_CHECKIN_TOKEN, verified
-- app-side at /checkin, never in this database) lets non-admin volunteers
-- scan people in without an admin account. This RPC is the door itself:
-- granted to service_role only, so it is unreachable from any anon/
-- authenticated browser session — the app's /checkin server actions are the
-- only caller, and they gate on the shared token before ever calling this.
--
-- Copy of admin_check_in_by_token's token-resolution body (event_rsvps ->
-- event_guest_rsvps -> profiles.checkin_code) with the is_admin() gate
-- dropped and no real actor to attribute the scan to.

-- event_attendances.checked_in_by is already nullable ("self check-ins set
-- method = self_code"); event_guest_attendances was NOT NULL only because no
-- actor-less write path existed yet. Relax it to match.
alter table public.event_guest_attendances
  alter column checked_in_by drop not null;

create function public.staff_check_in_by_token(
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
  v_event_id      uuid;
  v_user_id       uuid;
  v_guest_rsvp_id uuid;
  v_status        public.event_status_t;
begin
  if p_token is null then
    raise exception 'staff_check_in_by_token: invalid token' using errcode = 'P0002';
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
        raise exception 'staff_check_in_by_token: event required for personal code' using errcode = 'P0002';
      end if;
      v_event_id := p_event_id;
    end if;
  end if;

  if v_event_id is null then
    raise exception 'staff_check_in_by_token: invalid token' using errcode = 'P0002';
  end if;

  select status into v_status
    from public.events
   where id = v_event_id;
  if v_status not in ('published', 'cancelled') then
    raise exception 'staff_check_in_by_token: event status must be published|cancelled, got %', v_status
      using errcode = 'P0001';
  end if;

  if v_guest_rsvp_id is not null then
    if exists (
      select 1 from public.event_guest_attendances
       where event_id = v_event_id and guest_rsvp_id = v_guest_rsvp_id
    ) then
      raise exception 'staff_check_in_by_token: already checked in' using errcode = 'P0001';
    end if;

    insert into public.event_guest_attendances (
      event_id, guest_rsvp_id, method, checked_in_by, checked_in_at, note
    ) values (
      v_event_id, v_guest_rsvp_id, 'qr_token', null, now(), p_note
    );

    perform public.write_audit(
      'event.staff_check_in_guest', null, null,
      jsonb_build_object(
        'event_id',      v_event_id,
        'guest_rsvp_id', v_guest_rsvp_id,
        'method',        'qr_token',
        'via',           'staff_token'
      )
    );

    return query select v_event_id, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.event_attendances
     where event_id = v_event_id and user_id = v_user_id
  ) then
    raise exception 'staff_check_in_by_token: already checked in' using errcode = 'P0001';
  end if;

  insert into public.event_attendances (
    event_id, user_id, method, checked_in_by, checked_in_at, note
  ) values (
    v_event_id, v_user_id, 'qr_token', null, now(), p_note
  );

  perform public.write_audit(
    'event.staff_check_in', null, v_user_id,
    jsonb_build_object(
      'event_id',       v_event_id,
      'target_user_id', v_user_id,
      'method',         'qr_token',
      'via',            'staff_token'
    )
  );

  return query select v_event_id, v_user_id;
end;
$$;

revoke all on function public.staff_check_in_by_token(uuid, text, uuid) from public;
grant  execute on function public.staff_check_in_by_token(uuid, text, uuid)
  to service_role;
