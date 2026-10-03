-- In-app account deletion bookkeeping + encrypted Sign in with Apple refresh
-- tokens (needed to revoke the Apple grant when the account is deleted).
-- Both tables are service-role only; the workflow lives in
-- lib/mobile/deletion.ts and runs server-side.
--
-- The existing account_deletion_requests table (20260421070100, manual
-- 30-day review) cascades away with the profile, so it cannot record that a
-- deletion finished. account_deletion_jobs has no FK to profiles on purpose:
-- the row outlives the user so a retry can see the deletion completed.

create table public.account_deletion_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique,
  status        text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  source        text not null default 'mobile' check (source in ('mobile', 'web', 'admin')),
  steps         jsonb not null default '{}'::jsonb,
  attempts      int not null default 0,
  last_error    text,
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz
);

alter table public.account_deletion_jobs enable row level security;
revoke all on public.account_deletion_jobs from anon, authenticated;

create table public.apple_provider_tokens (
  user_id                   uuid primary key references public.profiles(id) on delete cascade,
  client_id                 text not null,
  refresh_token_ciphertext  text not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on column public.apple_provider_tokens.refresh_token_ciphertext is
  'AES-256-GCM (APP_ENCRYPTION_KEY) of the Apple refresh token: v1.<iv>.<tag>.<ciphertext>, base64url.';

alter table public.apple_provider_tokens enable row level security;
revoke all on public.apple_provider_tokens from anon, authenticated;

grant all on public.account_deletion_jobs, public.apple_provider_tokens to service_role;
