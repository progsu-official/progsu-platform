-- list_member_cards: open the directory to any signed-in member.
--
-- The viewer gate here has been narrower than the rest of the member-card
-- surface since 20260424000100, and nothing depended on the difference.
--
-- can_view_member_card -- which backs the individual card at /members/[slug] --
-- asks only whether the *target* is discoverable (plus self and admin
-- shortcuts). It has never asked whether the viewer finished onboarding. So a
-- member could always open a peer's card directly; only the list refused to
-- enumerate. The narrower gate on the list was the outlier, and this brings it
-- in line rather than tightening the detail page to match.
--
-- 20260820150000 widened this to `is_fully_onboarded or is_admin`, which was
-- the smallest fix for admins stranded by the privacy_policy v4 bump. This
-- replaces that with the actual intent: signed in is enough.
--
-- app/members/layout.tsx drops its matching onboarding redirect in the same
-- change. Both layers have to move together -- relaxing only the route hands
-- the member a rendered page over an empty result set, and relaxing only the
-- function leaves them redirected before they can reach it. That split is
-- exactly what produced the empty directory this fixes.
--
-- What this does NOT widen: membership of the list. The member_cards view still
-- filters to discoverable = true and is_archived = false, so an opted-out member
-- stays out no matter who is looking. This changes who may read the list, not
-- what the list contains.
--
-- p_viewer_id stays required. It is not a security boundary here -- the function
-- is SECURITY DEFINER and callers pass their own auth.uid() -- but a null viewer
-- still means "no session", and that returns nothing.

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
