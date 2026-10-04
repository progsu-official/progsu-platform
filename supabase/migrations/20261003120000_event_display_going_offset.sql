-- Display-only offset on the public "N going" number, for a Hacklanta II
-- social-proof experiment (2026-10-03). Added to the four surfaces members and
-- visitors see: member_visible_events, public_upcoming_events,
-- event_attendee_faces, event_attendee_faces_batch. Everything else (admin
-- roster/analytics, exports, check in, capacity checks in RSVP RPCs, Discord
-- counts, SMS reminders) keeps reading the real tables. Default 0, so every
-- other event is unchanged. End the experiment with
--   update events set display_going_offset = 0 where slug = 'hacklanta-ii';
-- Bodies below are copied from 20260824100000 / 20260823100000 with only the
-- offset added; keep it when those get recreated.

alter table public.events
  add column if not exists display_going_offset int not null default 0
  check (display_going_offset >= 0);

comment on column public.events.display_going_offset is
  'Added to the public going count only (lists, detail attendee stack). Never counted in capacity, admin, exports. See 20261003120000.';

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
    where r.event_id = e.id and r.status = 'going')
    + (select gc.going_count from public.event_guest_counts(e.id) gc)
    + (select count(*) from public.historical_event_attendances ha
        where ha.event_id = e.id and ha.approval_status ilike 'approved')
    + e.display_going_offset as going_count,
  (select count(*) from public.event_rsvps r
    where r.event_id = e.id and r.status = 'waitlisted')
    + (select gc.waitlisted_count from public.event_guest_counts(e.id) gc) as waitlisted_count,
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
  'Member event discovery feed. Excludes draft/cancelled/archived (D6 — cancelled still viewable on direct detail via can_view_event). going_count/waitlisted_count fold event_guest_counts() and approved historical_event_attendances alongside live RSVPs; keep that fold when adding columns (20260824000000 dropped it by accident). SECURITY INVOKER so RLS on events applies.';

revoke all on public.member_visible_events from public;
grant  select on public.member_visible_events to authenticated, service_role;

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
    )
    + (select gc.going_count from public.event_guest_counts(e.id) gc)
    + (
      select count(*) from public.historical_event_attendances ha
      where ha.event_id = e.id and ha.approval_status ilike 'approved'
    )
    + e.display_going_offset as going_count,
    (
      select count(*) from public.event_rsvps r
      where r.event_id = e.id and r.status = 'waitlisted'
    )
    + (select gc.waitlisted_count from public.event_guest_counts(e.id) gc)
      as waitlisted_count,
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
  'Anonymous-safe upcoming-events discovery feed. Published + members-visibility only — see 2026-08-20 RSVP-first decision. going_count/waitlisted_count fold guest RSVPs and approved historical attendance. Do not add columns without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_upcoming_events(int) from public;
grant execute on function public.public_upcoming_events(int) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------

create or replace function public.event_attendee_faces(
  p_event_id uuid,
  p_limit    int default 12
)
returns table (total_count int, faces jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid    := auth.uid();
  v_limit  int     := greatest(1, least(coalesce(p_limit, 12), 50));
  v_ok     boolean := false;
begin
  if v_viewer is null then
    -- Anonymous: mirror public_event_by_slug()'s projection exactly rather
    -- than inventing a third visibility rule.
    select exists (
      select 1
      from public.events e
      where e.id = p_event_id
        and e.status = 'published'
        and e.visibility = 'members'
    )
    into v_ok;
  else
    select public.can_view_event(p_event_id, v_viewer) into v_ok;
  end if;

  if not coalesce(v_ok, false) then
    total_count := 0;
    faces       := '[]'::jsonb;
    return next;
    return;
  end if;

  -- Capacity is one shared pool across members, guests, and (for imported
  -- events) historical attendance, so the headline number folds all three.
  total_count := (
    (select count(*) from public.event_rsvps r
      where r.event_id = p_event_id and r.status = 'going')
  + (select count(*) from public.event_guest_rsvps g
      where g.event_id = p_event_id and g.status = 'going')
  + (select count(*) from public.historical_event_attendances h
      where h.event_id = p_event_id
        and lower(h.approval_status) = 'approved')
  + (select e.display_going_offset from public.events e where e.id = p_event_id)
  )::int;

  with candidates as (
    -- One row per person. Someone can appear both as a live RSVP and as a
    -- claimed historical attendee; group by user_id so they get one face.
    select c.user_id, min(c.at) as at
    from (
      select r.user_id, r.rsvp_at as at
      from public.event_rsvps r
      where r.event_id = p_event_id
        and r.status = 'going'

      union all

      select lm.claimed_profile_id as user_id, h.registered_at as at
      from public.historical_event_attendances h
      join public.legacy_members lm on lm.id = h.legacy_member_id
      where h.event_id = p_event_id
        and lower(h.approval_status) = 'approved'
        and lm.claimed_profile_id is not null
    ) c
    where c.user_id is not null
    group by c.user_id
  )
  select coalesce(jsonb_agg(s.face order by s.ord), '[]'::jsonb)
  into faces
  from (
    select
      jsonb_build_object(
        'user_id',      p.id,
        'display_name', coalesce(nullif(trim(p.preferred_name), ''), p.first_name),
        'avatar_url',   p.avatar_url,
        'profile_slug', pvs.profile_slug
      ) as face,
      -- Materialised rank, not just an ORDER BY on the subquery: jsonb_agg
      -- makes no promise about the input order of a subselect, so the
      -- avatar-first sort has to be carried into the aggregate explicitly.
      row_number() over (
        order by (p.avatar_url is not null) desc, c.at asc nulls last, p.id
      ) as ord
    from candidates c
    join public.profiles p
      on p.id = c.user_id
    join public.profile_visibility_settings pvs
      on pvs.user_id = p.id
    where pvs.discoverable = true
      and p.is_archived = false
    -- Avatar-bearing profiles first so the stack never opens on a row of
    -- blank initials; stable tiebreak on user_id keeps paging deterministic.
    order by ord
    limit v_limit
  ) s;

  return next;
end;
$$;

create or replace function public.event_attendee_faces_batch(
  p_event_ids uuid[],
  p_limit     int default 5
)
returns table (event_id uuid, total_count int, faces jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with ids as (
    select distinct e.id
    from unnest(coalesce(p_event_ids, '{}'::uuid[])) as u(id)
    join public.events e on e.id = u.id
    where case
            when auth.uid() is null
              then e.status = 'published' and e.visibility = 'members'
            else public.can_view_event(e.id, auth.uid())
          end
  ),
  totals as (
    select
      i.id,
      (
        (select count(*) from public.event_rsvps r
          where r.event_id = i.id and r.status = 'going')
      + (select count(*) from public.event_guest_rsvps g
          where g.event_id = i.id and g.status = 'going')
      + (select count(*) from public.historical_event_attendances h
          where h.event_id = i.id and lower(h.approval_status) = 'approved')
      + (select e.display_going_offset from public.events e where e.id = i.id)
      )::int as total
    from ids i
  ),
  candidates as (
    -- One row per (event, person): someone can be both a live RSVP and a
    -- claimed historical attendee on the same event.
    select c.ev_id, c.uid, min(c.at) as at
    from (
      select r.event_id as ev_id, r.user_id as uid, r.rsvp_at as at
      from public.event_rsvps r
      join ids i on i.id = r.event_id
      where r.status = 'going'

      union all

      select h.event_id as ev_id, lm.claimed_profile_id as uid, h.registered_at as at
      from public.historical_event_attendances h
      join ids i on i.id = h.event_id
      join public.legacy_members lm on lm.id = h.legacy_member_id
      where lower(h.approval_status) = 'approved'
        and lm.claimed_profile_id is not null
    ) c
    where c.uid is not null
    group by c.ev_id, c.uid
  ),
  ranked as (
    select
      c.ev_id,
      jsonb_build_object(
        'user_id',      p.id,
        'display_name', coalesce(nullif(trim(p.preferred_name), ''), p.first_name),
        'avatar_url',   p.avatar_url,
        'profile_slug', pvs.profile_slug
      ) as face,
      -- Avatar-bearing profiles first so a stack never opens on blank
      -- initials; stable tiebreak on id keeps the order deterministic.
      row_number() over (
        partition by c.ev_id
        order by (p.avatar_url is not null) desc, c.at asc nulls last, p.id
      ) as ord
    from candidates c
    join public.profiles p
      on p.id = c.uid
    join public.profile_visibility_settings pvs
      on pvs.user_id = p.id
    where pvs.discoverable = true
      and p.is_archived = false
  )
  select
    t.id,
    t.total,
    coalesce(
      (
        select jsonb_agg(rk.face order by rk.ord)
        from ranked rk
        where rk.ev_id = t.id
          and rk.ord  <= greatest(1, least(coalesce(p_limit, 5), 12))
      ),
      '[]'::jsonb
    )
  from totals t;
$$;

comment on function public.event_attendee_faces_batch(uuid[], int) is
  'Batch sibling of event_attendee_faces(): attendee count + capped peer-visible faces for many events in one call, for list surfaces. Totals fold live RSVPs, guest RSVPs, and approved historical attendance; faces are discoverable platform profiles only. Gates every id on visibility internally and omits rows the caller cannot see.';

revoke all on function public.event_attendee_faces_batch(uuid[], int) from public;
grant  execute on function public.event_attendee_faces_batch(uuid[], int)
  to anon, authenticated, service_role;
