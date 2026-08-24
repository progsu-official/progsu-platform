-- Two things for the /events list, both about the same number: "N going".
--
-- 1. REGRESSION FIX. 20260824000000 recreated member_visible_events and
--    public_upcoming_events to add external_url/pinned, and in doing so
--    reverted going_count/waitlisted_count to a bare count over event_rsvps.
--    That silently undid three earlier migrations:
--      20260823010000 — fold event_guest_counts() into both counts
--      20260823080000 — fold approved historical_event_attendances
--      20260823130000 — same fold, carried into member_visible_events
--    Live effect: the Fall Kickoff Carnival showed "3 going" on /events
--    (3 member RSVPs) while its own detail page showed 13, because
--    public_event_by_slug() and event_attendee_faces() kept the fold and the
--    two list surfaces lost it. Capacity is one shared pool across members,
--    guests, and imported attendance, so every surface has to count it the
--    same way. Restored here verbatim from 20260823130000.
--
-- 2. event_attendee_faces_batch() — the set-returning sibling of
--    event_attendee_faces(). The list wants the same avatar stack the detail
--    page has, and calling the single-event function once per row is 50
--    round-trips per page render. Same visibility gate, same fold, same
--    "counted but never named" rule for legacy attendees.

-- ----------------------------------------------------------------------------
-- member_visible_events — restore the fold. Column list and order are
-- unchanged from 20260824000000 (create or replace view requires it).
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
    where r.event_id = e.id and r.status = 'going')
    + (select gc.going_count from public.event_guest_counts(e.id) gc)
    + (select count(*) from public.historical_event_attendances ha
        where ha.event_id = e.id and ha.approval_status ilike 'approved') as going_count,
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
-- public_upcoming_events — same fold for the logged-out feed. Signature and
-- column order match 20260824000000 exactly; only the two count expressions
-- change.
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
    ) as going_count,
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
-- event_attendee_faces_batch(uuid[], int)
--
-- Everything event_attendee_faces() promises, for many events in one call.
-- The rules it inherits, spelled out because this is the copy a list surface
-- will reach for:
--
--   VISIBILITY. SECURITY DEFINER over caller-supplied UUIDs is an oracle if
--   it does not gate itself, so each id is filtered through the same test the
--   single-event version uses: can_view_event() for a signed-in caller, and
--   the public_event_by_slug() projection (published + members) for an
--   anonymous one. Ids the caller cannot see are dropped from the result
--   rather than returned as zero rows — a hidden event stays
--   indistinguishable from one that was never asked about.
--
--   WHOSE FACE APPEARS. Only discoverable, non-archived platform profiles.
--   The ~1,600 imported legacy attendees are counted in total_count and
--   never named; they have no account here and accepted no privacy policy.
-- ----------------------------------------------------------------------------
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
