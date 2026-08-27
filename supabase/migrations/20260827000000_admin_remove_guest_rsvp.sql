-- admin_remove_guest_rsvp(event_id, guest_rsvp_id) — guest counterpart to
-- admin_remove_rsvp (see 20260822040000_admin_remove_rsvp.sql). Unlike the
-- member version, this doesn't need a separate attendance cleanup step:
-- event_guest_attendances.guest_rsvp_id already cascades on delete, and a
-- guest has no persistent identity outside this RSVP row for a walk-in
-- check-in to be "left behind" under.
create or replace function public.admin_remove_guest_rsvp(
  p_event_id      uuid,
  p_guest_rsvp_id uuid
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
    raise exception 'admin_remove_guest_rsvp: admin only' using errcode = 'P0001';
  end if;

  select to_jsonb(r.*) into v_before
    from public.event_guest_rsvps r
   where r.event_id = p_event_id and r.id = p_guest_rsvp_id;

  if v_before is null then
    raise exception 'admin_remove_guest_rsvp: rsvp not found' using errcode = 'P0002';
  end if;

  delete from public.event_guest_rsvps
   where event_id = p_event_id and id = p_guest_rsvp_id;

  perform public.write_audit(
    'event.admin_remove_guest_rsvp', v_uid, null,
    jsonb_build_object(
      'event_id',      p_event_id,
      'guest_rsvp_id', p_guest_rsvp_id,
      'before',        v_before
    )
  );
end;
$$;

revoke all on function public.admin_remove_guest_rsvp(uuid, uuid) from public;
grant  execute on function public.admin_remove_guest_rsvp(uuid, uuid)
  to authenticated, service_role;
