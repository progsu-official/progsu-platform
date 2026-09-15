-- SMS event reminders (docs/19-sms-broadcasts.md §8).
--
-- Thirty minutes before a published event starts, everyone RSVP'd as going
-- who can be texted gets one reminder. On by default per event
-- (events.send_sms_reminder), sent once (events.sms_reminder_sent_at), and
-- delivered through the same sms_broadcasts / sms_deliveries queue as officer
-- broadcasts, with audience 'event_reminder'.
--
-- WHO: the union of going member RSVPs (profile phone) and going guest RSVPs
-- (the phone they gave), filtered through sms_is_sendable(phone,
-- 'all_consented'). RSVPing is not consent to be texted; the SMS opt-in is.
-- Waitlisted, declined and cancelled RSVPs get nothing.
--
-- The recipient check runs again when the worker claims each row, so someone
-- who cancels their RSVP, replies STOP, or whose event is cancelled after the
-- reminder was queued is skipped, and nothing goes out once the event has
-- started.
--
-- The message itself is built in lib/sms/templates.ts and passed in; this
-- migration owns who, when, and exactly-once.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists send_sms_reminder    boolean not null default true,
  add column if not exists sms_reminder_sent_at timestamptz;

comment on column public.events.send_sms_reminder is
  'Text going RSVPs who opted in to SMS 30 minutes before start. Default on; toggled with set_event_sms_reminder().';
comment on column public.events.sms_reminder_sent_at is
  'When the SMS reminder was queued. Cleared if starts_at moves, so a rescheduled event reminds again.';

alter table public.sms_broadcasts
  add column if not exists event_id uuid references public.events(id) on delete set null;

alter table public.sms_broadcasts drop constraint if exists sms_broadcasts_audience_check;
alter table public.sms_broadcasts
  add constraint sms_broadcasts_audience_check
  check (audience in ('gsu', 'all_consented', 'self_test', 'event_reminder'));

-- No "reminders must have an event" check: event_id is ON DELETE SET NULL so
-- deleting an event never fails on its reminder history, and the claim below
-- already skips a reminder row whose event is gone.

-- A reminder must never be blocked by an officer's blast in flight, or block
-- one. The one-at-a-time rule is for officer broadcasts only.
drop index if exists public.sms_broadcasts_one_sending_idx;
create unique index sms_broadcasts_one_sending_idx
  on public.sms_broadcasts ((true))
  where status = 'sending' and audience in ('gsu', 'all_consented');

create index if not exists sms_broadcasts_event_idx
  on public.sms_broadcasts (event_id)
  where event_id is not null;

create index if not exists events_sms_reminder_due_idx
  on public.events (starts_at)
  where status = 'published'
    and send_sms_reminder = true
    and sms_reminder_sent_at is null;

-- ---------------------------------------------------------------------------
-- A rescheduled event reminds again at its new time
-- ---------------------------------------------------------------------------
create or replace function public.events_reset_sms_reminder()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.starts_at is distinct from old.starts_at and new.starts_at > now() then
    new.sms_reminder_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists events_reset_sms_reminder on public.events;
create trigger events_reset_sms_reminder
  before update of starts_at on public.events
  for each row execute function public.events_reset_sms_reminder();

revoke all on function public.events_reset_sms_reminder() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- sms_is_event_reminder_recipient(event, phone)
-- ---------------------------------------------------------------------------
create or replace function public.sms_is_event_reminder_recipient(
  p_event_id   uuid,
  p_phone_e164 text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select (
      exists (
        select 1
          from public.event_rsvps r
          join public.profiles p on p.id = r.user_id
         where r.event_id = p_event_id
           and r.status = 'going'
           and not p.is_archived
           and p.phone_e164 = p_phone_e164
      )
      or exists (
        select 1
          from public.event_guest_rsvps g
         where g.event_id = p_event_id
           and g.status = 'going'
           and public.normalize_phone_e164(g.phone) = p_phone_e164
      )
    )
    and public.sms_is_sendable(p_phone_e164, 'all_consented');
$$;

create or replace function public.sms_event_reminder_numbers(p_event_id uuid)
returns setof text
language sql
stable
set search_path = public
as $$
  select c.phone_e164
    from (
      select p.phone_e164
        from public.event_rsvps r
        join public.profiles p on p.id = r.user_id
       where r.event_id = p_event_id and r.status = 'going' and p.phone_e164 is not null
      union
      select public.normalize_phone_e164(g.phone)
        from public.event_guest_rsvps g
       where g.event_id = p_event_id and g.status = 'going'
    ) c
   where c.phone_e164 is not null
     and public.sms_is_event_reminder_recipient(p_event_id, c.phone_e164);
$$;

-- ---------------------------------------------------------------------------
-- due_event_sms_reminders(now) — service_role. Events whose reminder is due.
-- ---------------------------------------------------------------------------
-- Due from 30 minutes before start until 5 minutes before: a cron that misses
-- a few ticks still sends, but "starting soon" never lands as the doors open.
-- p_now exists so the smoke can ask about an event hours away without racing
-- the live cron; the cron always uses the default.
create or replace function public.due_event_sms_reminders(p_now timestamptz default now())
returns table (
  event_id      uuid,
  title         text,
  slug          text,
  starts_at     timestamptz,
  location_text text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'due_event_sms_reminders: service_role only' using errcode = 'P0001';
  end if;

  return query
  select e.id, e.title, e.slug, e.starts_at, e.location_text
    from public.events e
   where e.status = 'published'
     and e.cancelled_at is null
     and e.archived_at is null
     and e.import_source is null
     and e.send_sms_reminder
     and e.sms_reminder_sent_at is null
     and e.starts_at >  p_now + interval '5 minutes'
     and e.starts_at <= p_now + interval '30 minutes'
   order by e.starts_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- enqueue_event_sms_reminder(event, body, now) — service_role. Exactly once.
-- ---------------------------------------------------------------------------
-- Stamps sms_reminder_sent_at under a row lock in the same transaction as the
-- enqueue, so two cron runs racing for the same event produce one reminder.
-- An event with nobody textable is stamped and gets no broadcast row.
create or replace function public.enqueue_event_sms_reminder(
  p_event_id uuid,
  p_body     text,
  p_now      timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_body  text := trim(coalesce(p_body, ''));
  v_id    uuid;
  v_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'enqueue_event_sms_reminder: service_role only' using errcode = 'P0001';
  end if;

  if char_length(v_body) = 0 or char_length(v_body) > 480 then
    raise exception 'enqueue_event_sms_reminder: body must be 1-480 characters' using errcode = 'P0001';
  end if;
  if v_body !~* '\mstop\M' then
    raise exception 'enqueue_event_sms_reminder: body must include STOP opt-out wording' using errcode = 'P0001';
  end if;

  select * into v_event from public.events e where e.id = p_event_id for update;
  if v_event.id is null then
    raise exception 'enqueue_event_sms_reminder: event not found' using errcode = 'P0002';
  end if;

  if v_event.status <> 'published'
     or v_event.cancelled_at is not null
     or v_event.archived_at is not null
     or not v_event.send_sms_reminder
     or v_event.sms_reminder_sent_at is not null
     or v_event.starts_at <= p_now + interval '5 minutes'
     or v_event.starts_at >  p_now + interval '30 minutes' then
    return jsonb_build_object('event_id', p_event_id, 'enqueued', false, 'recipient_count', 0);
  end if;

  update public.events set sms_reminder_sent_at = now() where id = p_event_id;

  if not exists (select 1 from public.sms_event_reminder_numbers(p_event_id)) then
    perform public.write_audit(
      'sms.event_reminder_enqueued', null, null,
      jsonb_build_object('event_id', p_event_id, 'recipient_count', 0)
    );
    return jsonb_build_object('event_id', p_event_id, 'enqueued', true, 'recipient_count', 0);
  end if;

  insert into public.sms_broadcasts (body, audience, event_id)
  values (v_body, 'event_reminder', p_event_id)
  returning id into v_id;

  insert into public.sms_deliveries (broadcast_id, phone_e164)
  select v_id, n from public.sms_event_reminder_numbers(p_event_id) n;
  get diagnostics v_count = row_count;

  update public.sms_broadcasts set recipient_count = v_count where id = v_id;

  perform public.write_audit(
    'sms.event_reminder_enqueued', null, null,
    jsonb_build_object(
      'event_id', p_event_id,
      'broadcast_id', v_id,
      'recipient_count', v_count,
      'body', v_body
    )
  );

  return jsonb_build_object(
    'event_id', p_event_id,
    'enqueued', true,
    'broadcast_id', v_id,
    'recipient_count', v_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- set_event_sms_reminder(event, enabled) — admin only
-- ---------------------------------------------------------------------------
create or replace function public.set_event_sms_reminder(
  p_event_id uuid,
  p_enabled  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old boolean;
begin
  if not public.is_admin(v_uid) then
    raise exception 'set_event_sms_reminder: admin only' using errcode = 'P0001';
  end if;
  if p_enabled is null then
    raise exception 'set_event_sms_reminder: enabled is required' using errcode = 'P0001';
  end if;

  select e.send_sms_reminder into v_old from public.events e where e.id = p_event_id for update;
  if v_old is null then
    raise exception 'set_event_sms_reminder: event not found' using errcode = 'P0002';
  end if;
  if v_old = p_enabled then
    return;
  end if;

  update public.events
     set send_sms_reminder = p_enabled, updated_by = v_uid
   where id = p_event_id;

  perform public.write_audit(
    'event.sms_reminder_toggled', v_uid, null,
    jsonb_build_object('event_id', p_event_id, 'enabled', p_enabled)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_sms_broadcast — the in-flight check now ignores reminders
-- ---------------------------------------------------------------------------
-- Unchanged from 20260915120000 except the pre-check's audience filter,
-- which must match the new sms_broadcasts_one_sending_idx predicate.
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

  if exists (
    select 1 from public.sms_broadcasts b
     where b.status = 'sending' and b.audience in ('gsu', 'all_consented')
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
-- claim_sms_deliveries — adds the event-reminder re-check
-- ---------------------------------------------------------------------------
-- Unchanged from 20260915120000 except the per-row check for
-- 'event_reminder': still RSVP'd going and textable, event still on, and the
-- event not yet started. Without this branch every reminder row would fail
-- sms_is_sendable(phone, 'event_reminder') and be skipped.
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
    returning d.id, d.phone_e164, d.broadcast_id, b.body, b.audience, b.event_id
  loop
    if exists (select 1 from public.sms_suppressions s where s.phone_e164 = r.phone_e164) then
      update public.sms_deliveries
         set status = 'suppressed', status_updated_at = now()
       where id = r.id;
    elsif r.audience = 'event_reminder' and not exists (
      select 1 from public.events e
       where e.id = r.event_id
         and e.status = 'published'
         and e.cancelled_at is null
         and e.starts_at > now()
    ) then
      update public.sms_deliveries
         set status = 'skipped',
             error_message = 'event cancelled or already started',
             status_updated_at = now()
       where id = r.id;
    elsif r.audience = 'event_reminder'
      and not public.sms_is_event_reminder_recipient(r.event_id, r.phone_e164) then
      update public.sms_deliveries
         set status = 'skipped',
             error_message = 'no longer RSVPd or no longer sendable at send time',
             status_updated_at = now()
       where id = r.id;
    elsif r.audience in ('gsu', 'all_consented')
      and not public.sms_is_sendable(r.phone_e164, r.audience) then
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

  perform public.complete_sms_broadcast_if_drained(b.id)
     from public.sms_broadcasts b
    where b.status = 'sending';
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_sms_overview — adds event titles and upcoming reminders
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
    'upcoming_reminders', coalesce((
      select jsonb_agg(row_to_json(u) order by u.starts_at)
        from (
          select e.id,
                 e.title,
                 e.slug,
                 e.location_text,
                 e.starts_at,
                 e.send_sms_reminder,
                 e.sms_reminder_sent_at,
                 (select count(*) from public.sms_event_reminder_numbers(e.id)) as recipient_count
            from public.events e
           where e.status = 'published'
             and e.cancelled_at is null
             and e.import_source is null
             and e.starts_at > now()
             and e.starts_at < now() + interval '7 days'
           order by e.starts_at
           limit 10
        ) u
    ), '[]'::jsonb),
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
                 sb.event_id,
                 ev.title as event_title,
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
            left join public.events ev on ev.id = sb.event_id
           order by sb.created_at desc, sb.id desc
           limit 20
        ) b
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.sms_is_event_reminder_recipient(uuid, text)         from public, anon, authenticated;
revoke all on function public.sms_event_reminder_numbers(uuid)                    from public, anon, authenticated;
revoke all on function public.due_event_sms_reminders(timestamptz)                from public, anon, authenticated;
revoke all on function public.enqueue_event_sms_reminder(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sms_is_event_reminder_recipient(uuid, text)         to service_role;
grant execute on function public.sms_event_reminder_numbers(uuid)                    to service_role;
grant execute on function public.due_event_sms_reminders(timestamptz)                to service_role;
grant execute on function public.enqueue_event_sms_reminder(uuid, text, timestamptz) to service_role;

revoke all on function public.set_event_sms_reminder(uuid, boolean) from public, anon;
grant execute on function public.set_event_sms_reminder(uuid, boolean) to authenticated, service_role;

-- create or replace keeps existing ACLs, but restate them so this file stands
-- on its own.
revoke all on function public.admin_sms_overview()                  from public, anon;
revoke all on function public.create_sms_broadcast(text, text, int) from public, anon;
revoke all on function public.claim_sms_deliveries(int)             from public, anon, authenticated;
grant execute on function public.admin_sms_overview()                  to authenticated, service_role;
grant execute on function public.create_sms_broadcast(text, text, int) to authenticated, service_role;
grant execute on function public.claim_sms_deliveries(int)             to service_role;
