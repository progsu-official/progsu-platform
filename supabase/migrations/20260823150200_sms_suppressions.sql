-- Global SMS suppression list (docs/16-guest-conversion §4.4).
--
-- Carriers require STOP to be honoured across every campaign and every
-- consent record. This table is the single authority: it supersedes
-- legacy_members.sms_consent_at and the consents ledger alike, and every send
-- path checks it first. It exists before any provider integration on purpose —
-- there must be nowhere to send a message from that can bypass it.

create table if not exists public.sms_suppressions (
  phone_e164  text primary key check (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  reason      text not null check (reason in ('stop_keyword', 'manual', 'carrier')),
  note        text,
  created_at  timestamptz not null default now()
);

comment on table public.sms_suppressions is
  'Do-not-text list keyed on canonical E.164. Supersedes every consent record. Checked before every send. Zero client access; written by suppress_sms_number() only.';

alter table public.sms_suppressions enable row level security;

create policy sms_suppressions_no_client_access
  on public.sms_suppressions for all
  to anon, authenticated
  using (false) with check (false);

-- ============================================================================
-- suppress_sms_number — the only write path. Idempotent: a second STOP from
-- the same number must not error, and must not overwrite the original reason
-- (the first opt-out is the one that matters for an audit trail).
-- ============================================================================
create or replace function public.suppress_sms_number(
  p_phone  text,
  p_reason text,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164 text := public.normalize_phone_e164(p_phone);
begin
  if v_e164 is null then
    raise exception 'suppress_sms_number: unparseable phone number' using errcode = 'P0001';
  end if;
  if p_reason not in ('stop_keyword', 'manual', 'carrier') then
    raise exception 'suppress_sms_number: invalid reason' using errcode = 'P0001';
  end if;

  insert into public.sms_suppressions (phone_e164, reason, note)
  values (v_e164, p_reason, p_note)
  on conflict (phone_e164) do nothing;

  perform public.write_audit(
    'sms.suppressed', null, null,
    jsonb_build_object('phone_e164', v_e164, 'reason', p_reason)
  );
end;
$$;

revoke all on function public.suppress_sms_number(text, text, text) from public;
grant execute on function public.suppress_sms_number(text, text, text) to service_role;
