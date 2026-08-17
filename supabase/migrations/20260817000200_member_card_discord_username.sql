-- Adds an optional Discord username members can attach to their profile.
-- Unlike linkedin_url/github_url/portfolio_url (deliberately withheld from
-- peers per docs/10-r2-member-card-spec.md §"Not exposed to peers"), Discord
-- is peer-visible by design here: the whole point is letting a member reach
-- another member without in-app messaging (explicitly out of scope, see
-- docs/01-product-architect.md V0 scope). It rides the same discoverable
-- opt-in as the rest of the member card — no separate switch.
--
-- This is a real privacy-policy-relevant exposure, matching the R2 spec's own
-- rule that adding a peer-visible field is a policy amendment, not just a
-- view edit. /privacy needs a copy update before this ships to real members;
-- tracked as a follow-up, not blocking local dev.

alter table public.profiles
  add column if not exists discord_username text
  check (
    discord_username is null
    or discord_username ~ '^[a-z0-9._]{2,32}$'
  );

comment on column public.profiles.discord_username is
  'Optional Discord username (new-style, no #tag). Peer-visible on the member card when discoverable=true — see member_cards view.';

-- Recreate member_cards to add the new column. Same definition as
-- 20260424000100_member_cards.sql plus discord_username.
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
  p.discord_username                 as discord_username

from public.profile_visibility_settings pvs
join public.profiles p on p.id = pvs.user_id
where pvs.discoverable = true
  and p.is_archived = false;

comment on view public.member_cards is
  'R2 sanitized projection for peer-visible member cards, now including discord_username (20260817000200). SECURITY INVOKER so RLS on profiles still applies to direct peer selects (returns zero rows). Peer-legal access routes through member_card_for_viewer().';

revoke all on public.member_cards from public;
grant select on public.member_cards to authenticated, service_role;
