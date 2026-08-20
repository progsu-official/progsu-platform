-- Profile note and banner.
--
-- Two member-authored surfaces, same self-serve tier as bio/linkedin_url:
-- the member types or uploads it, there is no moderation step, and it shows
-- on the member card when discoverable = true.
--
--   note        a short status line that renders in a bubble over the avatar
--   banner_url  a wide header image above the profile
--
-- Both are peer-visible, so 20260820130100 bumps privacy_policy to v4 and the
-- onboarding cascade routes existing members to re-accept.

alter table public.profiles
  add column if not exists note text
    check (note is null or (length(note) <= 80 and note !~ '[\r\n]'));

comment on column public.profiles.note is
  'Short self-authored status line, member-editable, max 80 chars, no line breaks. Rendered over the avatar. Shown on the member card when discoverable = true.';

alter table public.profiles
  add column if not exists banner_url text;

comment on column public.profiles.banner_url is
  'Public URL of the profile banner in the banners bucket. Null means the surface falls back to a generated gradient. Shown on the member card when discoverable = true.';

-- ---------------------------------------------------------------------------
-- banners bucket
-- ---------------------------------------------------------------------------
-- Mirrors 20260818130000_avatar_uploads: public-read, owner-scoped writes,
-- object names {user_id}/{uuid}.{ext} so they are not enumerable. Cap is
-- larger than avatars because these are wide crops, not 96px circles.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'banners',
  'banners',
  true,
  4 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists banners_storage_insert_own on storage.objects;
create policy banners_storage_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists banners_storage_delete_own on storage.objects;
create policy banners_storage_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- member_cards — add the two new columns
-- ---------------------------------------------------------------------------
-- member_card_for_viewer() returns setof member_cards, so replacing the view
-- is all that is needed for peers to see these.

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
  p.banner_url                       as banner_url

from public.profile_visibility_settings pvs
join public.profiles p on p.id = pvs.user_id
where pvs.discoverable = true
  and p.is_archived = false;

comment on view public.member_cards is
  'R2 sanitized projection for peer-visible member cards. Now also includes note/banner_url (20260820130000). SECURITY INVOKER so RLS on profiles still applies to direct peer selects (returns zero rows). Peer-legal access routes through member_card_for_viewer().';

revoke all on public.member_cards from public;
grant select on public.member_cards to authenticated, service_role;
