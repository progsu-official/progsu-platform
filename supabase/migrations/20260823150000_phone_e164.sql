-- Phone normalization (docs/16-guest-conversion §4.3).
--
-- profiles.phone_number is free-text and has always been: '+14045551234' and
-- '555-555-5555' both exist. Guest RSVP needs to answer "does this number
-- already belong to a member?", which is not answerable against that column.
-- A stored generated column gives us an indexable canonical form without a
-- backfill script and without touching the user-facing free-text field.
--
-- US-centric on purpose: this is a Georgia State student org. Anything that
-- isn't a plausible NANP number normalizes to NULL and therefore never
-- matches, which is the correct failure mode for a collision check — a false
-- negative sends someone down the guest path, a false positive locks a
-- stranger out of RSVP.

create or replace function public.normalize_phone_e164(p_phone text)
returns text
language sql
immutable
-- No `set search_path` here: a generated column's expression must be
-- immutable, and a function with a SET clause is not inlinable/immutable
-- enough for Postgres to accept it in a generated column. Every reference
-- below is schema-qualified or a built-in, so there is nothing to hijack.
as $$
  select case
    when p_phone is null then null
    -- 10 digits: assume +1.
    when regexp_replace(p_phone, '[^0-9]', '', 'g') ~ '^[2-9][0-9]{9}$'
      then '+1' || regexp_replace(p_phone, '[^0-9]', '', 'g')
    -- 11 digits starting with the US country code.
    when regexp_replace(p_phone, '[^0-9]', '', 'g') ~ '^1[2-9][0-9]{9}$'
      then '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
    else null
  end;
$$;

comment on function public.normalize_phone_e164(text) is
  'Canonical E.164 form for US numbers, NULL for anything unparseable. IMMUTABLE so it can drive generated columns. See docs/16-guest-conversion §4.3.';

revoke all on function public.normalize_phone_e164(text) from public;
grant execute on function public.normalize_phone_e164(text)
  to anon, authenticated, service_role;

-- Stored, not virtual: we index it. Adding it rewrites the table under an
-- ACCESS EXCLUSIVE lock; at current profiles size that is sub-second.
alter table public.profiles
  add column if not exists phone_e164 text
  generated always as (public.normalize_phone_e164(phone_number)) stored;

comment on column public.profiles.phone_e164 is
  'Generated canonical form of phone_number. Read-only; write phone_number instead. Drives the guest-RSVP collision check.';

-- Deliberately not unique. Duplicate numbers exist in real member data (shared
-- family lines, mistyped entries) and a unique constraint here would start
-- failing profile saves for a check that is only advisory.
create index if not exists profiles_phone_e164_idx
  on public.profiles (phone_e164)
  where phone_e164 is not null;
