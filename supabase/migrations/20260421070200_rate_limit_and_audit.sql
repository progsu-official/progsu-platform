-- Migration 000003 — rate-limit ledger + RPC + audit-write helper.
-- Reconciliation #6: DB-backed rate limiting for V0 (Upstash comes later).
-- Reconciliation #19: verify flow stays app-transactional; this migration only adds
-- a SECURITY DEFINER helper so server actions (running as authenticated) can append
-- audit rows without needing the service role.

-- ============================================================================
-- rate_limit_hits — append-only ledger of throttled actions.
-- Entries older than the widest window (1h for V0) are pruned by a cron job.
-- ============================================================================
create table public.rate_limit_hits (
  id          bigserial primary key,
  bucket      text not null,    -- e.g. 'otp_send', 'otp_verify'
  key         text not null,    -- e.g. user_id, email, ip
  created_at  timestamptz not null default now()
);

comment on table public.rate_limit_hits is
  'Append-only throttle ledger. Consumed by public.consume_rate_limit(). Cleanup cron deletes rows older than 1h.';

-- Hot-path lookup: newest hits per (bucket, key).
create index rate_limit_hits_bucket_key_idx
  on public.rate_limit_hits (bucket, key, created_at desc);

alter table public.rate_limit_hits enable row level security;

-- Zero client access. All reads/writes flow through consume_rate_limit() (service_role).
create policy rate_limit_hits_no_auth_select
  on public.rate_limit_hits for select
  to authenticated
  using (false);

create policy rate_limit_hits_no_auth_write
  on public.rate_limit_hits for all
  to authenticated
  using (false) with check (false);

-- ============================================================================
-- consume_rate_limit — atomic "fire one hit; am I allowed?"
-- Counts hits in the trailing window; if count < max_hits, record a new hit and
-- return allowed=true. Otherwise return allowed=false with retry_after_ms set to
-- the time until the oldest-counting hit expires.
-- ============================================================================
create or replace function public.consume_rate_limit(
  p_bucket         text,
  p_key            text,
  p_max_hits       int,
  p_window_seconds int
)
returns table (
  allowed         boolean,
  retry_after_ms  int,
  hits_in_window  int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  v_current_hits int;
  v_oldest_hit   timestamptz;
begin
  if p_max_hits <= 0 or p_window_seconds <= 0 then
    raise exception 'consume_rate_limit: max_hits and window_seconds must be > 0';
  end if;

  select count(*)::int, min(created_at)
    into v_current_hits, v_oldest_hit
  from public.rate_limit_hits
  where bucket = p_bucket
    and key = p_key
    and created_at >= v_window_start;

  if v_current_hits < p_max_hits then
    insert into public.rate_limit_hits (bucket, key) values (p_bucket, p_key);
    return query select true, 0, v_current_hits + 1;
  else
    return query select
      false,
      -- ms until the oldest counting hit falls out of the window
      greatest(
        0,
        extract(milliseconds from
          (v_oldest_hit + make_interval(secs => p_window_seconds)) - now()
        )::int
      ),
      v_current_hits;
  end if;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, int, int) from public;
grant  execute on function public.consume_rate_limit(text, text, int, int)
  to authenticated, service_role;

-- ============================================================================
-- write_audit — SECURITY DEFINER helper so server actions can append audit rows
-- under the authenticated user's JWT without exposing service-role credentials.
-- Any trust decisions belong in the calling action; this helper only enforces that
-- the supplied `actor_user_id` matches auth.uid() unless called by service_role.
-- ============================================================================
create or replace function public.write_audit(
  p_action     text,
  p_actor      uuid,
  p_target     uuid,
  p_metadata   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_caller_role text := coalesce(auth.role(), '');
begin
  -- Authenticated callers may only write audit rows on their own behalf.
  -- service_role bypasses this (used by background jobs, admin exports, etc.).
  if v_caller_role = 'authenticated' then
    if p_actor is null or p_actor <> auth.uid() then
      raise exception 'write_audit: actor must equal auth.uid() for authenticated callers'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.audit_log (actor_user_id, target_user_id, action, metadata)
  values (p_actor, p_target, p_action, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.write_audit(text, uuid, uuid, jsonb) from public;
grant  execute on function public.write_audit(text, uuid, uuid, jsonb)
  to authenticated, service_role;
