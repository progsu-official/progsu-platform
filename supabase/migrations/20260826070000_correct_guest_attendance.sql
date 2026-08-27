-- ----------------------------------------------------------------------------
-- correct_guest_attendance(event_id, guest_rsvp_id, note) — admin undo of a
-- guest check-in. Mirrors correct_attendance's 'remove' action (see
-- 20260423000300_event_attendance.sql), but for event_guest_attendances,
-- keyed by guest_rsvp_id since a guest has no user_id. No set/update_note
-- branches: guest check-in only ever happens via admin_check_in_by_token, so
-- there's nothing in the UI that needs them.
-- ----------------------------------------------------------------------------
create or replace function public.correct_guest_attendance(
  p_event_id      uuid,
  p_guest_rsvp_id uuid,
  p_note          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_before jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'correct_guest_attendance: admin only' using errcode = 'P0001';
  end if;

  select to_jsonb(a.*) into v_before
    from public.event_guest_attendances a
   where a.event_id = p_event_id and a.guest_rsvp_id = p_guest_rsvp_id
   for update;

  if v_before is null then
    raise exception 'correct_guest_attendance: attendance not found' using errcode = 'P0002';
  end if;

  delete from public.event_guest_attendances
   where event_id = p_event_id and guest_rsvp_id = p_guest_rsvp_id;

  perform public.write_audit(
    'event.correct_guest_attendance', v_uid, null,
    jsonb_build_object(
      'event_id',      p_event_id,
      'guest_rsvp_id', p_guest_rsvp_id,
      'action',        'remove',
      'before',        v_before,
      'note',          p_note
    )
  );
end;
$$;

revoke all on function public.correct_guest_attendance(uuid, uuid, text) from public;
grant  execute on function public.correct_guest_attendance(uuid, uuid, text)
  to authenticated, service_role;
