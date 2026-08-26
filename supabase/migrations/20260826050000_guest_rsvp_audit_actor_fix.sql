-- Fix write_audit() rejecting guest_rsvp_to_event() calls made by a caller
-- who happens to be authenticated (e.g. a stale session hitting the guest
-- path). write_audit() requires actor = auth.uid() whenever auth.role() =
-- 'authenticated' (20260421070200_rate_limit_and_audit.sql); this function
-- hardcoded a null actor regardless, which always failed that check for an
-- authenticated caller and rolled back the whole RSVP write with it.
-- auth.uid() is null for a genuinely anonymous caller and the real uid for
-- an authenticated one, so passing it through satisfies the check either way.
create or replace function public.guest_rsvp_to_event(
  p_event_id         uuid,
  p_name             text,
  p_email            text,
  p_phone            text,
  p_sms_opt_in       boolean,
  p_sms_consent_copy text
)
returns table (status public.rsvp_status_t, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name         text := trim(p_name);
  v_email        citext := trim(p_email);
  v_phone        text := trim(p_phone);
  v_e164         text;
  v_capacity     int;
  v_waitlist     boolean;
  v_ev_status    public.event_status_t;
  v_visibility   public.event_visibility_t;
  v_slug         text;
  v_member_going int;
  v_guest_going  int;
  v_effective    public.rsvp_status_t;
  v_token        uuid;
  v_claim        uuid;
  v_rate         record;
begin
  if v_name = '' or length(v_name) > 100 then
    raise exception 'guest_rsvp_to_event: name required' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'guest_rsvp_to_event: invalid email' using errcode = 'P0001';
  end if;
  if v_phone !~ '^\+?[0-9\-\(\) ]{7,20}$' then
    raise exception 'guest_rsvp_to_event: invalid phone number' using errcode = 'P0001';
  end if;

  select allowed into v_rate
    from public.consume_rate_limit('guest_event_rsvp', v_email::text, 5, 60);
  if not v_rate.allowed then
    raise exception 'guest_rsvp_to_event: rate limited' using errcode = 'P0001';
  end if;

  v_e164 := public.normalize_phone_e164(v_phone);

  if exists (
    select 1 from public.profiles p
    where not p.is_archived
      and (p.google_email = v_email
           or p.student_email = v_email
           or (v_e164 is not null and p.phone_e164 = v_e164))
  ) then
    raise exception 'guest_rsvp_to_event: account exists' using errcode = 'P0001';
  end if;

  select e.status, e.visibility, e.capacity, e.waitlist_enabled, e.slug
    into v_ev_status, v_visibility, v_capacity, v_waitlist, v_slug
  from public.events e
  where e.id = p_event_id
  for update;

  if v_ev_status is null then
    raise exception 'guest_rsvp_to_event: event not found' using errcode = 'P0002';
  end if;
  if v_ev_status <> 'published' or v_visibility <> 'members' then
    raise exception 'guest_rsvp_to_event: event not open to guest rsvp' using errcode = 'P0001';
  end if;

  if v_capacity is null then
    v_effective := 'going';
  else
    select count(*)::int into v_member_going
      from public.event_rsvps
     where event_id = p_event_id and status = 'going';
    select count(*)::int into v_guest_going
      from public.event_guest_rsvps
     where event_id = p_event_id and status = 'going' and email <> v_email;
    if (v_member_going + v_guest_going) < v_capacity then
      v_effective := 'going';
    elsif v_waitlist then
      v_effective := 'waitlisted';
    else
      raise exception 'guest_rsvp_to_event: event is full' using errcode = 'P0001';
    end if;
  end if;

  v_token := case when v_effective = 'going' then gen_random_uuid() else null end;

  insert into public.event_guest_rsvps
    (event_id, name, email, phone, status, waitlisted_at, status_changed_at, checkin_token)
  values (
    p_event_id, v_name, v_email, v_phone, v_effective,
    case when v_effective = 'waitlisted' then now() else null end,
    now(), v_token
  )
  on conflict (event_id, email) do update
    set name              = excluded.name,
        phone             = excluded.phone,
        status            = excluded.status,
        waitlisted_at     = excluded.waitlisted_at,
        status_changed_at = now(),
        checkin_token     = excluded.checkin_token
  returning event_guest_rsvps.claim_token into v_claim;

  perform public.upsert_guest_identity(
    v_name, v_email, v_phone, v_slug, coalesce(p_sms_opt_in, false), p_sms_consent_copy
  );

  perform public.write_audit(
    'event.guest_rsvp', auth.uid(), null,
    jsonb_build_object(
      'event_id',   p_event_id,
      'email',      v_email,
      'effective',  v_effective,
      'sms_opt_in', coalesce(p_sms_opt_in, false)
    )
  );

  return query select v_effective, v_claim;
end;
$$;

revoke all on function public.guest_rsvp_to_event(uuid, text, text, text, boolean, text) from public;
grant execute on function public.guest_rsvp_to_event(uuid, text, text, text, boolean, text)
  to anon, authenticated, service_role;
