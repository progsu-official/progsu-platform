-- Admin roster gained "Remove attendance" but never a way to remove a
-- wrong/bogus RSVP itself (surfaced 2026-08-22 by a stray test RSVP on a
-- since-archived fake event). Straight delete — no cascade needed:
-- event_attendances is a separate table, so a walk-in check-in with no RSVP
-- (already a normal, supported state) is exactly what's left behind if one
-- existed.
create or replace function public.admin_remove_rsvp(
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
  v_before jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_remove_rsvp: admin only' using errcode = 'P0001';
  end if;

  select to_jsonb(r.*) into v_before
    from public.event_rsvps r
   where r.event_id = p_event_id and r.user_id = p_user_id;

  if v_before is null then
    raise exception 'admin_remove_rsvp: rsvp not found' using errcode = 'P0002';
  end if;

  delete from public.event_rsvps
   where event_id = p_event_id and user_id = p_user_id;

  perform public.write_audit(
    'event.admin_remove_rsvp', v_uid, p_user_id,
    jsonb_build_object(
      'event_id',       p_event_id,
      'target_user_id', p_user_id,
      'before',         v_before
    )
  );
end;
$$;

revoke all on function public.admin_remove_rsvp(uuid, uuid) from public;
grant  execute on function public.admin_remove_rsvp(uuid, uuid)
  to authenticated, service_role;
