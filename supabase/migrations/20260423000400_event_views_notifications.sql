-- Migration 000012 — member-facing views (member_visible_events,
-- self_event_history), admin roster helper (admin_event_roster_for), and the
-- event_notification_jobs queue powering reminder / cancellation fan-out.
-- Does not mutate any pre-existing event table schema.

-- ============================================================================
-- View: member_visible_events (SECURITY INVOKER)
-- Discovery feed: published + (members visibility OR caller has a live invite).
-- RLS on events still applies because the view is invoker-run.
-- ============================================================================
create or replace view public.member_visible_events as
select
  e.id,
  e.slug,
  e.title,
  e.description_md,
  e.status,
  e.visibility,
  e.starts_at,
  e.ends_at,
  e.location_text,
  e.location_url,
  e.capacity,
  e.waitlist_enabled,
  e.cover_image_path,
  e.is_sensitive,
  e.cancelled_at,
  e.cancellation_reason,
  coalesce(
    (select jsonb_agg(
       jsonb_build_object('display_name', h.display_name, 'sort_order', h.sort_order)
       order by h.sort_order, h.display_name
     )
     from public.event_hosts h
     where h.event_id = e.id),
    '[]'::jsonb
  ) as hosts,
  (select count(*) from public.event_rsvps r
    where r.event_id = e.id and r.status = 'going') as going_count,
  (select count(*) from public.event_rsvps r
    where r.event_id = e.id and r.status = 'waitlisted') as waitlisted_count
from public.events e
where e.status = 'published'
  and (
    e.visibility = 'members'
    or (
      e.visibility = 'private_invite'
      and exists (
        select 1 from public.event_invites ei
        where ei.event_id  = e.id
          and ei.user_id   = auth.uid()
          and ei.revoked_at is null
      )
    )
  );

comment on view public.member_visible_events is
  'Member event discovery feed. Excludes draft/cancelled/archived (D6 — cancelled still viewable on direct detail via can_view_event). SECURITY INVOKER so RLS on events applies.';

revoke all on public.member_visible_events from public;
grant  select on public.member_visible_events to authenticated, service_role;

-- ============================================================================
-- View: self_event_history (SECURITY INVOKER)
-- Per-user RSVP + attendance history. Includes cancelled events where the
-- member had an RSVP or check-in (D6).
-- ============================================================================
create or replace view public.self_event_history as
select
  e.id                as event_id,
  e.slug,
  e.title,
  e.starts_at,
  e.ends_at,
  e.status,
  e.visibility,
  e.location_text,
  r.status            as rsvp_status,
  r.status_changed_at as rsvp_changed_at,
  r.waitlisted_at,
  a.checked_in_at,
  a.method            as attendance_method,
  (a.checked_in_at is not null) as attended
from public.events e
left join public.event_rsvps r
  on r.event_id = e.id and r.user_id = auth.uid()
left join public.event_attendances a
  on a.event_id = e.id and a.user_id = auth.uid()
where auth.uid() is not null
  and (r.user_id is not null or a.user_id is not null);

comment on view public.self_event_history is
  'Member self history across RSVP and attendance. Includes cancelled events where the member had an RSVP or check-in (D6).';

revoke all on public.self_event_history from public;
grant  select on public.self_event_history to authenticated, service_role;

-- ============================================================================
-- admin_event_roster_for(event_id) — admin-only roster projection.
-- Exposes sensitive columns (google_email, student_email, checked_in_by) so it
-- is a SECURITY DEFINER function rather than a view, gated explicitly and
-- audited on each call.
-- ============================================================================
create or replace function public.admin_event_roster_for(p_event_id uuid)
returns table (
  user_id            uuid,
  first_name         text,
  last_name          text,
  preferred_name     text,
  google_email       citext,
  student_email      citext,
  rsvp_status        public.rsvp_status_t,
  rsvp_comment       text,
  rsvp_changed_at    timestamptz,
  waitlisted_at      timestamptz,
  waitlist_position  int,
  attended           boolean,
  checked_in_at      timestamptz,
  checked_in_by      uuid,
  attendance_method  public.attendance_method_t,
  invited            boolean,
  invited_by         uuid,
  invited_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_event_roster_for: admin only' using errcode = 'P0001';
  end if;

  perform public.write_audit(
    'event.roster_view', v_uid, null,
    jsonb_build_object('event_id', p_event_id)
  );

  return query
  with waitlist_pos as (
    select r.user_id,
           row_number() over (order by r.waitlisted_at asc, r.user_id asc) as pos
    from public.event_rsvps r
    where r.event_id = p_event_id and r.status = 'waitlisted'
  ),
  roster_users as (
    select ru.user_id from public.event_rsvps       ru where ru.event_id = p_event_id
    union
    select ra.user_id from public.event_attendances ra where ra.event_id = p_event_id
    union
    select ri.user_id from public.event_invites     ri
      where ri.event_id = p_event_id and ri.revoked_at is null
  )
  select
    u.user_id,
    p.first_name,
    p.last_name,
    p.preferred_name,
    p.google_email,
    p.student_email,
    r.status,
    r.comment,
    r.status_changed_at,
    r.waitlisted_at,
    wp.pos::int as waitlist_position,
    (a.event_id is not null) as attended,
    a.checked_in_at,
    a.checked_in_by,
    a.method,
    (ei.event_id is not null) as invited,
    ei.invited_by,
    ei.invited_at
  from roster_users u
  join public.profiles p on p.id = u.user_id
  left join public.event_rsvps       r  on r.event_id  = p_event_id and r.user_id  = u.user_id
  left join public.event_attendances a  on a.event_id  = p_event_id and a.user_id  = u.user_id
  left join public.event_invites     ei on ei.event_id = p_event_id
                                        and ei.user_id  = u.user_id
                                        and ei.revoked_at is null
  left join waitlist_pos             wp on wp.user_id = u.user_id
  order by
    case when r.status = 'going'      then 0
         when r.status = 'waitlisted' then 1
         when r.status = 'declined'   then 2
         when r.status = 'cancelled'  then 3
         else 4
    end,
    wp.pos asc nulls last,
    p.last_name, p.first_name;
end;
$$;

revoke all on function public.admin_event_roster_for(uuid) from public;
grant  execute on function public.admin_event_roster_for(uuid) to authenticated, service_role;

-- ============================================================================
-- Notification jobs
-- ============================================================================

do $$ begin
  create type public.event_notification_kind_t as enum (
    'confirmation',
    'reminder',
    'cancellation'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_notification_status_t as enum (
    'pending',
    'in_flight',
    'sent',
    'failed',
    'skipped'
  );
exception when duplicate_object then null; end $$;

create table public.event_notification_jobs (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  kind             public.event_notification_kind_t not null,
  user_id          uuid references public.profiles(id) on delete cascade,
  scheduled_for    timestamptz not null default now(),
  status           public.event_notification_status_t not null default 'pending',
  attempts         int not null default 0 check (attempts >= 0 and attempts <= 10),
  last_attempt_at  timestamptz,
  sent_at          timestamptz,
  error_text       text check (error_text is null or length(error_text) <= 2000),
  dedupe_key       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint event_notification_jobs_sent_shape check (
    (status in ('sent', 'skipped') and sent_at is not null)
    or (status not in ('sent', 'skipped'))
  )
);

comment on table public.event_notification_jobs is
  'Queue for reminder/cancellation fan-out. Inline confirmation emails also write a row with status = sent for audit.';

-- Dedupe per (event_id, kind, user_id, dedupe_key) when a dedupe_key is supplied.
create unique index event_notification_jobs_dedupe_idx
  on public.event_notification_jobs (event_id, kind, user_id, dedupe_key)
  where dedupe_key is not null;

-- Cron lookup: due pending jobs, oldest first.
create index event_notification_jobs_due_idx
  on public.event_notification_jobs (scheduled_for)
  where status = 'pending';

create index event_notification_jobs_event_idx
  on public.event_notification_jobs (event_id, kind, status);

create trigger event_notification_jobs_set_updated_at
  before update on public.event_notification_jobs
  for each row execute function public.set_updated_at();

alter table public.event_notification_jobs enable row level security;

create policy event_notification_jobs_select_admin
  on public.event_notification_jobs for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- No authenticated writes; server/cron use service_role.
create policy event_notification_jobs_no_client_write
  on public.event_notification_jobs for all
  to authenticated
  using (false) with check (false);

-- ----------------------------------------------------------------------------
-- enqueue_event_notification — admin or service_role enqueue. dedupe_key is
-- optional; when supplied, the partial unique index dedupes inserts.
-- Returns the job id (existing on conflict).
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_event_notification(
  p_event_id      uuid,
  p_kind          public.event_notification_kind_t,
  p_user_id       uuid,
  p_scheduled_for timestamptz,
  p_dedupe_key    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := coalesce(auth.role(), '');
  v_id   uuid;
begin
  if v_role <> 'service_role' and not public.is_admin(v_uid) then
    raise exception 'enqueue_event_notification: admin only' using errcode = 'P0001';
  end if;

  insert into public.event_notification_jobs (
    event_id, kind, user_id, scheduled_for, dedupe_key
  )
  values (
    p_event_id, p_kind, p_user_id, p_scheduled_for, p_dedupe_key
  )
  on conflict (event_id, kind, user_id, dedupe_key) where dedupe_key is not null
    do update set scheduled_for = excluded.scheduled_for
  returning id into v_id;

  if v_id is null then
    -- on conflict with null dedupe_key path doesn't trigger upsert; select
    -- the existing row so the caller still gets the canonical id.
    select j.id into v_id
      from public.event_notification_jobs j
     where j.event_id   = p_event_id
       and j.kind       = p_kind
       and j.user_id is not distinct from p_user_id
       and j.dedupe_key is not distinct from p_dedupe_key
     order by j.created_at desc
     limit 1;
  end if;

  return v_id;
end;
$$;

revoke all on function public.enqueue_event_notification(
  uuid, public.event_notification_kind_t, uuid, timestamptz, text
) from public;
grant  execute on function public.enqueue_event_notification(
  uuid, public.event_notification_kind_t, uuid, timestamptz, text
) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- claim_event_notification_jobs(limit) — service_role cron worker claim.
-- SKIP LOCKED so parallel workers don't contend. Flips pending -> in_flight.
-- ----------------------------------------------------------------------------
create or replace function public.claim_event_notification_jobs(p_limit int)
returns setof public.event_notification_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'claim_event_notification_jobs: service_role only'
      using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit <= 0 then
    raise exception 'claim_event_notification_jobs: limit must be > 0'
      using errcode = 'P0001';
  end if;

  return query
  with pick as (
    select id
      from public.event_notification_jobs
     where status = 'pending'
       and scheduled_for <= now()
     order by scheduled_for asc
     for update skip locked
     limit p_limit
  )
  update public.event_notification_jobs j
     set status           = 'in_flight',
         attempts         = attempts + 1,
         last_attempt_at  = now()
    from pick
   where j.id = pick.id
   returning j.*;
end;
$$;

revoke all on function public.claim_event_notification_jobs(int) from public;
grant  execute on function public.claim_event_notification_jobs(int) to service_role;

-- ----------------------------------------------------------------------------
-- finish_event_notification_job(id, status, error) — service_role finalizer.
-- Sets sent_at = now() for 'sent' and 'skipped'.
-- ----------------------------------------------------------------------------
create or replace function public.finish_event_notification_job(
  p_id     uuid,
  p_status public.event_notification_status_t,
  p_error  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'finish_event_notification_job: service_role only'
      using errcode = 'P0001';
  end if;

  update public.event_notification_jobs
     set status     = p_status,
         sent_at    = case when p_status in ('sent', 'skipped') then now() else sent_at end,
         error_text = p_error
   where id = p_id;
end;
$$;

revoke all on function public.finish_event_notification_job(
  uuid, public.event_notification_status_t, text
) from public;
grant  execute on function public.finish_event_notification_job(
  uuid, public.event_notification_status_t, text
) to service_role;

-- ----------------------------------------------------------------------------
-- mark_event_reminder_sent(event_id) — service_role helper. Flips the per-event
-- reminder_sent_at flag once the fan-out is complete. Writes audit.
-- ----------------------------------------------------------------------------
create or replace function public.mark_event_reminder_sent(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'mark_event_reminder_sent: service_role only'
      using errcode = 'P0001';
  end if;

  update public.events
     set reminder_sent_at = now()
   where id = p_event_id
     and reminder_sent_at is null;

  perform public.write_audit(
    'event.reminder_sent', null, null,
    jsonb_build_object('event_id', p_event_id)
  );
end;
$$;

revoke all on function public.mark_event_reminder_sent(uuid) from public;
grant  execute on function public.mark_event_reminder_sent(uuid) to service_role;
