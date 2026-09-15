-- Migration — staff remove check-in (undo a manual/QR check-in from the
-- door). Mirrors correct_attendance's 'remove' action and
-- correct_guest_attendance, same relationship staff_check_in_member already
-- has to admin_check_in_member: service_role only, no admin check, no real
-- actor to attribute the correction to.

create or replace function public.staff_remove_check_in(
  p_event_id uuid,
  p_user_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  select to_jsonb(a.*) into v_before
    from public.event_attendances a
   where a.event_id = p_event_id and a.user_id = p_user_id
   for update;

  if v_before is null then
    raise exception 'staff_remove_check_in: attendance not found' using errcode = 'P0002';
  end if;

  delete from public.event_attendances
   where event_id = p_event_id and user_id = p_user_id;

  perform public.write_audit(
    'event.staff_remove_check_in', null, p_user_id,
    jsonb_build_object(
      'event_id',       p_event_id,
      'target_user_id', p_user_id,
      'before',         v_before,
      'via',            'staff_manual'
    )
  );
end;
$$;

revoke all on function public.staff_remove_check_in(uuid, uuid) from public;
grant  execute on function public.staff_remove_check_in(uuid, uuid)
  to service_role;

create or replace function public.staff_remove_guest_check_in(
  p_event_id      uuid,
  p_guest_rsvp_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  select to_jsonb(a.*) into v_before
    from public.event_guest_attendances a
   where a.event_id = p_event_id and a.guest_rsvp_id = p_guest_rsvp_id
   for update;

  if v_before is null then
    raise exception 'staff_remove_guest_check_in: attendance not found' using errcode = 'P0002';
  end if;

  delete from public.event_guest_attendances
   where event_id = p_event_id and guest_rsvp_id = p_guest_rsvp_id;

  perform public.write_audit(
    'event.staff_remove_guest_check_in', null, null,
    jsonb_build_object(
      'event_id',      p_event_id,
      'guest_rsvp_id', p_guest_rsvp_id,
      'before',        v_before,
      'via',           'staff_manual'
    )
  );
end;
$$;

revoke all on function public.staff_remove_guest_check_in(uuid, uuid) from public;
grant  execute on function public.staff_remove_guest_check_in(uuid, uuid)
  to service_role;
