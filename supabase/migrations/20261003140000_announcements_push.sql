-- Announcements feed, read receipts, APNs device tokens and a push outbox.
--
-- Audience:
--   all          everyone, including signed-out app users
--   event_rsvps  members with a going/waitlisted RSVP to event_id
--   hacklanta    members who linked a Hacklanta application
-- Push fan-out happens at publish time into push_outbox; the cron worker
-- (app/api/cron/push-outbox) drains it and no-ops when APNs env is missing.

do $$ begin
  create type public.announcement_audience_t as enum ('all', 'event_rsvps', 'hacklanta');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.announcement_priority_t as enum ('normal', 'important');
exception when duplicate_object then null; end $$;

create table public.announcements (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(title) between 1 and 120),
  body          text not null check (length(body) between 1 and 4000),
  audience      public.announcement_audience_t not null default 'all',
  event_id      uuid references public.events(id) on delete cascade,
  priority      public.announcement_priority_t not null default 'normal',
  deep_link     text check (deep_link is null or (length(deep_link) <= 500 and deep_link ~ '^(progsu://|https://)')),
  published_at  timestamptz,
  expires_at    timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint announcements_event_audience check (
    (audience = 'event_rsvps' and event_id is not null) or audience <> 'event_rsvps'
  ),
  constraint announcements_expiry check (expires_at is null or published_at is null or expires_at > published_at)
);

create index announcements_feed_idx on public.announcements (published_at desc, id desc)
  where published_at is not null;

create or replace function public.announcement_visible_to(p_announcement_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.announcements a
     where a.id = p_announcement_id
       and a.published_at is not null and a.published_at <= now()
       and (a.expires_at is null or a.expires_at > now())
       and (
         a.audience = 'all'
         or (p_user_id is not null and public.is_admin(p_user_id))
         or (a.audience = 'event_rsvps' and p_user_id is not null and exists (
               select 1 from public.event_rsvps r
                where r.event_id = a.event_id and r.user_id = p_user_id
                  and r.status in ('going', 'waitlisted')))
         or (a.audience = 'hacklanta' and p_user_id is not null and exists (
               select 1 from public.hacklanta_links l where l.user_id = p_user_id))
       )
  );
$$;

revoke all on function public.announcement_visible_to(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.announcement_visible_to(uuid, uuid) to anon, authenticated, service_role;

alter table public.announcements enable row level security;

create policy announcements_read on public.announcements for select
  to anon, authenticated
  using (public.announcement_visible_to(id, auth.uid()));

create policy announcements_admin_read on public.announcements for select
  to authenticated
  using (public.is_admin(auth.uid()));

revoke insert, update, delete, truncate on public.announcements from anon, authenticated;

create table public.announcement_reads (
  announcement_id  uuid not null references public.announcements(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  read_at          timestamptz not null default now(),
  constraint announcement_reads_pk primary key (announcement_id, user_id)
);

alter table public.announcement_reads enable row level security;

-- Self-editable by design: a read receipt is the member's own state.
create policy announcement_reads_select_own on public.announcement_reads for select
  to authenticated using (auth.uid() = user_id);
create policy announcement_reads_insert_own on public.announcement_reads for insert
  to authenticated with check (
    auth.uid() = user_id and public.announcement_visible_to(announcement_id, auth.uid())
  );

revoke update, delete, truncate on public.announcement_reads from anon, authenticated;
revoke all on public.announcement_reads from anon;

-- ============================================================================
-- device_tokens
-- ============================================================================
create table public.device_tokens (
  token       text primary key check (token ~ '^[0-9a-fA-F]{32,200}$'),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  env         text not null check (env in ('sandbox', 'production')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;
create policy device_tokens_select_own on public.device_tokens for select
  to authenticated using (auth.uid() = user_id);
revoke insert, update, delete, truncate on public.device_tokens from anon, authenticated;
revoke all on public.device_tokens from anon;

-- A device token identifies a phone, not a person. Registering moves it to
-- the caller (the phone changed hands or accounts), which is the only way a
-- token can change owner.
create or replace function public.register_device_token(p_token text, p_env text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_prev uuid;
begin
  if v_uid is null then
    raise exception 'register_device_token: unauthenticated' using errcode = 'P0001';
  end if;
  if p_env not in ('sandbox', 'production') then
    raise exception 'register_device_token: env must be sandbox|production' using errcode = 'P0001';
  end if;
  if p_token is null or p_token !~ '^[0-9a-fA-F]{32,200}$' then
    raise exception 'register_device_token: bad token' using errcode = 'P0001';
  end if;

  select user_id into v_prev from public.device_tokens where token = lower(p_token) for update;

  insert into public.device_tokens (token, user_id, env)
  values (lower(p_token), v_uid, p_env)
  on conflict (token) do update
    set user_id = v_uid, env = excluded.env, updated_at = now();

  if v_prev is null or v_prev <> v_uid then
    perform public.write_audit('device_token.register', v_uid, v_uid,
      jsonb_build_object('env', p_env, 'reassigned', v_prev is not null));
  end if;
end;
$$;

revoke all on function public.register_device_token(text, text) from public, anon, authenticated;
grant  execute on function public.register_device_token(text, text) to authenticated;

create or replace function public.remove_device_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null then
    raise exception 'remove_device_token: unauthenticated' using errcode = 'P0001';
  end if;
  delete from public.device_tokens where token = lower(p_token) and user_id = v_uid;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.remove_device_token(text) from public, anon, authenticated;
grant  execute on function public.remove_device_token(text) to authenticated;

-- ============================================================================
-- push_outbox
-- ============================================================================
create table public.push_outbox (
  id               uuid primary key default gen_random_uuid(),
  announcement_id  uuid references public.announcements(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts         int not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  claimed_at       timestamptz,
  sent_at          timestamptz,
  constraint push_outbox_once unique (announcement_id, user_id)
);

create index push_outbox_pending_idx on public.push_outbox (created_at) where status = 'pending';

alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated;

-- ============================================================================
-- admin_publish_announcement — create + publish + enqueue push in one step.
-- ============================================================================
create or replace function public.admin_publish_announcement(
  p_title      text,
  p_body       text,
  p_audience   public.announcement_audience_t,
  p_event_id   uuid,
  p_priority   public.announcement_priority_t,
  p_deep_link  text,
  p_expires_at timestamptz,
  p_push       boolean default true
)
returns table (announcement_id uuid, queued int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_queued int := 0;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_publish_announcement: admin only' using errcode = 'P0001';
  end if;
  if p_audience = 'event_rsvps' and p_event_id is null then
    raise exception 'admin_publish_announcement: event required for event_rsvps audience' using errcode = 'P0001';
  end if;

  insert into public.announcements (title, body, audience, event_id, priority, deep_link, published_at, expires_at, created_by)
  values (btrim(p_title), btrim(p_body), p_audience,
          case when p_audience = 'event_rsvps' then p_event_id else null end,
          p_priority, nullif(btrim(p_deep_link), ''), now(), p_expires_at, v_uid)
  returning id into v_id;

  if p_push then
    insert into public.push_outbox (announcement_id, user_id)
    select v_id, d.user_id
      from (select distinct user_id from public.device_tokens) d
     where public.announcement_visible_to(v_id, d.user_id)
    on conflict do nothing;
    get diagnostics v_queued = row_count;
  end if;

  perform public.write_audit('announcement.publish', v_uid, null,
    jsonb_build_object('announcement_id', v_id, 'audience', p_audience, 'event_id', p_event_id, 'queued', v_queued));

  return query select v_id, v_queued;
end;
$$;

revoke all on function public.admin_publish_announcement(text, text, public.announcement_audience_t, uuid, public.announcement_priority_t, text, timestamptz, boolean)
  from public, anon, authenticated;
grant  execute on function public.admin_publish_announcement(text, text, public.announcement_audience_t, uuid, public.announcement_priority_t, text, timestamptz, boolean)
  to authenticated, service_role;

create or replace function public.admin_unpublish_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_unpublish_announcement: admin only' using errcode = 'P0001';
  end if;
  update public.announcements set expires_at = now()
   where id = p_id and (expires_at is null or expires_at > now());
  update public.push_outbox set status = 'skipped', last_error = 'unpublished'
   where announcement_id = p_id and status = 'pending';
  perform public.write_audit('announcement.unpublish', v_uid, null, jsonb_build_object('announcement_id', p_id));
end;
$$;

revoke all on function public.admin_unpublish_announcement(uuid) from public, anon, authenticated;
grant  execute on function public.admin_unpublish_announcement(uuid) to authenticated, service_role;

-- Worker claim/finish (service role only).
create or replace function public.push_outbox_claim(p_limit int default 100)
returns table (id uuid, user_id uuid, announcement_id uuid, title text, body text, deep_link text, priority text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Rows stuck in 'sending' for 10 minutes (crashed worker) go back to pending.
  update public.push_outbox set status = 'pending'
   where status = 'sending' and claimed_at < now() - interval '10 minutes';

  return query
  with c as (
    select o.id from public.push_outbox o
     where o.status = 'pending'
     order by o.created_at
     limit greatest(1, least(p_limit, 500))
     for update skip locked
  )
  update public.push_outbox o
     set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    from c, public.announcements a
   where o.id = c.id and a.id = o.announcement_id
  returning o.id, o.user_id, o.announcement_id, a.title, a.body, a.deep_link, a.priority::text;
end;
$$;

revoke all on function public.push_outbox_claim(int) from public, anon, authenticated;
grant  execute on function public.push_outbox_claim(int) to service_role;

create or replace function public.push_outbox_finish(p_id uuid, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped', 'pending') then
    raise exception 'push_outbox_finish: bad status' using errcode = 'P0001';
  end if;
  update public.push_outbox
     set status = case when p_status = 'failed' and attempts < 3 then 'pending' else p_status end,
         last_error = left(p_error, 500),
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id;
end;
$$;

revoke all on function public.push_outbox_finish(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.push_outbox_finish(uuid, text, text) to service_role;

grant select on public.announcements to anon, authenticated;
grant all    on public.announcements to service_role;
grant select, insert on public.announcement_reads to authenticated;
grant all    on public.announcement_reads to service_role;
grant select on public.device_tokens to authenticated;
grant all    on public.device_tokens, public.push_outbox to service_role;
