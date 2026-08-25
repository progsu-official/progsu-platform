-- Fixes an access hole in 20260824150000.
--
-- That migration ended with `revoke all on function ... from public` and then
-- granted the hit recorders to service_role only, on the assumption that this
-- left them unreachable from a browser. It did not. Supabase ships
--
--   alter default privileges in schema public
--     grant all on functions to anon, authenticated, service_role;
--
-- so every function created in `public` arrives with EXECUTE already granted
-- to `anon` and `authenticated` as explicit, per-role grants. Revoking from
-- the PUBLIC pseudo-role does not touch those — PUBLIC and "the anon role"
-- are different grantees, and only the former was revoked.
--
-- Net effect on prod between 20260824150000 and this migration: any browser
-- could have called record_referral_click / record_referral_conversion
-- directly and inflated a campaign's numbers. No data was exposed — those
-- functions only ever write counters and return a slug the caller already
-- had — and the window was minutes on a feature still behind an off flag.
-- Caught by smoke-referral-links.ts, which asserts the refusal rather than
-- assuming the grant block worked.
--
-- The lesson worth keeping: in this database, "granted to service_role only"
-- requires an explicit revoke from anon and authenticated. A revoke from
-- public is not enough for anything created in the public schema.

-- Hit recorders: no caller identity to check, so being unreachable from a
-- browser is the entire anti-abuse story.
revoke all on function public.generate_referral_slug()
  from anon, authenticated;
revoke all on function public.record_referral_click(text, boolean)
  from anon, authenticated;
revoke all on function public.record_referral_conversion(text, public.referral_hit_kind_t)
  from anon, authenticated;

-- Admin entry points keep their `authenticated` grant — the server actions
-- call them on the acting officer's client so auth.uid() names them in the
-- audit row, and each re-checks is_admin internally. An anonymous caller has
-- no business reaching them at all, so drop that grant rather than relying on
-- the is_admin(null) refusal.
revoke all on function public.create_referral_link(uuid, text, text) from anon;
revoke all on function public.archive_referral_link(uuid, boolean)   from anon;
revoke all on function public.admin_referral_links_for(uuid)         from anon;
