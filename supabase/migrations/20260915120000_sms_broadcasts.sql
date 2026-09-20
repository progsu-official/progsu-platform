-- SMS broadcasts (docs/16-guest-conversion §7.4, Phase 3).
--
-- An officer writes one message, picks an audience, and the platform texts
-- everyone in it through the Twilio Messaging Service. This migration owns
-- the part that has to be right regardless of what the app does: who is
-- allowed to receive a text.
--
-- WHO IS SENDABLE, AND WHY THE RULE LIVES HERE:
--
-- A number is sendable when, and only when,
--
--   1. it is not in sms_suppressions (that table supersedes everything), and
--   2. the most recent consent decision on record for that number is an
--      acceptance.
--
-- Decisions come from two places. The member ledger (consents,
-- sms_marketing, latest row per user) and the guest/import staging record
-- (legacy_members.sms_consent_at, which carries the verbatim disclosure in
-- sms_consent_copy). When both exist for one number, the newer one wins, and a
-- tie goes to the decline. That matters in practice: at the time of writing
-- 48 numbers had a guest opt-in AND a later member-side decline, and a union of
-- the two sources would have texted every one of them.
--
-- What does NOT count as consent: legacy_members.sms_interest without
-- sms_consent_at (a bare "Yes" in an old form export, with no timestamp or copy
-- to show a carrier), and event_guest_rsvps.phone on its own. See
-- scripts/repair-sms-legacy-data.ts, which made the same call.
--
-- sms_is_sendable() is the single definition. The audience count shown to an
-- officer, the enqueue, and the worker's claim all call it, so a number that
-- texts STOP or withdraws consent between "Send" and the worker reaching its
-- row is skipped at claim time rather than texted.
--
-- Access model: RLS on with zero policies on both tables, so PostgREST refuses
-- every direct client read and write. Officer entry points are SECURITY
-- DEFINER, re-check is_admin, and keep their `authenticated` grant so
-- auth.uid() names the officer in the audit row. Worker entry points are
-- service_role only, with the explicit anon/authenticated revoke CLAUDE.md
-- hard rule #10 requires.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.sms_broadcasts (
  id               uuid primary key default gen_random_uuid(),
  body             text not null,
  audience         text not null
    check (audience in ('gsu', 'all_consented', 'self_test')),
  status           text not null default 'sending'
    check (status in ('sending', 'done', 'cancelled')),
  recipient_count  int  not null default 0,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  completed_at     timestamptz,
  constraint sms_broadcasts_body_len check (char_length(body) between 1 and 480)
);

comment on table public.sms_broadcasts is
  'One officer-authored SMS and the audience it went to. Recipients are snapshotted into sms_deliveries at creation and re-checked by claim_sms_deliveries() at send time.';

create index if not exists sms_broadcasts_created_idx
  on public.sms_broadcasts (created_at desc, id desc);

-- At most one real broadcast in flight. The exists() check in
-- create_sms_broadcast() gives the readable error; this is what actually holds
-- when two officers (or one double-submitted form) hit Send in the same
-- instant and both pass that check before either commits.
create unique index if not exists sms_broadcasts_one_sending_idx
  on public.sms_broadcasts ((true))
  where status = 'sending' and audience <> 'self_test';

create table if not exists public.sms_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  broadcast_id       uuid not null references public.sms_broadcasts(id) on delete cascade,
  phone_e164         text not null check (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  status             text not null default 'queued'
    check (status in (
      'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed',
      'suppressed', 'skipped', 'cancelled'
    )),
  attempts           int  not null default 0,
  twilio_sid         text unique,
  error_code         text,
  error_message      text,
  created_at         timestamptz not null default now(),
  claimed_at         timestamptz,
  sent_at            timestamptz,
  status_updated_at  timestamptz,
  unique (broadcast_id, phone_e164)
);

comment on table public.sms_deliveries is
  'Per-recipient send record. queued -> sending (claimed) -> sent -> delivered/undelivered/failed. suppressed/skipped are set at claim time when the number stopped being sendable after enqueue. A row is never re-queued once claimed: a lost worker must not become a duplicate text.';

create index if not exists sms_deliveries_queued_idx
  on public.sms_deliveries (created_at, id)
  where status = 'queued';

create index if not exists sms_deliveries_broadcast_status_idx
  on public.sms_deliveries (broadcast_id, status);

alter table public.sms_broadcasts enable row level security;
alter table public.sms_deliveries enable row level security;

revoke all on public.sms_broadcasts from anon, authenticated;
revoke all on public.sms_deliveries from anon, authenticated;

-- ---------------------------------------------------------------------------
-- sms_is_sendable(phone, audience) — the rule described in the header
-- ---------------------------------------------------------------------------
-- 'gsu' additionally needs some record for the number to place it at Georgia
-- State: a member whose student email is on a GSU domain, or a staging row
-- whose campus (else personal) email is. The two domains are the GSU rows of
-- school_domains ('gsu' and 'gsu-staff').
--
-- Archived profiles contribute their declines but never an acceptance: an
-- archived account is not someone we should be texting on the strength of it.
--
-- A guest record that has been claimed stops speaking for itself. Once
-- someone is a member, their profile is where they manage SMS, so the guest
-- opt-in only counts for the number still on that profile, and only while the
-- profile is live; the profile's own ledger rows (matched by the same number)
-- then compete with it on recency. A member who moved to a new number, was
-- archived, or deleted their account (claimed_at set, claimed_profile_id
-- nulled by the FK) leaves an old guest opt-in that no longer counts — the
-- number may not even be theirs any more.
create or replace function public.sms_is_sendable(
  p_phone_e164 text,
  p_audience   text
)
returns boolean
language sql
stable
set search_path = public
as $$
  with decisions as (
    select l.accepted,
           l.accepted_at as decided_at,
           p.student_email_domain::text in ('student.gsu.edu', 'gsu.edu') as is_gsu
      from public.profiles p
      cross join lateral (
        select c.accepted, c.accepted_at
          from public.consents c
         where c.user_id = p.id
           and c.consent_type = 'sms_marketing'::public.consent_type_t
         order by c.accepted_at desc, c.id desc
         limit 1
      ) l
     where p.phone_e164 = p_phone_e164
       and (not p.is_archived or not l.accepted)
    union all
    select true,
           lm.sms_consent_at,
           lower(split_part(coalesce(lm.campus_email, lm.personal_email)::text, '@', 2))
             in ('student.gsu.edu', 'gsu.edu')
      from public.legacy_members lm
      left join public.profiles cp on cp.id = lm.claimed_profile_id
     where lm.phone_e164 = p_phone_e164
       and lm.sms_consent_at is not null
       and (
         (lm.claimed_at is null and lm.claimed_profile_id is null)
         or (cp.phone_e164 = p_phone_e164 and not cp.is_archived)
       )
  ),
  latest as (
    select d.accepted
      from decisions d
     order by d.decided_at desc, d.accepted asc
     limit 1
  )
  select p_phone_e164 is not null
     and p_audience in ('gsu', 'all_consented')
     and not exists (
       select 1 from public.sms_suppressions s where s.phone_e164 = p_phone_e164
     )
     and coalesce((select accepted from latest), false)
     and (p_audience = 'all_consented'
          or exists (select 1 from decisions d where d.is_gsu));
$$;

comment on function public.sms_is_sendable(text, text) is
  'True when the number is unsuppressed and its latest consent decision (member ledger or guest staging record, newest wins, tie declines) is an acceptance. The only definition of an SMS recipient; see migration 20260915120000.';

-- ---------------------------------------------------------------------------
-- sms_audience_numbers(audience) — every sendable number for an audience
-- ---------------------------------------------------------------------------
create or replace function public.sms_audience_numbers(p_audience text)
returns setof text
language sql
stable
set search_path = public
as $$
  select c.phone_e164
    from (
      select p.phone_e164 from public.profiles p where p.phone_e164 is not null
      union
      select lm.phone_e164 from public.legacy_members lm
       where lm.phone_e164 is not null and lm.sms_consent_at is not null
    ) c
   where public.sms_is_sendable(c.phone_e164, p_audience);
$$;

revoke all on function public.sms_is_sendable(text, text) from public, anon, authenticated;
revoke all on function public.sms_audience_numbers(text)  from public, anon, authenticated;
grant execute on function public.sms_is_sendable(text, text) to service_role;
grant execute on function public.sms_audience_numbers(text)  to service_role;

-- ---------------------------------------------------------------------------
-- admin_sms_overview() — audience sizes, the officer's own test number, and
-- recent broadcasts with per-status counts
-- ---------------------------------------------------------------------------
create or replace function public.admin_sms_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_phone text;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_sms_overview: admin only' using errcode = 'P0001';
  end if;

  select p.phone_e164 into v_phone from public.profiles p where p.id = v_uid;

  return jsonb_build_object(
    'audiences', jsonb_build_object(
      'gsu',           (select count(*) from public.sms_audience_numbers('gsu')),
      'all_consented', (select count(*) from public.sms_audience_numbers('all_consented'))
    ),
    'suppressed', (select count(*) from public.sms_suppressions),
    'self', jsonb_build_object(
      'has_phone',     v_phone is not null,
      'phone_last4',   right(v_phone, 4),
      'is_suppressed', exists (
        select 1 from public.sms_suppressions s where s.phone_e164 = v_phone
      )
    ),
    'broadcasts', coalesce((
      select jsonb_agg(row_to_json(b) order by b.created_at desc, b.id desc)
        from (
          select sb.id,
                 sb.body,
                 sb.audience,
                 sb.status,
                 sb.recipient_count,
                 sb.created_at,
                 sb.completed_at,
                 sb.cancelled_at,
                 trim(concat_ws(' ', cp.first_name, cp.last_name)) as created_by_name,
                 (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                    from (select d.status, count(*) as n
                            from public.sms_deliveries d
                           where d.broadcast_id = sb.id
                           group by d.status) x) as counts,
                 (select coalesce(jsonb_object_agg(x.error_code, x.n), '{}'::jsonb)
                    from (select d.error_code, count(*) as n
                            from public.sms_deliveries d
                           where d.broadcast_id = sb.id and d.error_code is not null
                           group by d.error_code) x) as error_codes
            from public.sms_broadcasts sb
            left join public.profiles cp on cp.id = sb.created_by
           order by sb.created_at desc, sb.id desc
           limit 20
        ) b
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_sms_broadcast(body, audience, expected_count) — admin only
-- ---------------------------------------------------------------------------
-- p_expected_count is the number the officer was shown and confirmed. If the
-- audience has moved since (someone opted out, someone signed up), refuse
-- rather than send to a count nobody agreed to; the page reloads and asks
-- again. 'self_test' texts the calling officer's own profile number and
-- ignores p_expected_count — it is still refused if that number is
-- suppressed, because nothing sends around that table.
create or replace function public.create_sms_broadcast(
  p_body           text,
  p_audience       text,
  p_expected_count int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_body  text := trim(coalesce(p_body, ''));
  v_phone text;
  v_id    uuid;
  v_count int;
begin
  if not public.is_admin(v_uid) then
    raise exception 'create_sms_broadcast: admin only' using errcode = 'P0001';
  end if;

  if p_audience is null or p_audience not in ('gsu', 'all_consented', 'self_test') then
    raise exception 'create_sms_broadcast: unknown audience' using errcode = 'P0001';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'create_sms_broadcast: message is empty' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 480 then
    raise exception 'create_sms_broadcast: message must be 480 characters or fewer'
      using errcode = 'P0001';
  end if;
  -- The toll-free verification this number sends under promises opt-out
  -- instructions in every message.
  if v_body !~* '\mstop\M' then
    raise exception 'create_sms_broadcast: message must tell people to reply STOP to opt out'
      using errcode = 'P0001';
  end if;

  if p_audience = 'self_test' then
    select p.phone_e164 into v_phone from public.profiles p where p.id = v_uid;
    if v_phone is null then
      raise exception 'create_sms_broadcast: add a phone number to your profile to send a test'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.sms_suppressions s where s.phone_e164 = v_phone) then
      raise exception 'create_sms_broadcast: your number is on the do-not-text list'
        using errcode = 'P0001';
    end if;
    -- A test skips the consent rule (it is the officer's own number), and an
    -- officer controls what that number is. The cap and the number in the
    -- audit row are what keep that from being an unmetered side channel.
    if (
      select count(*) from public.sms_broadcasts b
       where b.created_by = v_uid
         and b.audience = 'self_test'
         and b.created_at > now() - interval '1 hour'
    ) >= 10 then
      raise exception 'create_sms_broadcast: that is 10 test texts this hour, try again later'
        using errcode = 'P0001';
    end if;

    insert into public.sms_broadcasts (body, audience, recipient_count, created_by)
    values (v_body, 'self_test', 1, v_uid)
    returning id into v_id;

    insert into public.sms_deliveries (broadcast_id, phone_e164)
    values (v_id, v_phone);

    perform public.write_audit(
      'sms.test_sent', v_uid, v_uid,
      jsonb_build_object('broadcast_id', v_id, 'phone_e164', v_phone, 'body', v_body)
    );

    return jsonb_build_object('broadcast_id', v_id, 'recipient_count', 1);
  end if;

  -- One real broadcast at a time. Stops a double-submitted form from texting
  -- the whole list twice.
  if exists (
    select 1 from public.sms_broadcasts b
     where b.status = 'sending' and b.audience <> 'self_test'
  ) then
    raise exception 'create_sms_broadcast: another broadcast is still sending'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.sms_broadcasts (body, audience, created_by)
    values (v_body, p_audience, v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'create_sms_broadcast: another broadcast is still sending'
      using errcode = 'P0001';
  end;

  -- Counted from the rows actually written, not a separate count(*), so the
  -- confirmed number and the snapshot can never disagree. Raising here rolls
  -- both inserts back.
  insert into public.sms_deliveries (broadcast_id, phone_e164)
  select v_id, n from public.sms_audience_numbers(p_audience) n;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'create_sms_broadcast: nobody in that audience can be texted'
      using errcode = 'P0001';
  end if;
  if p_expected_count is null or p_expected_count <> v_count then
    raise exception 'create_sms_broadcast: the audience changed to % people, confirm again', v_count
      using errcode = 'P0001';
  end if;

  update public.sms_broadcasts set recipient_count = v_count where id = v_id;

  perform public.write_audit(
    'sms.broadcast_created', v_uid, null,
    jsonb_build_object(
      'broadcast_id', v_id,
      'audience', p_audience,
      'recipient_count', v_count,
      'body', v_body
    )
  );

  return jsonb_build_object('broadcast_id', v_id, 'recipient_count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_sms_broadcast(id) — admin only. Rows already claimed may still go
-- out; everything still queued does not.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_sms_broadcast(p_broadcast_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_status    text;
  v_cancelled int;
begin
  if not public.is_admin(v_uid) then
    raise exception 'cancel_sms_broadcast: admin only' using errcode = 'P0001';
  end if;

  select b.status into v_status
    from public.sms_broadcasts b
   where b.id = p_broadcast_id
   for update;
  if v_status is null then
    raise exception 'cancel_sms_broadcast: broadcast not found' using errcode = 'P0002';
  end if;
  if v_status <> 'sending' then
    raise exception 'cancel_sms_broadcast: broadcast is already finished' using errcode = 'P0001';
  end if;

  update public.sms_deliveries
     set status = 'cancelled', status_updated_at = now()
   where broadcast_id = p_broadcast_id and status = 'queued';
  get diagnostics v_cancelled = row_count;

  update public.sms_broadcasts
     set status = 'cancelled', cancelled_at = now()
   where id = p_broadcast_id;

  perform public.write_audit(
    'sms.broadcast_cancelled', v_uid, null,
    jsonb_build_object('broadcast_id', p_broadcast_id, 'unsent', v_cancelled)
  );

  return jsonb_build_object('broadcast_id', p_broadcast_id, 'unsent', v_cancelled);
end;
$$;

revoke all on function public.admin_sms_overview()                    from public, anon;
revoke all on function public.create_sms_broadcast(text, text, int)   from public, anon;
revoke all on function public.cancel_sms_broadcast(uuid)              from public, anon;
grant execute on function public.admin_sms_overview()                  to authenticated, service_role;
grant execute on function public.create_sms_broadcast(text, text, int) to authenticated, service_role;
grant execute on function public.cancel_sms_broadcast(uuid)            to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- complete_sms_broadcast_if_drained(id) — internal
-- ---------------------------------------------------------------------------
create or replace function public.complete_sms_broadcast_if_drained(p_broadcast_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb;
begin
  if exists (
    select 1 from public.sms_deliveries d
     where d.broadcast_id = p_broadcast_id and d.status in ('queued', 'sending')
  ) then
    return;
  end if;

  update public.sms_broadcasts
     set status = 'done', completed_at = now()
   where id = p_broadcast_id and status = 'sending';
  if not found then
    return;
  end if;

  select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) into v_counts
    from (select d.status, count(*) as n from public.sms_deliveries d
           where d.broadcast_id = p_broadcast_id group by d.status) x;

  perform public.write_audit(
    'sms.broadcast_completed', null, null,
    jsonb_build_object('broadcast_id', p_broadcast_id, 'counts', v_counts)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_sms_deliveries(limit) — service_role worker claim
-- ---------------------------------------------------------------------------
-- Flips queued -> sending under SKIP LOCKED, then re-applies the recipient
-- rule to each claimed row. Only rows that still pass come back to the
-- worker; the rest are closed out here, in the same transaction, so there is
-- no window where the app holds a number the database has since refused.
--
-- Rows stuck in 'sending' for 30 minutes with no Twilio SID belong to a worker
-- that was killed mid-batch without releasing them. Whether that text went
-- out is unknown, so they are failed rather than retried: a missing text is
-- recoverable, a duplicate is not.
create or replace function public.claim_sms_deliveries(p_limit int)
returns table (delivery_id uuid, to_phone text, message_body text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'claim_sms_deliveries: service_role only' using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit <= 0 or p_limit > 500 then
    raise exception 'claim_sms_deliveries: limit must be between 1 and 500' using errcode = 'P0001';
  end if;

  update public.sms_deliveries d
     set status = 'failed',
         error_message = 'worker did not report back; not retried to avoid a duplicate text',
         status_updated_at = now()
   where d.status = 'sending'
     and d.twilio_sid is null
     and d.claimed_at < now() - interval '30 minutes';

  for r in
    with pick as (
      select d.id
        from public.sms_deliveries d
        join public.sms_broadcasts b on b.id = d.broadcast_id
       where d.status = 'queued'
         and b.status = 'sending'
       order by d.created_at, d.id
       for update of d skip locked
       limit p_limit
    )
    update public.sms_deliveries d
       set status = 'sending', attempts = d.attempts + 1, claimed_at = now()
      from pick, public.sms_broadcasts b
     where d.id = pick.id and b.id = d.broadcast_id
    returning d.id, d.phone_e164, d.broadcast_id, b.body, b.audience
  loop
    if exists (select 1 from public.sms_suppressions s where s.phone_e164 = r.phone_e164) then
      update public.sms_deliveries
         set status = 'suppressed', status_updated_at = now()
       where id = r.id;
    elsif r.audience <> 'self_test' and not public.sms_is_sendable(r.phone_e164, r.audience) then
      update public.sms_deliveries
         set status = 'skipped',
             error_message = 'no longer sendable at send time',
             status_updated_at = now()
       where id = r.id;
    else
      delivery_id  := r.id;
      to_phone     := r.phone_e164;
      message_body := r.body;
      return next;
    end if;
  end loop;

  -- Broadcasts whose last rows were just closed out above never reach
  -- finish_sms_delivery(), so settle them here.
  perform public.complete_sms_broadcast_if_drained(b.id)
     from public.sms_broadcasts b
    where b.status = 'sending';
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_sms_delivery(...) — service_role worker finalizer
-- ---------------------------------------------------------------------------
-- Twilio 21610 means the recipient has already replied STOP to this sender.
-- Carrier-side opt-out is authoritative, so it lands in sms_suppressions and
-- every later broadcast skips the number before it reaches Twilio at all.
create or replace function public.finish_sms_delivery(
  p_delivery_id   uuid,
  p_ok            boolean,
  p_twilio_sid    text default null,
  p_error_code    text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone     text;
  v_broadcast uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'finish_sms_delivery: service_role only' using errcode = 'P0001';
  end if;

  select d.phone_e164, d.broadcast_id into v_phone, v_broadcast
    from public.sms_deliveries d
   where d.id = p_delivery_id and d.status = 'sending'
   for update;
  if v_phone is null then
    return;
  end if;

  if p_ok then
    update public.sms_deliveries
       set status = 'sent', twilio_sid = p_twilio_sid, sent_at = now(),
           status_updated_at = now(), error_code = null, error_message = null
     where id = p_delivery_id;
  elsif p_error_code = '21610' then
    perform public.suppress_sms_number(v_phone, 'carrier', 'twilio 21610 on broadcast send');
    update public.sms_deliveries
       set status = 'suppressed', error_code = p_error_code,
           error_message = left(p_error_message, 500), status_updated_at = now()
     where id = p_delivery_id;
  else
    update public.sms_deliveries
       set status = 'failed', error_code = p_error_code,
           error_message = left(p_error_message, 500), status_updated_at = now()
     where id = p_delivery_id;
  end if;

  perform public.complete_sms_broadcast_if_drained(v_broadcast);
end;
$$;

-- ---------------------------------------------------------------------------
-- release_sms_deliveries(ids) — service_role. Hands claimed rows back to the
-- queue. Only for rows the worker never passed to Twilio (it runs out of time
-- budget mid-batch), which is the one case where re-queueing cannot produce a
-- duplicate. A row with a Twilio SID is never released.
-- ---------------------------------------------------------------------------
create or replace function public.release_sms_deliveries(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'release_sms_deliveries: service_role only' using errcode = 'P0001';
  end if;

  -- A broadcast cancelled while these were claimed gets them as cancelled,
  -- not queued: nothing claims rows under a cancelled broadcast, so 'queued'
  -- would sit there forever.
  update public.sms_deliveries d
     set status = case when b.status = 'sending' then 'queued' else 'cancelled' end,
         claimed_at = null,
         status_updated_at = now()
    from public.sms_broadcasts b
   where b.id = d.broadcast_id
     and d.id = any(p_ids)
     and d.status = 'sending'
     and d.twilio_sid is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_sms_status(sid, status, error_code) — service_role, Twilio status
-- callback. Callbacks arrive out of order, so a row only moves forward.
-- ---------------------------------------------------------------------------
create or replace function public.record_sms_status(
  p_twilio_sid text,
  p_status     text,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone  text;
  v_status text;
  v_next   text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'record_sms_status: service_role only' using errcode = 'P0001';
  end if;

  select d.phone_e164, d.status into v_phone, v_status
    from public.sms_deliveries d
   where d.twilio_sid = p_twilio_sid
   for update;
  if v_phone is null then
    return;
  end if;

  v_next := case p_status
    when 'delivered'   then 'delivered'
    when 'undelivered' then 'undelivered'
    when 'failed'      then 'failed'
    else null
  end;
  if v_next is null or v_status not in ('sending', 'sent') then
    return;
  end if;

  if p_error_code = '21610' then
    perform public.suppress_sms_number(v_phone, 'carrier', 'twilio 21610 on status callback');
  end if;

  update public.sms_deliveries
     set status = v_next,
         error_code = coalesce(p_error_code, error_code),
         status_updated_at = now()
   where twilio_sid = p_twilio_sid;
end;
$$;

revoke all on function public.complete_sms_broadcast_if_drained(uuid)        from public, anon, authenticated;
revoke all on function public.claim_sms_deliveries(int)                      from public, anon, authenticated;
revoke all on function public.finish_sms_delivery(uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.record_sms_status(text, text, text)            from public, anon, authenticated;
revoke all on function public.release_sms_deliveries(uuid[])                  from public, anon, authenticated;
grant execute on function public.release_sms_deliveries(uuid[])                 to service_role;
grant execute on function public.complete_sms_broadcast_if_drained(uuid)        to service_role;
grant execute on function public.claim_sms_deliveries(int)                      to service_role;
grant execute on function public.finish_sms_delivery(uuid, boolean, text, text, text) to service_role;
grant execute on function public.record_sms_status(text, text, text)            to service_role;
