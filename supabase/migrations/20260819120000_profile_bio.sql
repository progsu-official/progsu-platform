-- Adds a short, member-authored bio, the other half of the 8/14 delegation
-- ("profile image upload + customizable bio" — avatar landed in
-- 20260818130000). One line, capped, same self-serve pattern as
-- linkedin_url/github_url/portfolio_url: no moderation step, member types
-- it in Settings, shown on the card when discoverable = true.

alter table public.profiles
  add column if not exists bio text
    check (bio is null or (length(bio) <= 220 and bio !~ '[\r\n]'));

comment on column public.profiles.bio is
  'Short one-line self-authored bio, member-editable, max 220 chars, no line breaks. Shown on the member card when discoverable = true, same tier as linkedin_url/github_url/portfolio_url.';

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
  p.bio                              as bio

from public.profile_visibility_settings pvs
join public.profiles p on p.id = pvs.user_id
where pvs.discoverable = true
  and p.is_archived = false;

comment on view public.member_cards is
  'R2 sanitized projection for peer-visible member cards. Now also includes bio (20260819120000). SECURITY INVOKER so RLS on profiles still applies to direct peer selects (returns zero rows). Peer-legal access routes through member_card_for_viewer().';

revoke all on public.member_cards from public;
grant select on public.member_cards to authenticated, service_role;
