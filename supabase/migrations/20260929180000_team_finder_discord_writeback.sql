-- Write-back leg of the hacklanta-ii team-finder sync: when an applicant sets
-- their Discord in team finder, mirror it onto their Progsu profile. Called
-- only by app/api/team-finder-discord/route.ts with the service-role client.
--
-- Guards live here, not in the route, so the update and its audit row commit
-- together:
--   * match google_email only, since student_email is unique only among
--     verified rows (20260422000000) and hacklanta only ever sends the
--     applicant's signed-in Google email;
--   * never overwrite a member who linked a real Discord identity
--     (discord_user_id, 20260817000300), the verified link wins;
--   * the handle must already satisfy the discord_username check constraint,
--     rejected rather than sanitized so nobody gets a handle that isn't theirs.
--
-- Returns the updated profile id, or null when nothing matched or the member
-- has a linked identity. No new peer-visible surface: discord_username was
-- already on the member card (20260817000200), this only adds a source.

create or replace function public.team_finder_set_discord(
  p_email            citext,
  p_discord_username text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_discord_username is null or p_discord_username !~ '^[a-z0-9._]{2,32}$' then
    raise exception 'team_finder_set_discord: invalid discord username'
      using errcode = 'P0001';
  end if;

  update public.profiles
     set discord_username = p_discord_username
   where google_email = p_email
     and discord_user_id is null
  returning id into v_id;

  if v_id is not null then
    perform public.write_audit(
      'team_finder_discord_sync',
      null,
      v_id,
      jsonb_build_object('discord_username', p_discord_username)
    );
  end if;

  return v_id;
end;
$$;

-- Supabase's default privileges grant EXECUTE to anon and authenticated
-- explicitly, so revoking from public alone is not enough (hard rule 10).
revoke all on function public.team_finder_set_discord(citext, text) from public;
revoke all on function public.team_finder_set_discord(citext, text) from anon, authenticated;
grant execute on function public.team_finder_set_discord(citext, text) to service_role;
