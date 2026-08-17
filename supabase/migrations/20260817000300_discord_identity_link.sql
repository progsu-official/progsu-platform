-- Upgrades the manually-typed discord_username (20260817000200) to a real
-- linked identity. A signed-in member calls supabase.auth.linkIdentity to
-- attach their Discord account via Supabase's built-in multi-provider
-- identity linking (auth.external.discord in config.toml) — no new OAuth
-- code, no separate account. discord_user_id is the real Discord snowflake,
-- which makes https://discord.com/users/<id> an actual working link for
-- anyone sharing a Discord server with them (true for Progsu members).
-- discord_username stays as the cached display label, now written by the
-- callback route from the linked identity's data instead of typed by hand.
--
-- Cuts the whole "manual free-text handle" dimension rather than keeping it
-- alongside the verified version — one mechanism, not two competing ones.

alter table public.profiles
  add column if not exists discord_user_id text;

comment on column public.profiles.discord_user_id is
  'Real Discord snowflake from a linked identity (auth.identities), set by app/auth/discord/callback/route.ts. Makes discord.com/users/<id> a real link. Null until the member connects Discord.';

-- Recreate member_cards to add discord_user_id at the end (Postgres forbids
-- inserting a view column anywhere but the end via CREATE OR REPLACE).
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
  p.discord_user_id                  as discord_user_id

from public.profile_visibility_settings pvs
join public.profiles p on p.id = pvs.user_id
where pvs.discoverable = true
  and p.is_archived = false;

comment on view public.member_cards is
  'R2 sanitized projection for peer-visible member cards, now including discord_user_id (20260817000300) alongside discord_username. SECURITY INVOKER so RLS on profiles still applies to direct peer selects (returns zero rows). Peer-legal access routes through member_card_for_viewer().';

revoke all on public.member_cards from public;
grant select on public.member_cards to authenticated, service_role;
