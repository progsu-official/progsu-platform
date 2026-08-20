-- list_member_cards: let admins through the onboarding gate.
--
-- The route layer and the data layer disagreed about admins, and the disagreement
-- was invisible.
--
-- app/members/layout.tsx deliberately does not bounce an admin who is behind on
-- onboarding -- "Admins bypass onboarding (same contract as /profile). They can
-- still browse /members for support/moderation -- no bounce." can_view_member_card
-- agrees, and has carried `or public.is_admin(p_viewer_id)` since 20260424000100.
-- list_member_cards, defined a few hundred lines below it in that same file, never
-- got the same clause.
--
-- So an admin behind on consent is admitted to the page and then served zero rows
-- by the RPC behind it, landing on "No members have opted into the directory yet."
-- A regular member never sees this, because the layout redirects them to
-- /onboarding/consent and they fix it on the way back. The bypass that spares
-- admins the redirect is exactly what strands them.
--
-- Surfaced by the privacy_policy v4 bump in 20260820130100: it invalidated every
-- existing consent at once, so every admin hit this simultaneously against a
-- directory that had just been backfilled to 197 members.
--
-- This only relaxes *who may read the list*. It does not widen what the list
-- contains -- membership is still `discoverable = true` via the member_cards view,
-- and admins could already read any single card through can_view_member_card.
--
-- Body is otherwise carried forward verbatim from the live definition.

create or replace function public.list_member_cards(
  p_viewer_id   uuid,
  p_cursor_ts   timestamptz default null,
  p_cursor_user uuid        default null,
  p_limit       int         default 24,
  p_search      text        default null
)
returns setof public.member_cards
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit  int := greatest(1, least(coalesce(p_limit, 24), 100));
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  if p_viewer_id is null then
    return;
  end if;
  -- Matches app/members/layout.tsx and can_view_member_card: onboarded members
  -- or any admin.
  if not (public.is_fully_onboarded(p_viewer_id) or public.is_admin(p_viewer_id)) then
    return;
  end if;

  return query
  select mc.*
  from public.member_cards mc
  where (
    p_cursor_ts is null
    or mc.visible_since < p_cursor_ts
    or (mc.visible_since = p_cursor_ts and mc.user_id > coalesce(p_cursor_user, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  and (
    v_search is null
    or lower(mc.display_name) like v_search || '%'
  )
  order by mc.visible_since desc nulls last, mc.user_id asc
  limit v_limit;
end;
$$;

revoke all on function public.list_member_cards(uuid, timestamptz, uuid, int, text) from public;
grant  execute on function public.list_member_cards(uuid, timestamptz, uuid, int, text)
  to authenticated, service_role;
