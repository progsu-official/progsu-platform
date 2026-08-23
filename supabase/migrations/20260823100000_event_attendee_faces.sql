-- Attendee social proof on the member event page.
--
-- The page has always shown a bare "N going" derived from event_rsvps alone.
-- Two things were wrong with that:
--
-- 1. Pre-platform events keep their attendance in historical_event_attendances
--    (1,600+ rows keyed to legacy_members — see 20260821020000), which that
--    count never touched. An event that actually drew 231 people rendered
--    "1 going" to members while /admin showed the real number.
-- 2. RLS on event_rsvps is self-only, so a member cannot see who else is
--    coming at all. No user-context query can produce an attendee list,
--    however it is written — hence a SECURITY DEFINER helper.
--
-- WHOSE FACE APPEARS. Only people with a platform profile that is
-- discoverable = true. Historical attendees reach a profile through
-- legacy_members.claimed_profile_id; the ~1,500 imported people who never
-- signed in have no profile, never accepted a privacy policy, and are only
-- ever part of the total. That happens to be the same shape Luma renders
-- ("Ti, Asmat and 229 others"), and it is also the only shape that does not
-- publish the name of someone who has no account here.
--
-- WHY THE VIEWER IS NOT A PARAMETER. This is SECURITY DEFINER over a raw
-- event_id, which makes it an oracle if it does not gate on visibility
-- itself: feed it UUIDs and it hands back guest lists for private_invite
-- events. It gates on auth.uid() rather than an argument because a
-- p_viewer_id argument is spoofable — an anonymous caller could name an
-- invited member's id and read the list. list_member_cards() takes a viewer
-- argument, but there the worst case is enumerating an already-public
-- directory; here it is a private guest list, so the looser pattern does not
-- carry over.
--
-- A caller who cannot see the event gets (0, '[]') rather than an error, so a
-- hidden event stays indistinguishable from an empty one.

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

comment on function public.event_attendee_faces(uuid, int) is
  'Attendee count + a capped set of peer-visible faces for one event. Total folds live RSVPs, guest RSVPs, and approved historical attendance. Faces are restricted to discoverable platform profiles — imported legacy attendees are counted, never named. Gates on auth.uid() internally; returns (0, ''[]'') for events the caller cannot see.';

revoke all on function public.event_attendee_faces(uuid, int) from public;
grant  execute on function public.event_attendee_faces(uuid, int)
  to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- public_event_by_slug: fold guest + historical attendance into going_count.
--
-- Replaces the body from 20260820180000. Two count bugs, same root cause —
-- the projection counted event_rsvps only:
--
--   * Guest RSVPs were missing, so an anonymous visitor saw a smaller number
--     than a signed-in member looking at the same event (the authed path in
--     app/events/[slug]/page.tsx has folded event_guest_counts() in since
--     20260821010000).
--   * Historical attendance was missing, same as above.
--
-- Column list and visibility filter are carried forward verbatim; only the
-- two count expressions change.
-- ----------------------------------------------------------------------------

create or replace function public.public_event_by_slug(p_slug text)
returns table (
  id                uuid,
  slug              text,
  title             text,
  description_md    text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  location_text     text,
  location_url      text,
  capacity          int,
  waitlist_enabled  boolean,
  cover_image_path  text,
  going_count       bigint,
  waitlisted_count  bigint,
  hosts             jsonb
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
    e.description_md,
    e.starts_at,
    e.ends_at,
    e.location_text,
    e.location_url,
    e.capacity,
    e.waitlist_enabled,
    e.cover_image_path,
    (
      (select count(*) from public.event_rsvps r
        where r.event_id = e.id and r.status = 'going')
    + (select count(*) from public.event_guest_rsvps g
        where g.event_id = e.id and g.status = 'going')
    + (select count(*) from public.historical_event_attendances h
        where h.event_id = e.id and lower(h.approval_status) = 'approved')
    ) as going_count,
    (
      (select count(*) from public.event_rsvps r
        where r.event_id = e.id and r.status = 'waitlisted')
    + (select count(*) from public.event_guest_rsvps g
        where g.event_id = e.id and g.status = 'waitlisted')
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
    ) as hosts
  from public.events e
  where e.slug = p_slug
    and e.status = 'published'
    and e.visibility = 'members';
$$;

comment on function public.public_event_by_slug(text) is
  'Anonymous-safe event detail projection. Published + members-visibility events only — see 2026-08-20 RSVP-first decision. going_count folds live + guest + historical attendance (20260823100000). Do not add columns here without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_event_by_slug(text) from public;
grant execute on function public.public_event_by_slug(text) to anon, authenticated, service_role;
