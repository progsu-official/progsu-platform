-- Guest self-serve check-in, the guest-side counterpart to
-- self_check_in_by_event() (D14). A guest has no account/session to serve as
-- the credential, so their opaque checkin_token stands in for it instead —
-- same trust model as guest_ticket_by_token(), just mutating instead of
-- reading. This is what lets /tickets/[token] add a "Check me in" button
-- with no name/email typing and no staff interaction: holding the link (or
-- having scanned their own QR) already proves who they are, exactly like
-- being signed in does for a member.
create function public.guest_self_check_in_by_token(p_token uuid)
returns table (out_checked_in_at timestamptz, out_already boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id      uuid;
  v_guest_rsvp_id uuid;
  v_status        public.event_status_t;
  v_existing      timestamptz;
begin
  if p_token is null then
    raise exception 'guest_self_check_in_by_token: invalid token' using errcode = 'P0002';
  end if;

  select g.event_id, g.id into v_event_id, v_guest_rsvp_id
    from public.event_guest_rsvps g
   where g.checkin_token = p_token and g.status = 'going';

  if v_guest_rsvp_id is null then
    raise exception 'guest_self_check_in_by_token: invalid token' using errcode = 'P0002';
  end if;

  select status into v_status from public.events where id = v_event_id;
  if v_status <> 'published' then
    raise exception 'guest_self_check_in_by_token: event is not open for check-in' using errcode = 'P0001';
  end if;

  select checked_in_at into v_existing
    from public.event_guest_attendances
   where guest_rsvp_id = v_guest_rsvp_id;

  if v_existing is not null then
    return query select v_existing, true;
    return;
  end if;

  insert into public.event_guest_attendances (
    event_id, guest_rsvp_id, method, checked_in_by, checked_in_at
  ) values (
    v_event_id, v_guest_rsvp_id, 'self_qr', null, now()
  );

  perform public.write_audit(
    'event.guest_self_check_in', null, null,
    jsonb_build_object(
      'event_id', v_event_id,
      'guest_rsvp_id', v_guest_rsvp_id,
      'method', 'self_qr'
    )
  );

  return query select now(), false;
end;
$$;

revoke all on function public.guest_self_check_in_by_token(uuid) from public;
grant  execute on function public.guest_self_check_in_by_token(uuid)
  to anon, authenticated;
