-- Per the 2026-08-20 Joey/John Slack decision: RSVPing only requires a
-- Google-authenticated session, not a finished onboarding funnel. Full
-- onboarding is nudged right after a successful RSVP (app-layer redirect in
-- app/events/[slug]/_components/rsvp-panel.tsx) instead of blocking it first.
--
-- Same body as the version in 20260423000200_event_rsvps_invites.sql, minus
-- the `is_fully_onboarded` precondition (previously lines 354-356 there).
-- Everything else — auth check, can_view_event, capacity/waitlist logic,
-- rate limiting, audit write — is unchanged.

create or replace function public.rsvp_to_event(
  p_event_id uuid,
  p_desired  public.rsvp_status_t,
  p_comment  text default null
)
returns public.rsvp_status_t
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_capacity    int;
  v_waitlist    boolean;
  v_status      public.event_status_t;
  v_current     public.rsvp_status_t;
  v_going_count int;
  v_effective   public.rsvp_status_t;
  v_rate        record;
begin
  if v_uid is null then
    raise exception 'rsvp_to_event: unauthenticated' using errcode = 'P0001';
  end if;
  if not public.can_view_event(p_event_id, v_uid) then
    raise exception 'rsvp_to_event: not visible' using errcode = 'P0001';
  end if;
  if p_desired not in ('going', 'declined', 'cancelled') then
    raise exception 'rsvp_to_event: desired must be going|declined|cancelled'
      using errcode = 'P0001';
  end if;

  select allowed into v_rate
    from public.consume_rate_limit('event_rsvp', v_uid::text, 20, 60);
  if not v_rate.allowed then
    raise exception 'rsvp_to_event: rate limited' using errcode = 'P0001';
  end if;

  select status, capacity, waitlist_enabled
    into v_status, v_capacity, v_waitlist
  from public.events
  where id = p_event_id
  for update;

  if v_status is null then
    raise exception 'rsvp_to_event: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'published' then
    raise exception 'rsvp_to_event: event not published' using errcode = 'P0001';
  end if;

  select status into v_current
    from public.event_rsvps
   where event_id = p_event_id and user_id = v_uid
   for update;

  if p_desired = 'going' then
    if v_capacity is null then
      v_effective := 'going';
    else
      select count(*)::int into v_going_count
        from public.event_rsvps
       where event_id = p_event_id
         and status = 'going'
         and user_id <> v_uid;
      if v_going_count < v_capacity then
        v_effective := 'going';
      elsif v_waitlist then
        v_effective := 'waitlisted';
      else
        raise exception 'rsvp_to_event: event is full' using errcode = 'P0001';
      end if;
    end if;
  else
    v_effective := p_desired;
  end if;

  insert into public.event_rsvps (event_id, user_id, status, comment)
  values (p_event_id, v_uid, v_effective, p_comment)
  on conflict (event_id, user_id) do update
    set status  = excluded.status,
        comment = coalesce(excluded.comment, public.event_rsvps.comment);

  perform public.write_audit(
    'event.rsvp', v_uid, null,
    jsonb_build_object(
      'event_id',         p_event_id,
      'previous',         v_current,
      'effective',        v_effective,
      'capacity',         v_capacity,
      'waitlist_enabled', v_waitlist
    )
  );
  return v_effective;
end;
$$;

revoke all on function public.rsvp_to_event(uuid, public.rsvp_status_t, text) from public;
grant  execute on function public.rsvp_to_event(uuid, public.rsvp_status_t, text)
  to authenticated, service_role;
