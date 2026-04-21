-- Migration 000005 — add age_confirmation to consent_type_t enum (decision D3).
-- Enum extensions are additive: we cannot remove values without a full rebuild, so this
-- change is one-way. Safe because our app treats unknown consent types as optional.

alter type public.consent_type_t add value if not exists 'age_confirmation';
