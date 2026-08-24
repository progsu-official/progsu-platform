-- Adds two small event-level controls, requested for Hacklanta II (which has
-- its own site at hacklanta.dev — the in-platform event page is redundant
-- for that one) but built generically so any future flagship event can reuse
-- them without another migration:
--
--   external_url — when set, the event card on /events links straight out to
--     this URL instead of the internal /events/[slug] page. Distinct from
--     location_url (a meeting-link/virtual-location field with its own
--     "virtual event" semantics) — this is "skip our own RSVP page
--     entirely," not "where the event happens."
--   pinned — when true, the event sorts first in the Upcoming feed
--     regardless of start date ("always the top of the funnel").

alter table public.events
  add column external_url text check (
    external_url is null or external_url ~* '^https?://'
  ),
  add column pinned boolean not null default false;

comment on column public.events.external_url is
  'When set, /events cards link straight here instead of the internal event detail page.';
comment on column public.events.pinned is
  'When true, sorts first in the Upcoming feed regardless of starts_at.';

-- ----------------------------------------------------------------------------
-- create_event / update_event — thread the two new columns through the same
-- jsonb-payload RPCs the composer already calls.
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
    external_url, pinned,
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
    p_payload ->> 'external_url',
    coalesce((p_payload ->> 'pinned')::boolean, false),
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
         external_url        = case when p_patch ? 'external_url'
                                    then p_patch ->> 'external_url'
                                    else external_url end,
         pinned              = coalesce((p_patch ->> 'pinned')::boolean, pinned),
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

-- ----------------------------------------------------------------------------
-- member_visible_events — add the two columns to the member discovery feed.
-- ----------------------------------------------------------------------------
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
    where r.event_id = e.id and r.status = 'waitlisted') as waitlisted_count,
  e.external_url,
  e.pinned
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

-- ----------------------------------------------------------------------------
-- public_upcoming_events — add the two columns + pin ordering for the
-- anonymous-visitor feed. Both new columns are safe for a logged-out visitor
-- (external_url is meant to be public; pinned is just an ordering hint).
-- ----------------------------------------------------------------------------
drop function if exists public.public_upcoming_events(int);

create function public.public_upcoming_events(p_limit int default 50)
returns table (
  id                uuid,
  slug              text,
  title             text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  location_text     text,
  cover_image_path  text,
  capacity          int,
  waitlist_enabled  boolean,
  going_count       bigint,
  waitlisted_count  bigint,
  hosts             jsonb,
  external_url      text,
  pinned            boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.slug,
    e.title,
    e.starts_at,
    e.ends_at,
    e.location_text,
    e.cover_image_path,
    e.capacity,
    e.waitlist_enabled,
    (
      select count(*) from public.event_rsvps r
      where r.event_id = e.id and r.status = 'going'
    ) as going_count,
    (
      select count(*) from public.event_rsvps r
      where r.event_id = e.id and r.status = 'waitlisted'
    ) as waitlisted_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('display_name', h.display_name, 'sort_order', h.sort_order)
          order by h.sort_order
        )
        from public.event_hosts h
        where h.event_id = e.id
      ),
      '[]'::jsonb
    ) as hosts,
    e.external_url,
    e.pinned
  from public.events e
  where e.status = 'published'
    and e.visibility = 'members'
    and e.ends_at >= now()
  order by e.pinned desc, e.starts_at asc
  limit greatest(p_limit, 0);
$$;

comment on function public.public_upcoming_events(int) is
  'Anonymous-safe upcoming-events discovery feed. Published + members-visibility only — see 2026-08-20 RSVP-first decision. Do not add columns without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_upcoming_events(int) from public;
grant execute on function public.public_upcoming_events(int) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Data: pin Hacklanta II and point it at hacklanta.dev directly.
-- ----------------------------------------------------------------------------
update public.events
   set external_url = 'https://hacklanta.dev',
       pinned = true
 where id = 'db2de7ae-2683-4ba2-afc3-d5811962271e';
