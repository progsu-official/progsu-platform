-- Bug fix for 20260821040000's guest branch in admin_check_in_by_token.
--
-- `return query` inside a `returns table` plpgsql function APPENDS rows to the
-- result set and keeps executing — it is not a `return` statement. So after
-- the guest branch inserted into event_guest_attendances and did its
-- `return query select v_event_id, null::uuid`, control fell straight through
-- into the member branch below it, which tried
--
--     insert into event_attendances (event_id, user_id, ...) values (..., v_user_id, ...)
--
-- with v_user_id still NULL (a guest token never populates it), raising
--
--     null value in column "user_id" of relation "event_attendances"
--     violates not-null constraint
--
-- and rolling back the whole call, including the guest attendance row that had
-- just been written. Net effect: guest check-in by token was 100% broken and
-- surfaced as an opaque constraint error, not the intended clean path.
--
-- Fix is one bare `return;`. Kept as a separate migration rather than an edit
-- to 20260821040000 per hard rule #2 (migrations are append-only), so this
-- applies forward without a db reset.
--
-- The member branch's own trailing `return query` needs no guard — it is the
-- last statement in the block.

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
    -- Load-bearing: without it, execution continues into the member branch
    -- below and inserts a NULL user_id into event_attendances.
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

revoke all on function public.admin_check_in_by_token(uuid, text) from public;
grant  execute on function public.admin_check_in_by_token(uuid, text)
  to authenticated, service_role;
