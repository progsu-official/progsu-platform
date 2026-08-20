-- Extends the peer-visible member card (R2, migration 000100) with the
-- sections needed to make /members/[slug] match the redesigned /profile
-- layout: education (major/minor, verification badge without the email
-- itself), upcoming RSVPs, and current-resume access. Every new surface
-- routes through can_view_member_card(), same gate as the existing card.
--
-- ponytail: no per-member "share my resume/events" toggle. John asked to
-- ship everything on by default with a way to turn a whole section off
-- later; that's FEATURE_PUBLIC_PROFILE_RESUME / _EVENTS env flags at the
-- app layer, not per-member consent rows. Upgrade path: add consent columns
-- to profile_visibility_settings if a member ever wants to opt out
-- individually.

-- ============================================================================
-- member_cards: add education fields. Email itself stays out of the
-- projection on purpose (per John, 2026-08-20) -- only whether it's verified.
-- ============================================================================
-- CREATE OR REPLACE VIEW can only append columns, never insert them between
-- existing ones (Postgres errors on a column-position change) -- so every
-- new column below is appended at the end, not slotted in next to the
-- field it's conceptually related to.
create or replace view public.member_cards
with (security_invoker = true)
as
select
  p.id                               as user_id,
  pvs.profile_slug                   as profile_slug,

  coalesce(nullif(trim(p.preferred_name), ''), p.first_name)
                                     as display_name,

  p.avatar_url                       as avatar_url,
  p.school                           as school,
  p.class_standing                   as class_standing,
  p.grad_term                        as grad_term,
  p.grad_year                        as grad_year,
  p.interested_roles                 as interested_roles,
  pvs.share_attended_events          as share_attended_events,
  pvs.last_discoverability_change_at as visible_since,
  p.discord_username                 as discord_username,
  p.discord_user_id                  as discord_user_id,
  p.linkedin_url                     as linkedin_url,
  p.github_url                       as github_url,
  p.portfolio_url                    as portfolio_url,
  p.bio                              as bio,
  p.note                             as note,
  p.banner_url                       as banner_url,
  p.major                            as major,
  p.major_other_text                 as major_other_text,
  p.minor                            as minor,
  (p.student_email is not null)      as has_student_email,
  p.student_email_verified           as student_email_verified,
  p.pending_domain_name              as pending_domain_name

from public.profile_visibility_settings pvs
join public.profiles p on p.id = pvs.user_id
where pvs.discoverable = true
  and p.is_archived = false;

comment on view public.member_cards is
  'R2 sanitized projection for peer-visible member cards. SECURITY INVOKER so RLS on profiles still applies to direct peer selects (returns zero rows). Peer-legal access routes through member_card_for_viewer(). Extended 2026-08-20 with education fields for the public profile page; student_email itself is deliberately excluded, only has_student_email + verification state.';

revoke all on public.member_cards from public;
grant select on public.member_cards to authenticated, service_role;

-- ============================================================================
-- member_upcoming_events_for_viewer(viewer, target) — target's future
-- going/waitlisted RSVPs on events safe to show a peer. Mirrors
-- member_card_attended_events_for_viewer's exclusions (sensitive,
-- private-invite) plus restricts to published + not-yet-ended, since a
-- cancelled/archived event has nothing "upcoming" about it here.
-- ============================================================================
create or replace function public.member_upcoming_events_for_viewer(
  p_viewer_id uuid,
  p_target_id uuid,
  p_limit     int default 3
)
returns table (
  event_id         uuid,
  slug             text,
  title            text,
  starts_at        timestamptz,
  status           text,
  location_text    text,
  cover_image_path text,
  rsvp_status      text,
  going_count      bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_viewer_id is null or p_target_id is null then
    return;
  end if;
  if not public.can_view_member_card(p_viewer_id, p_target_id) then
    return;
  end if;

  return query
  select
    e.id          as event_id,
    e.slug,
    e.title,
    e.starts_at,
    e.status::text as status,
    e.location_text,
    e.cover_image_path,
    r.status::text as rsvp_status,
    (
      select count(*) from public.event_rsvps gc
      where gc.event_id = e.id and gc.status = 'going'
    ) as going_count
  from public.event_rsvps r
  join public.events e on e.id = r.event_id
  where r.user_id = p_target_id
    and r.status in ('going', 'waitlisted')
    and e.status = 'published'
    and e.ends_at >= now()
    and e.is_sensitive = false
    and e.visibility <> 'private_invite'
  order by e.starts_at asc
  limit greatest(p_limit, 0);

  get diagnostics v_rows = row_count;

  if p_viewer_id <> p_target_id then
    perform public.write_audit(
      'member.card_upcoming_events_view',
      p_viewer_id,
      p_target_id,
      jsonb_build_object('event_count', v_rows)
    );
  end if;
end;
$$;

revoke all on function public.member_upcoming_events_for_viewer(uuid, uuid, int) from public;
grant  execute on function public.member_upcoming_events_for_viewer(uuid, uuid, int)
  to authenticated, service_role;

-- ============================================================================
-- member_current_resume_for_viewer(viewer, target) — storage path + file
-- name of target's current resume, if any. No signed URL here (that needs
-- the storage admin client, which lives at the app layer) -- this just
-- answers "is there one, and where."
-- ============================================================================
create or replace function public.member_current_resume_for_viewer(
  p_viewer_id uuid,
  p_target_id uuid
)
returns table (
  storage_path text,
  file_name    text,
  uploaded_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_viewer_id is null or p_target_id is null then
    return;
  end if;
  if not public.can_view_member_card(p_viewer_id, p_target_id) then
    return;
  end if;

  return query
  select r.storage_path, r.file_name, r.uploaded_at
  from public.resumes r
  where r.user_id = p_target_id
    and r.is_current = true
  limit 1;

  if p_viewer_id <> p_target_id then
    perform public.write_audit(
      'member.card_resume_view',
      p_viewer_id,
      p_target_id,
      '{}'::jsonb
    );
  end if;
end;
$$;

revoke all on function public.member_current_resume_for_viewer(uuid, uuid) from public;
grant  execute on function public.member_current_resume_for_viewer(uuid, uuid)
  to authenticated, service_role;
