-- Migration 000009 — events core: enums, events/event_hosts tables, event-covers storage
-- bucket, admin-only lifecycle helpers (create/update/publish/cancel/archive/delete_draft),
-- parity helper is_fully_onboarded(), and a STUB can_view_event() that later migrations
-- replace via create-or-replace. Mirrors decisions in docs/09-events-platform-plan.md and
-- the Release 1 migration spec.
--
-- Pre-existing helpers relied upon: public.is_admin, public.write_audit, public.set_updated_at.
-- Pre-existing extensions relied upon: pgcrypto (gen_random_uuid, crypt, gen_salt).

-- ============================================================================
-- Enums
-- ============================================================================

do $$ begin
  create type public.event_status_t as enum (
    'draft',
    'published',
    'cancelled',
    'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_visibility_t as enum (
    'members',
    'private_invite'
  );
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Table: events
-- Core event record. Admin-only mutations go through the SECURITY DEFINER
-- lifecycle helpers below. status + visibility are separate concerns (D3).
-- ============================================================================
create table public.events (
  id                         uuid primary key default gen_random_uuid(),
  slug                       text not null
                             check (slug ~ '^[a-z0-9](?:[a-z0-9\-]{0,62}[a-z0-9])?$'),
  title                      text not null
                             check (length(title) between 1 and 200),
  description_md             text check (
    description_md is null or length(description_md) <= 20000
  ),
  status                     public.event_status_t     not null default 'draft',
  visibility                 public.event_visibility_t not null default 'members',
  starts_at                  timestamptz not null,
  ends_at                    timestamptz not null,
  location_text              text check (
    location_text is null or length(location_text) <= 500
  ),
  location_url               text check (
    location_url is null or location_url ~* '^https?://'
  ),
  capacity                   int  check (capacity is null or capacity >= 0),
  waitlist_enabled           boolean not null default false,
  cover_image_path           text check (
    cover_image_path is null or length(cover_image_path) <= 500
  ),
  check_in_code_hash         text, -- bcrypt hash via pgcrypto.crypt() (D5)
  check_in_code_expires_at   timestamptz,
  send_rsvp_email            boolean not null default true,
  send_reminder_email        boolean not null default true,
  reminder_sent_at           timestamptz,
  cancellation_reason        text check (
    cancellation_reason is null or length(cancellation_reason) <= 2000
  ),
  cancelled_at               timestamptz,
  is_sensitive               boolean not null default false,
  published_at               timestamptz,
  archived_at                timestamptz,
  created_by                 uuid references public.profiles(id) on delete set null,
  updated_by                 uuid references public.profiles(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint events_slug_unique unique (slug),
  constraint events_time_order check (starts_at < ends_at),
  constraint events_check_in_code_pair check (
    (check_in_code_hash is null and check_in_code_expires_at is null)
    or (check_in_code_hash is not null and check_in_code_expires_at is not null)
  ),
  constraint events_cancellation_pair check (
    (status <> 'cancelled' and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);

comment on table public.events is
  'Core event record. Admin-only mutations via SECURITY DEFINER helpers. status + visibility are separate (D3).';
comment on column public.events.check_in_code_hash is
  'bcrypt hash of a raw check-in code (pgcrypto.crypt). Compared server-side only (D5).';
comment on column public.events.is_sensitive is
  'Reserved for R3 shared-event discovery gating. Must be set to exclude an event from named shared-history surfaces.';

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Indexes (events)
-- ----------------------------------------------------------------------------

-- Unique index on slug is created by the UNIQUE constraint; no duplicate needed.

-- Member discovery feed: upcoming published events ordered by starts_at.
create index events_discovery_idx
  on public.events (starts_at)
  where status = 'published';

-- Admin list by status/starts_at.
create index events_status_starts_at_idx
  on public.events (status, starts_at desc);

-- Reminder-cron worker: find due published events with reminders enabled
-- that haven't been sent yet.
create index events_reminder_due_idx
  on public.events (starts_at)
  where status = 'published'
    and send_reminder_email = true
    and reminder_sent_at is null;

-- Sensitivity filter for R3 downstream queries (cheap, pays off later).
create index events_not_sensitive_idx
  on public.events (id)
  where is_sensitive = false;

-- ============================================================================
-- Table: event_hosts
-- Displayed hosts for an event. display_name is authoritative; profile_id is
-- decorative and does NOT confer admin authority on the event (§5.3).
-- ============================================================================
create table public.event_hosts (
  event_id      uuid not null references public.events(id) on delete cascade,
  sort_order    int  not null default 0,
  display_name  text not null check (length(display_name) between 1 and 200),
  profile_id    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint event_hosts_pk primary key (event_id, sort_order)
);

comment on table public.event_hosts is
  'Displayed hosts for an event. display_name is authoritative; profile_id is decorative and does NOT confer admin authority on the event (§5.3).';

create index event_hosts_profile_idx
  on public.event_hosts (profile_id)
  where profile_id is not null;

-- ============================================================================
-- Helpers (declare BEFORE RLS policies so policies can reference can_view_event)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- is_fully_onboarded(uuid) — mirror of lib/auth/onboarding.ts#loadOnboardingState.
-- Required profile fields: first_name, last_name, school, major, class_standing,
-- grad_year, grad_term. interested_roles non-empty. Current resume is_current=true
-- AND status='active'. Required consents (privacy_policy, terms_of_service,
-- age_confirmation) latest-per-type must be accepted at current consent_versions.
-- student_email_verified intentionally excluded. NO admin bypass — admins that
-- skip onboarding are handled at the caller level (server actions explicitly
-- branch on public.is_admin). This keeps parity with onboarding.ts literal.
-- ----------------------------------------------------------------------------
create or replace function public.is_fully_onboarded(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with
    p as (
      select
        first_name, last_name, school, major, class_standing,
        grad_year, grad_term, interested_roles
      from public.profiles
      where id = p_user_id
    ),
    profile_complete as (
      select
        coalesce(
          nullif(btrim(first_name), '') is not null
          and nullif(btrim(last_name), '') is not null
          and nullif(btrim(school), '')   is not null
          and nullif(btrim(major), '')    is not null
          and class_standing is not null
          and grad_year is not null
          and nullif(btrim(grad_term), '') is not null
          and coalesce(cardinality(interested_roles), 0) > 0,
          false
        ) as ok
      from p
    ),
    resume_ok as (
      select exists (
        select 1
        from public.resumes r
        where r.user_id = p_user_id
          and r.is_current = true
          and r.status = 'active'
      ) as ok
    ),
    required as (
      select unnest(array[
        'privacy_policy'::public.consent_type_t,
        'terms_of_service'::public.consent_type_t,
        'age_confirmation'::public.consent_type_t
      ]) as consent_type
    ),
    latest as (
      select distinct on (c.consent_type)
        c.consent_type,
        c.accepted,
        c.version
      from public.consents c
      join required r on r.consent_type = c.consent_type
      where c.user_id = p_user_id
      order by c.consent_type, c.accepted_at desc, c.id desc
    ),
    consents_ok as (
      select
        (select count(*) from required) =
        (select count(*)
           from latest l
           join public.consent_versions cv
             on cv.consent_type = l.consent_type
          where l.accepted = true
            and l.version  = cv.version
        ) as ok
    )
  select
    coalesce((select ok from profile_complete), false)
    and coalesce((select ok from resume_ok), false)
    and coalesce((select ok from consents_ok), false);
$$;

revoke all on function public.is_fully_onboarded(uuid) from public;
grant  execute on function public.is_fully_onboarded(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- can_view_event(event_id, user_id) — STUB version for migration 1.
-- Only knows about events + admin. Handles draft/archived (admin-only),
-- cancelled (admin-only until migration 3 refines), members (true), and
-- private_invite (false until migration 2 adds the invites branch).
-- Migrations 2 and 3 replace this with richer versions via create-or-replace.
-- ----------------------------------------------------------------------------
create or replace function public.can_view_event(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select id, status, visibility
    from public.events
    where id = p_event_id
  )
  select
    case
      when public.is_admin(p_user_id) then true
      when (select id from e) is null then false
      when (select status from e) in ('draft', 'archived') then false
      when (select status from e) = 'cancelled' then false           -- refined in migration 3
      when (select visibility from e) = 'members' then true
      when (select visibility from e) = 'private_invite' then false  -- refined in migration 2
      else false
    end;
$$;

revoke all on function public.can_view_event(uuid, uuid) from public;
grant  execute on function public.can_view_event(uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- RLS policies
-- ============================================================================

alter table public.events      enable row level security;
alter table public.event_hosts enable row level security;

-- -------- events --------

-- Admin: full SELECT.
create policy events_select_admin
  on public.events for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- Member: SELECT only rows that can_view_event() approves. Keeps direct reads
-- safe even before the member_visible_events view applies its filters.
create policy events_select_member
  on public.events for select
  to authenticated
  using (public.can_view_event(id, auth.uid()));

-- Admin: full write. Expected flow is through SECURITY DEFINER helpers; this
-- policy allows admin-as-authenticated writes to stay consistent with other
-- admin-only tables (no non-admin permissive policy exists for writes).
create policy events_admin_all
  on public.events for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- -------- event_hosts --------

create policy event_hosts_select_admin
  on public.event_hosts for select
  to authenticated
  using (public.is_admin(auth.uid()));

create policy event_hosts_select_member
  on public.event_hosts for select
  to authenticated
  using (public.can_view_event(event_id, auth.uid()));

create policy event_hosts_admin_all
  on public.event_hosts for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ============================================================================
-- Storage: 'event-covers' bucket + policies (private, <=5 MB, image mimes)
-- Path convention: {event_id}/{uuid}.{ext}
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-covers',
  'event-covers',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists event_covers_insert_admin on storage.objects;
create policy event_covers_insert_admin
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'event-covers'
    and public.is_admin(auth.uid())
  );

drop policy if exists event_covers_update_admin on storage.objects;
create policy event_covers_update_admin
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'event-covers'
    and public.is_admin(auth.uid())
  )
  with check (
    bucket_id = 'event-covers'
    and public.is_admin(auth.uid())
  );

drop policy if exists event_covers_delete_admin on storage.objects;
create policy event_covers_delete_admin
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'event-covers'
    and public.is_admin(auth.uid())
  );

drop policy if exists event_covers_select_admin on storage.objects;
create policy event_covers_select_admin
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'event-covers'
    and public.is_admin(auth.uid())
  );

-- Members can read a cover only if they can view the event. The first path
-- segment is the event id; we cast it to uuid and defer to can_view_event().
drop policy if exists event_covers_select_member on storage.objects;
create policy event_covers_select_member
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'event-covers'
    and public.can_view_event(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

-- ============================================================================
-- Lifecycle helpers (admin-only). All SECURITY DEFINER; all write_audit().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_event(payload) — admin creates a draft event plus hosts.
-- Payload keys: slug, title, description_md, visibility, starts_at, ends_at,
-- location_text, location_url, capacity, waitlist_enabled, cover_image_path,
-- send_rsvp_email, send_reminder_email, is_sensitive, hosts (jsonb array of
-- {display_name, profile_id, sort_order}).
-- ----------------------------------------------------------------------------
create or replace function public.create_event(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_slug text;
  v_host jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'create_event: admin only' using errcode = 'P0001';
  end if;

  v_slug := lower(coalesce(p_payload ->> 'slug', ''));

  insert into public.events (
    slug, title, description_md, visibility,
    starts_at, ends_at, location_text, location_url,
    capacity, waitlist_enabled, cover_image_path,
    send_rsvp_email, send_reminder_email, is_sensitive,
    created_by, updated_by
  )
  values (
    v_slug,
    p_payload ->> 'title',
    p_payload ->> 'description_md',
    coalesce((p_payload ->> 'visibility')::public.event_visibility_t, 'members'),
    (p_payload ->> 'starts_at')::timestamptz,
    (p_payload ->> 'ends_at')::timestamptz,
    p_payload ->> 'location_text',
    p_payload ->> 'location_url',
    nullif(p_payload ->> 'capacity', '')::int,
    coalesce((p_payload ->> 'waitlist_enabled')::boolean, false),
    p_payload ->> 'cover_image_path',
    coalesce((p_payload ->> 'send_rsvp_email')::boolean, true),
    coalesce((p_payload ->> 'send_reminder_email')::boolean, true),
    coalesce((p_payload ->> 'is_sensitive')::boolean, false),
    v_uid, v_uid
  )
  returning id into v_id;

  if jsonb_typeof(p_payload -> 'hosts') = 'array' then
    for v_host in select * from jsonb_array_elements(p_payload -> 'hosts') loop
      insert into public.event_hosts (event_id, sort_order, display_name, profile_id)
      values (
        v_id,
        coalesce((v_host ->> 'sort_order')::int, 0),
        v_host ->> 'display_name',
        nullif(v_host ->> 'profile_id', '')::uuid
      );
    end loop;
  end if;

  perform public.write_audit(
    'event.create', v_uid, null,
    jsonb_build_object('event_id', v_id, 'slug', v_slug)
  );
  return v_id;
end;
$$;

revoke all on function public.create_event(jsonb) from public;
grant  execute on function public.create_event(jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- update_event(event_id, patch) — admin patch. coalesce merge; only keys in
-- the patch are overwritten. Disallows touching id/created_by/created_at/status.
-- Replaces event_hosts if 'hosts' is present in the patch.
-- ----------------------------------------------------------------------------
create or replace function public.update_event(p_event_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.event_status_t;
  v_keys   text[];
  v_host   jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'update_event: admin only' using errcode = 'P0001';
  end if;

  select status into v_status
    from public.events
   where id = p_event_id
   for update;
  if v_status is null then
    raise exception 'update_event: event not found' using errcode = 'P0002';
  end if;

  if p_patch ? 'status' then
    raise exception 'update_event: status changes go through lifecycle helpers'
      using errcode = 'P0001';
  end if;
  if p_patch ? 'id' or p_patch ? 'created_by' or p_patch ? 'created_at' then
    raise exception 'update_event: cannot modify id/created_by/created_at'
      using errcode = 'P0001';
  end if;

  update public.events
     set title               = coalesce(p_patch ->> 'title',          title),
         description_md      = case when p_patch ? 'description_md'
                                    then p_patch ->> 'description_md'
                                    else description_md end,
         visibility          = coalesce(
                                 (p_patch ->> 'visibility')::public.event_visibility_t,
                                 visibility
                               ),
         starts_at           = coalesce((p_patch ->> 'starts_at')::timestamptz, starts_at),
         ends_at             = coalesce((p_patch ->> 'ends_at')::timestamptz,   ends_at),
         location_text       = case when p_patch ? 'location_text'
                                    then p_patch ->> 'location_text'
                                    else location_text end,
         location_url        = case when p_patch ? 'location_url'
                                    then p_patch ->> 'location_url'
                                    else location_url end,
         capacity            = case when p_patch ? 'capacity'
                                    then nullif(p_patch ->> 'capacity', '')::int
                                    else capacity end,
         waitlist_enabled    = coalesce((p_patch ->> 'waitlist_enabled')::boolean, waitlist_enabled),
         cover_image_path    = case when p_patch ? 'cover_image_path'
                                    then p_patch ->> 'cover_image_path'
                                    else cover_image_path end,
         send_rsvp_email     = coalesce((p_patch ->> 'send_rsvp_email')::boolean,     send_rsvp_email),
         send_reminder_email = coalesce((p_patch ->> 'send_reminder_email')::boolean, send_reminder_email),
         is_sensitive        = coalesce((p_patch ->> 'is_sensitive')::boolean,        is_sensitive),
         slug                = coalesce(lower(p_patch ->> 'slug'), slug),
         updated_by          = v_uid
   where id = p_event_id;

  if jsonb_typeof(p_patch -> 'hosts') = 'array' then
    delete from public.event_hosts where event_id = p_event_id;
    for v_host in select * from jsonb_array_elements(p_patch -> 'hosts') loop
      insert into public.event_hosts (event_id, sort_order, display_name, profile_id)
      values (
        p_event_id,
        coalesce((v_host ->> 'sort_order')::int, 0),
        v_host ->> 'display_name',
        nullif(v_host ->> 'profile_id', '')::uuid
      );
    end loop;
  end if;

  v_keys := array(select jsonb_object_keys(p_patch));
  perform public.write_audit(
    'event.update', v_uid, null,
    jsonb_build_object('event_id', p_event_id, 'keys', v_keys)
  );
end;
$$;

revoke all on function public.update_event(uuid, jsonb) from public;
grant  execute on function public.update_event(uuid, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- publish_event(event_id) — draft -> published.
-- ----------------------------------------------------------------------------
create or replace function public.publish_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_slug   text;
  v_status public.event_status_t;
begin
  if not public.is_admin(v_uid) then
    raise exception 'publish_event: admin only' using errcode = 'P0001';
  end if;

  select status, slug into v_status, v_slug
    from public.events
   where id = p_event_id
   for update;
  if v_status is null then
    raise exception 'publish_event: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'publish_event: expected draft, got %', v_status using errcode = 'P0001';
  end if;

  update public.events
     set status       = 'published',
         published_at = now(),
         updated_by   = v_uid
   where id = p_event_id;

  perform public.write_audit(
    'event.publish', v_uid, null,
    jsonb_build_object('event_id', p_event_id, 'slug', v_slug)
  );
end;
$$;

revoke all on function public.publish_event(uuid) from public;
grant  execute on function public.publish_event(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- cancel_event(event_id, reason) — draft|published -> cancelled. Does NOT
-- touch RSVPs/attendances (kept for history).
-- ----------------------------------------------------------------------------
create or replace function public.cancel_event(p_event_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.event_status_t;
begin
  if not public.is_admin(v_uid) then
    raise exception 'cancel_event: admin only' using errcode = 'P0001';
  end if;

  select status into v_status
    from public.events
   where id = p_event_id
   for update;
  if v_status is null then
    raise exception 'cancel_event: event not found' using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'published') then
    raise exception 'cancel_event: expected draft|published, got %', v_status using errcode = 'P0001';
  end if;

  update public.events
     set status              = 'cancelled',
         cancelled_at        = now(),
         cancellation_reason = p_reason,
         updated_by          = v_uid
   where id = p_event_id;

  perform public.write_audit(
    'event.cancel', v_uid, null,
    jsonb_build_object('event_id', p_event_id, 'reason', p_reason)
  );
end;
$$;

revoke all on function public.cancel_event(uuid, text) from public;
grant  execute on function public.cancel_event(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- archive_event(event_id) — published|cancelled -> archived.
-- ----------------------------------------------------------------------------
create or replace function public.archive_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.event_status_t;
begin
  if not public.is_admin(v_uid) then
    raise exception 'archive_event: admin only' using errcode = 'P0001';
  end if;

  select status into v_status
    from public.events
   where id = p_event_id
   for update;
  if v_status is null then
    raise exception 'archive_event: event not found' using errcode = 'P0002';
  end if;
  if v_status not in ('published', 'cancelled') then
    raise exception 'archive_event: expected published|cancelled, got %', v_status using errcode = 'P0001';
  end if;

  update public.events
     set status       = 'archived',
         archived_at  = now(),
         updated_by   = v_uid
   where id = p_event_id;

  perform public.write_audit(
    'event.archive', v_uid, null,
    jsonb_build_object('event_id', p_event_id)
  );
end;
$$;

revoke all on function public.archive_event(uuid) from public;
grant  execute on function public.archive_event(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- delete_draft_event(event_id) — hard delete of a draft event.
-- Cascade drops hosts/invites/rsvps/attendances via their FKs.
-- ----------------------------------------------------------------------------
create or replace function public.delete_draft_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.event_status_t;
  v_slug   text;
begin
  if not public.is_admin(v_uid) then
    raise exception 'delete_draft_event: admin only' using errcode = 'P0001';
  end if;

  select status, slug into v_status, v_slug
    from public.events
   where id = p_event_id
   for update;
  if v_status is null then
    raise exception 'delete_draft_event: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'delete_draft_event: expected draft, got %', v_status using errcode = 'P0001';
  end if;

  delete from public.events where id = p_event_id;

  perform public.write_audit(
    'event.delete_draft', v_uid, null,
    jsonb_build_object('event_id', p_event_id, 'slug', v_slug)
  );
end;
$$;

revoke all on function public.delete_draft_event(uuid) from public;
grant  execute on function public.delete_draft_event(uuid) to authenticated, service_role;

-- Note: rotate_check_in_code is introduced in migration 3 as
-- rotate_check_in_code_with_raw(event_id, raw_code, expires_at). Migration 1
-- does NOT declare a pre-hashed variant — the app never computes bcrypt hashes
-- for this surface; rotation always passes a raw code to the DB over TLS.
