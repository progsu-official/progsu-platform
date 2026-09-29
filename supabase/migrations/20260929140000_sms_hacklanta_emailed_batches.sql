-- Hacklanta II: text in batches as acceptance emails go out.
--
-- Adds audience 'hacklanta_emailed': accepted applicants whose acceptance
-- email has been sent (applications.acceptance_email_sent_at in the Hacklanta
-- II database, copied into hacklanta_sms_recipients.email_sent_at by
-- lib/sms/hacklanta-sync.ts on every /admin/sms load).
--
-- Both Hacklanta audiences now also leave out anyone a Hacklanta broadcast
-- has already queued or sent to, so each send is the next batch and nobody
-- gets the announcement twice. A cancelled or skipped row does not count as
-- texted. 'failed' does: a timeout can hide a text that actually arrived.
-- All of this is re-checked at claim time, like every other audience.

alter table public.hacklanta_sms_recipients
  add column if not exists email_sent_at timestamptz;

alter table public.sms_broadcasts drop constraint if exists sms_broadcasts_audience_check;
alter table public.sms_broadcasts
  add constraint sms_broadcasts_audience_check
  check (audience in ('gsu', 'all_consented', 'hacklanta_accepted', 'hacklanta_emailed', 'self_test', 'event_reminder'));

drop index if exists public.sms_broadcasts_one_sending_idx;
create unique index sms_broadcasts_one_sending_idx
  on public.sms_broadcasts ((true))
  where status = 'sending' and audience in ('gsu', 'all_consented', 'hacklanta_accepted', 'hacklanta_emailed');

-- p_broadcast_id: the broadcast asking (its own rows don't count as "already
-- texted"); null at enqueue time.
create or replace function public.hacklanta_sms_is_sendable(
  p_phone_e164   text,
  p_audience     text,
  p_broadcast_id uuid default null
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
           select 1 from public.hacklanta_sms_recipients h
            where h.phone_e164 = p_phone_e164
              and (p_audience = 'hacklanta_accepted'
                   or (p_audience = 'hacklanta_emailed' and h.email_sent_at is not null))
         )
     and not exists (select 1 from public.sms_suppressions s where s.phone_e164 = p_phone_e164)
     and not exists (
           select 1
             from public.sms_deliveries d
             join public.sms_broadcasts b on b.id = d.broadcast_id
            where d.phone_e164 = p_phone_e164
              and b.audience in ('hacklanta_accepted', 'hacklanta_emailed')
              and b.id is distinct from p_broadcast_id
              and d.status in ('queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed')
         );
$$;

revoke all on function public.hacklanta_sms_is_sendable(text, text, uuid) from public, anon, authenticated;
grant execute on function public.hacklanta_sms_is_sendable(text, text, uuid) to service_role;

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
   where p_audience in ('gsu', 'all_consented')
     and public.sms_is_sendable(c.phone_e164, p_audience)
  union all
  select h.phone_e164
    from public.hacklanta_sms_recipients h
   where p_audience in ('hacklanta_accepted', 'hacklanta_emailed')
     and public.hacklanta_sms_is_sendable(h.phone_e164, p_audience);
$$;

revoke all on function public.sms_audience_numbers(text) from public, anon, authenticated;
grant execute on function public.sms_audience_numbers(text) to service_role;

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

  if p_audience is null or p_audience not in ('gsu', 'all_consented', 'hacklanta_accepted', 'hacklanta_emailed', 'self_test') then
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
     where b.status = 'sending' and b.audience in ('gsu', 'all_consented', 'hacklanta_accepted', 'hacklanta_emailed')
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
    elsif r.audience in ('hacklanta_accepted', 'hacklanta_emailed')
      and not public.hacklanta_sms_is_sendable(r.phone_e164, r.audience, r.broadcast_id) then
      update public.sms_deliveries
         set status = 'skipped',
             error_message = 'no longer in the Hacklanta audience, or already texted by another Hacklanta broadcast',
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
      'all_consented', (select count(*) from public.sms_audience_numbers('all_consented')),
      'hacklanta_accepted', (select count(*) from public.sms_audience_numbers('hacklanta_accepted')),
      'hacklanta_emailed', (select count(*) from public.sms_audience_numbers('hacklanta_emailed'))
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

revoke all on function public.create_sms_broadcast(text, text, int) from public, anon;
grant execute on function public.create_sms_broadcast(text, text, int) to authenticated, service_role;
revoke all on function public.claim_sms_deliveries(int) from public, anon, authenticated;
grant execute on function public.claim_sms_deliveries(int) to service_role;
revoke all on function public.admin_sms_overview() from public, anon;
grant execute on function public.admin_sms_overview() to authenticated, service_role;
