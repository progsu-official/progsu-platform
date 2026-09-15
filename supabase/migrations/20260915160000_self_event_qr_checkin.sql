-- Migration — self-serve event QR check-in (docs/09-events-platform-plan.md D14).
-- Additive alongside D12/D13's staff-scans-attendee model, not a replacement:
-- an admin projects one QR per event and an attendee's own camera checks
-- them in through their own member session. No new secret/token — being a
-- signed-in member browsing /events/[slug]/check-in (member-gated by
-- middleware.ts same as any other /events/* path) IS the credential, same
-- trust level as walking up to an admin-staffed door. See D5/D13 for why an
-- earlier shared-code version of this was cut: unlike that one, there's no
-- separate typed/rotatable secret to leak or screenshot ahead of the event,
-- the QR just names the event and the app enforces "must be signed in".

-- ============================================================================
-- Enum: attendance_method_t gains self_qr
-- ============================================================================
alter type public.attendance_method_t add value if not exists 'self_qr';

-- ============================================================================
-- self_check_in_by_event(event_id) — the signed-in caller checks themself
-- into a published event. Upsert-as-no-op like admin_check_in_member (a
-- re-scan shouldn't error on a self-serve surface), but reports whether the
-- row already existed so the page can render "already checked in" instead of
-- a fresh confirmation.
-- ============================================================================
create or replace function public.self_check_in_by_event(p_event_id uuid)
returns table (out_checked_in_at timestamptz, out_already boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_status   public.event_status_t;
  v_existing timestamptz;
begin
  if v_uid is null then
    raise exception 'self_check_in_by_event: unauthenticated' using errcode = 'P0001';
  end if;

  select status into v_status from public.events where id = p_event_id;
  if v_status is null then
    raise exception 'self_check_in_by_event: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'published' then
    raise exception 'self_check_in_by_event: event is not open for check-in' using errcode = 'P0001';
  end if;

  select checked_in_at into v_existing
    from public.event_attendances
   where event_id = p_event_id and user_id = v_uid;

  if v_existing is not null then
    return query select v_existing, true;
    return;
  end if;

  insert into public.event_attendances (
    event_id, user_id, method, checked_in_by, checked_in_at
  ) values (
    p_event_id, v_uid, 'self_qr', v_uid, now()
  );

  perform public.write_audit(
    'event.self_check_in', v_uid, v_uid,
    jsonb_build_object('event_id', p_event_id, 'method', 'self_qr')
  );

  return query select now(), false;
end;
$$;

revoke all on function public.self_check_in_by_event(uuid) from public;
grant  execute on function public.self_check_in_by_event(uuid)
  to authenticated;
