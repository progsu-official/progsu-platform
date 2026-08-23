-- Close anon/authenticated EXECUTE on the two service-role-only helpers added
-- by 20260823150200 and 20260823150300.
--
-- `revoke all on function ... from public` does NOT do what it looks like it
-- does on Supabase. The project ships default privileges that grant EXECUTE on
-- every new function in `public` to `anon` and `authenticated` explicitly, and
-- revoking from PUBLIC leaves those explicit grants standing. Confirmed by
-- reading pg_proc.proacl after applying those migrations:
--
--   upsert_guest_identity => postgres=X/postgres | anon=X/postgres |
--                            authenticated=X/postgres | service_role=X/postgres
--
-- upsert_guest_identity is the one that mattered. Reachable by anon, it lets
-- anybody insert or update arbitrary legacy_members rows — including staging a
-- row against a stranger's email with attacker-chosen major, phone, and SMS
-- consent, which handle_new_user() would then copy onto that person's real
-- profile the first time they sign in with Google. Caught by
-- scripts/smoke-guest-conversion.ts, which now asserts the denial for both.
--
-- Existing service-role-only helpers elsewhere in the schema are likely to
-- have the same gap. Not swept here — out of scope for this change, and each
-- needs its own look at whether an internal guard already covers it.

revoke execute on function public.suppress_sms_number(text, text, text)
  from anon, authenticated;

revoke execute on function public.upsert_guest_identity(text, citext, text, text, boolean, text)
  from anon, authenticated;
