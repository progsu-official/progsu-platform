-- Adds linkedin_url/github_url/portfolio_url to the member-card projection.
-- These already exist on `profiles` (collected at onboarding) and are
-- already in the recruiter CSV export (app/api/admin/export/route.ts) —
-- this just also surfaces them on the peer-facing card. Same privacy tier
-- as discord_username/discord_user_id: static identity links, not
-- behavioral data, so no new visibility toggle, gated by the existing
-- `discoverable` master switch only (see 20260817000300 for precedent).

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
  p.portfolio_url                    as portfolio_url

from public.profile_visibility_settings pvs
join public.profiles p on p.id = pvs.user_id
where pvs.discoverable = true
  and p.is_archived = false;

comment on view public.member_cards is
  'R2 sanitized projection for peer-visible member cards. Now also includes linkedin_url/github_url/portfolio_url (20260819000100). SECURITY INVOKER so RLS on profiles still applies to direct peer selects (returns zero rows). Peer-legal access routes through member_card_for_viewer().';

revoke all on public.member_cards from public;
grant select on public.member_cards to authenticated, service_role;
