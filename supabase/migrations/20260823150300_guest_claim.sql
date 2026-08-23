-- Guest → member conversion: claim token, collision detection, welcome-page
-- helpers (docs/16-guest-conversion §3, §4.2, §5).
--
-- Three changes to the guest RSVP path:
--   1. It now refuses to create a guest identity for someone who already has a
--      member account (matched on google_email, student_email, or normalized
--      phone) and tells the caller to send them to sign-in instead.
--   2. It captures SMS opt-in with the exact disclosure copy shown, so we have
--      evidence that survives carrier review.
--   3. It returns an opaque claim_token so the caller can redirect to
--      /welcome/[token] instead of showing a dismissible nudge card.

-- ============================================================================
-- Column: event_guest_rsvps.claim_token
-- Deliberately NOT reusing checkin_token, whose lifecycle rule is "present iff
-- status = 'going'" (20260821040000). Waitlisted guests need the welcome page
-- too — arguably more than anyone, since "members get priority" is a live
-- incentive for someone who just missed a spot.
-- ============================================================================
alter table public.event_guest_rsvps
  add column if not exists claim_token uuid not null default gen_random_uuid();

create unique index if not exists event_guest_rsvps_claim_token_idx
  on public.event_guest_rsvps (claim_token);

comment on column public.event_guest_rsvps.claim_token is
  'Opaque per-guest token for /welcome/[token]. Always present, unlike checkin_token. Bearer credential: possession proves this guest submitted this RSVP.';

-- ============================================================================
-- majors: allow anonymous reads of the active list.
-- The /welcome major dropdown runs with no session. A list of college majors
-- carries no member data; the existing authenticated-only policy was simply
-- written before any anon surface needed it.
-- ============================================================================
drop policy if exists majors_select_active_anon on public.majors;
create policy majors_select_active_anon
  on public.majors for select
  to anon
  using (is_active = true);

grant select on public.majors to anon;

-- ============================================================================
-- upsert_guest_identity — shared by the RSVP write and the answers write.
-- Fills legacy_members without ever clobbering richer data that is already
-- there: a Luma import row with a real full name beats a guest form's typing,
-- and an SMS consent already on file is never downgraded to NULL.
-- ============================================================================
create or replace function public.upsert_guest_identity(
  p_name             text,
  p_email            citext,
  p_phone            text,
  p_source_detail    text,
  p_sms_opt_in       boolean default false,
  p_sms_consent_copy text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := split_part(trim(p_name), ' ', 1);
  v_last  text := case
                    when position(' ' in trim(p_name)) > 0
                      then substr(trim(p_name), position(' ' in trim(p_name)) + 1)
                    else null
                  end;
  v_e164  text := public.normalize_phone_e164(p_phone);
  v_id    uuid;
begin
  insert into public.legacy_members
    (full_name, first_name, last_name, personal_email, phone_number, phone_e164,
     source, source_detail, sms_consent_at, sms_consent_copy)
  values
    (trim(p_name), v_first, v_last, p_email, p_phone, v_e164,
     'guest_rsvp', p_source_detail,
     case when p_sms_opt_in then now() else null end,
     case when p_sms_opt_in then p_sms_consent_copy else null end)
  on conflict (personal_email) where personal_email is not null
  do update set
    full_name        = coalesce(public.legacy_members.full_name, excluded.full_name),
    first_name       = coalesce(public.legacy_members.first_name, excluded.first_name),
    last_name        = coalesce(public.legacy_members.last_name, excluded.last_name),
    phone_number     = coalesce(public.legacy_members.phone_number, excluded.phone_number),
    phone_e164       = coalesce(public.legacy_members.phone_e164, excluded.phone_e164),
    -- Consent only ever moves forward. A later RSVP with the box unticked is
    -- not a withdrawal — withdrawal is STOP, which lands in sms_suppressions.
    sms_consent_at   = coalesce(public.legacy_members.sms_consent_at, excluded.sms_consent_at),
    sms_consent_copy = coalesce(public.legacy_members.sms_consent_copy, excluded.sms_consent_copy)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_guest_identity(text, citext, text, text, boolean, text) from public;
grant execute on function public.upsert_guest_identity(text, citext, text, text, boolean, text) to service_role;

-- ============================================================================
-- guest_rsvp_to_event — return type changes, so this is a drop + recreate
-- rather than a create-or-replace. Grants restated below.
-- ============================================================================
drop function if exists public.guest_rsvp_to_event(uuid, text, text, text);

create function public.guest_rsvp_to_event(
  p_event_id         uuid,
  p_name             text,
  p_email            text,
  p_phone            text,
  p_sms_opt_in       boolean default false,
  p_sms_consent_copy text default null
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

  -- Rate limit BEFORE the collision check, not after: the collision result is
  -- an "is this address a member?" oracle, and the limiter is what bounds how
  -- fast it can be probed. See docs/16-guest-conversion §11.4.
  select allowed into v_rate
    from public.consume_rate_limit('guest_event_rsvp', v_email::text, 5, 60);
  if not v_rate.allowed then
    raise exception 'guest_rsvp_to_event: rate limited' using errcode = 'P0001';
  end if;

  v_e164 := public.normalize_phone_e164(v_phone);

  -- Collision: this person already has an account. Create nothing; the caller
  -- routes them to sign-in. Costs us the RSVP if they bail, which is the
  -- deliberate trade in docs/16-guest-conversion §2.
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
    'event.guest_rsvp', null, null,
    jsonb_build_object(
      'event_id',    p_event_id,
      'email',       v_email,
      'effective',   v_effective,
      'sms_opt_in',  coalesce(p_sms_opt_in, false)
    )
  );

  return query select v_effective, v_claim;
end;
$$;

revoke all on function public.guest_rsvp_to_event(uuid, text, text, text, boolean, text) from public;
grant execute on function public.guest_rsvp_to_event(uuid, text, text, text, boolean, text)
  to anon, authenticated, service_role;

-- ============================================================================
-- guest_claim_context — anon read for /welcome/[token]. Returns only what the
-- holder of the token already knows (their own first name, the event they just
-- registered for) plus whether they have answered. Nothing about any other
-- guest, and nothing about the roster, is reachable from here.
-- ============================================================================
create or replace function public.guest_claim_context(p_token uuid)
returns table (
  first_name    text,
  email         citext,
  event_title   text,
  event_slug    text,
  starts_at     timestamptz,
  rsvp_status   public.rsvp_status_t,
  answered      boolean,
  sms_opted_in  boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    split_part(g.name, ' ', 1)                as first_name,
    g.email,
    e.title                                   as event_title,
    e.slug                                    as event_slug,
    e.starts_at,
    g.status                                  as rsvp_status,
    (lm.answered_at is not null)              as answered,
    (lm.sms_consent_at is not null)           as sms_opted_in
  from public.event_guest_rsvps g
  join public.events e on e.id = g.event_id
  left join public.legacy_members lm on lm.personal_email = g.email
  where g.claim_token = p_token;
$$;

revoke all on function public.guest_claim_context(uuid) from public;
grant execute on function public.guest_claim_context(uuid) to anon, authenticated, service_role;

-- ============================================================================
-- submit_guest_answers — the /welcome write. Token-authenticated, anon-callable.
-- ============================================================================
create or replace function public.submit_guest_answers(
  p_token            uuid,
  p_major            text default null,
  p_major_other_text text default null,
  p_grad_year        integer default null,
  p_class_standing   public.class_standing_t default null,
  p_interested_roles public.interested_role_t[] default '{}',
  p_sms_opt_in       boolean default null,
  p_sms_consent_copy text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email citext;
  v_name  text;
  v_phone text;
  v_slug  text;
  v_rate  record;
begin
  select g.email, g.name, g.phone, e.slug
    into v_email, v_name, v_phone, v_slug
  from public.event_guest_rsvps g
  join public.events e on e.id = g.event_id
  where g.claim_token = p_token;

  if v_email is null then
    raise exception 'submit_guest_answers: unknown token' using errcode = 'P0002';
  end if;

  select allowed into v_rate
    from public.consume_rate_limit('guest_answers', p_token::text, 20, 60);
  if not v_rate.allowed then
    raise exception 'submit_guest_answers: rate limited' using errcode = 'P0001';
  end if;

  if p_grad_year is not null and (p_grad_year < 1950 or p_grad_year > 2100) then
    raise exception 'submit_guest_answers: implausible graduation year' using errcode = 'P0001';
  end if;
  if p_major is not null
     and not exists (select 1 from public.majors m where m.slug = p_major and m.is_active) then
    raise exception 'submit_guest_answers: unknown major' using errcode = 'P0001';
  end if;
  if p_major = 'other' and coalesce(trim(p_major_other_text), '') = '' then
    raise exception 'submit_guest_answers: major detail required' using errcode = 'P0001';
  end if;

  -- Guarantees the row exists even if the RSVP predates this migration.
  perform public.upsert_guest_identity(
    v_name, v_email, v_phone, v_slug,
    coalesce(p_sms_opt_in, false), p_sms_consent_copy
  );

  -- Answers overwrite: unlike the identity fields above, these are the most
  -- recent self-report and there is no richer prior source to protect.
  update public.legacy_members lm
  set major            = coalesce(p_major, lm.major),
      major_other_text = coalesce(p_major_other_text, lm.major_other_text),
      grad_year        = coalesce(p_grad_year, lm.grad_year),
      class_standing   = coalesce(p_class_standing, lm.class_standing),
      interested_roles = case
                           when coalesce(array_length(p_interested_roles, 1), 0) > 0
                             then p_interested_roles
                           else lm.interested_roles
                         end,
      answered_at      = now()
  where lm.personal_email = v_email;

  perform public.write_audit(
    'event.guest_answers', null, null,
    jsonb_build_object('email', v_email, 'event_slug', v_slug)
  );
end;
$$;

revoke all on function public.submit_guest_answers(uuid, text, text, integer, public.class_standing_t, public.interested_role_t[], boolean, text) from public;
grant execute on function public.submit_guest_answers(uuid, text, text, integer, public.class_standing_t, public.interested_role_t[], boolean, text)
  to anon, authenticated, service_role;
