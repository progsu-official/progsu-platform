-- Points: per-event rule + append-only ledger.
--
-- Awards are written only by the staff-verified attendance paths
-- (mobile_staff_scan / mobile_staff_manual_checkin, 20261003120000), never by
-- self_qr, never by admin backfill/correct_attendance 'set'. Removing an
-- attendance writes a reversal (trigger below). Re-checking in after a
-- reversal may award again, but only while the net for (user, event) is zero,
-- so the net award for one event is capped at one award.
--
-- Entitlement keys:
--   event:{event}:user:{user}:attendance        first award
--   event:{event}:user:{user}:attendance:{n}    n-th award after n reversals
--   event:{event}:user:{user}:reversal:{n}      n-th reversal
--   adjustment:{uuid}                           officer adjustment
-- entitlement_key is unique, and every award/reversal takes a per-(user,event)
-- advisory lock, so concurrent scans cannot double-award.

do $$ begin
  create type public.point_entry_kind_t as enum ('award', 'reversal', 'adjustment');
exception when duplicate_object then null; end $$;

create table public.point_rules (
  event_id      uuid primary key references public.events(id) on delete cascade,
  points        int check (points is null or (points >= 0 and points <= 10000)),
  rule_version  int not null default 1 check (rule_version >= 1),
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.point_rules is
  'Points per event attendance. points null = unconfigured (awards nothing). rule_version bumps on every change and is copied onto ledger rows.';

alter table public.point_rules enable row level security;

create policy point_rules_select_authenticated
  on public.point_rules for select
  to authenticated
  using (public.can_view_event(event_id, auth.uid()));

revoke insert, update, delete, truncate on public.point_rules from anon, authenticated;

create table public.point_ledger (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  event_id         uuid references public.events(id) on delete set null,
  entitlement_key  text not null unique check (length(entitlement_key) <= 200),
  amount           int not null,
  kind             public.point_entry_kind_t not null,
  rule_version     int,
  points_snapshot  int,
  source           text not null check (source in (
                     'mobile_staff_scan', 'mobile_staff_manual', 'attendance_removed', 'officer_adjustment'
                   )),
  reason           text check (reason is null or length(reason) <= 500),
  actor            uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint point_ledger_sign check (
    (kind = 'award' and amount > 0)
    or (kind = 'reversal' and amount < 0)
    or (kind = 'adjustment' and amount <> 0)
  ),
  constraint point_ledger_adjustment_reason check (
    kind <> 'adjustment' or (reason is not null and length(btrim(reason)) >= 3)
  )
);

comment on table public.point_ledger is
  'Append-only points ledger. Balance = sum(amount). No client writes; no update/delete grants for anyone but the table owner.';

create index point_ledger_user_idx on public.point_ledger (user_id, created_at desc, id desc);
create index point_ledger_user_event_idx on public.point_ledger (user_id, event_id);

alter table public.point_ledger enable row level security;

create policy point_ledger_select_own
  on public.point_ledger for select
  to authenticated
  using (auth.uid() = user_id);

create policy point_ledger_select_admin
  on public.point_ledger for select
  to authenticated
  using (public.is_admin(auth.uid()));

revoke insert, update, delete, truncate on public.point_ledger from anon, authenticated, service_role;

-- ============================================================================
-- Internal helpers (no grants: callable only from other definer functions)
-- ============================================================================
create or replace function public._points_lock(p_event_id uuid, p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('points:' || p_event_id::text || ':' || p_user_id::text, 0));
$$;

revoke all on function public._points_lock(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public._points_award_attendance(
  p_event_id uuid,
  p_user_id  uuid,
  p_actor    uuid,
  p_source   text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points  int;
  v_version int;
  v_net     int;
  v_awards  int;
  v_key     text;
  v_id      uuid;
begin
  perform public._points_lock(p_event_id, p_user_id);

  select points, rule_version into v_points, v_version
    from public.point_rules where event_id = p_event_id;
  if v_points is null or v_points <= 0 then
    return 0;
  end if;

  select coalesce(sum(amount), 0)::int,
         count(*) filter (where kind = 'award')::int
    into v_net, v_awards
    from public.point_ledger
   where user_id = p_user_id and event_id = p_event_id
     and kind in ('award', 'reversal');

  if v_net > 0 then
    return 0;
  end if;

  v_key := 'event:' || p_event_id || ':user:' || p_user_id || ':attendance'
           || case when v_awards = 0 then '' else ':' || v_awards end;

  insert into public.point_ledger (
    user_id, event_id, entitlement_key, amount, kind, rule_version,
    points_snapshot, source, actor
  ) values (
    p_user_id, p_event_id, v_key, v_points, 'award', v_version,
    v_points, p_source, p_actor
  )
  on conflict (entitlement_key) do nothing
  returning id into v_id;

  if v_id is null then
    return 0;
  end if;
  return v_points;
end;
$$;

revoke all on function public._points_award_attendance(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- Reversal on attendance removal (any path: correct_attendance 'remove',
-- staff_remove_check_in, ...). Skipped when the event or profile itself is
-- being deleted — the ledger row follows the FK in that case.
create or replace function public.reverse_points_on_attendance_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_net       int;
  v_reversals int;
begin
  if not exists (select 1 from public.events where id = old.event_id)
     or not exists (select 1 from public.profiles where id = old.user_id) then
    return old;
  end if;

  perform public._points_lock(old.event_id, old.user_id);

  select coalesce(sum(amount), 0)::int,
         count(*) filter (where kind = 'reversal')::int
    into v_net, v_reversals
    from public.point_ledger
   where user_id = old.user_id and event_id = old.event_id
     and kind in ('award', 'reversal');

  if v_net <= 0 then
    return old;
  end if;

  insert into public.point_ledger (
    user_id, event_id, entitlement_key, amount, kind, source, reason, actor
  ) values (
    old.user_id, old.event_id,
    'event:' || old.event_id || ':user:' || old.user_id || ':reversal:' || (v_reversals + 1),
    -v_net, 'reversal', 'attendance_removed', 'attendance removed', auth.uid()
  )
  on conflict (entitlement_key) do nothing;

  perform public.write_audit(
    'points.reversal', auth.uid(), old.user_id,
    jsonb_build_object('event_id', old.event_id, 'amount', -v_net)
  );
  return old;
end;
$$;

revoke all on function public.reverse_points_on_attendance_delete() from public, anon, authenticated;

create trigger event_attendances_reverse_points
  after delete on public.event_attendances
  for each row execute function public.reverse_points_on_attendance_delete();

-- ============================================================================
-- admin_set_event_points — configure (or clear) the per-event rule.
-- ============================================================================
create or replace function public.admin_set_event_points(
  p_event_id uuid,
  p_points   int
)
returns table (points int, rule_version int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_before jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_set_event_points: admin only' using errcode = 'P0001';
  end if;
  if p_points is not null and (p_points < 0 or p_points > 10000) then
    raise exception 'admin_set_event_points: points must be between 0 and 10000' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'admin_set_event_points: event not found' using errcode = 'P0002';
  end if;

  select to_jsonb(r.*) into v_before from public.point_rules r where r.event_id = p_event_id;

  insert into public.point_rules as r (event_id, points, updated_by)
  values (p_event_id, p_points, v_uid)
  on conflict (event_id) do update
    set points       = excluded.points,
        rule_version = r.rule_version + case when r.points is distinct from excluded.points then 1 else 0 end,
        updated_by   = v_uid,
        updated_at   = now();

  perform public.write_audit(
    'points.set_rule', v_uid, null,
    jsonb_build_object('event_id', p_event_id, 'before', v_before, 'points', p_points)
  );

  return query select r.points, r.rule_version from public.point_rules r where r.event_id = p_event_id;
end;
$$;

revoke all on function public.admin_set_event_points(uuid, int) from public, anon, authenticated;
grant  execute on function public.admin_set_event_points(uuid, int) to authenticated, service_role;

-- ============================================================================
-- admin_adjust_points — officer adjustment with reason.
-- ============================================================================
create or replace function public.admin_adjust_points(
  p_user_id  uuid,
  p_amount   int,
  p_reason   text,
  p_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_adjust_points: admin only' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000 then
    raise exception 'admin_adjust_points: amount must be non-zero and at most 10000' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'admin_adjust_points: reason required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'admin_adjust_points: member not found' using errcode = 'P0002';
  end if;

  insert into public.point_ledger (
    user_id, event_id, entitlement_key, amount, kind, source, reason, actor
  ) values (
    p_user_id, p_event_id, 'adjustment:' || gen_random_uuid(), p_amount,
    'adjustment', 'officer_adjustment', btrim(p_reason), v_uid
  )
  returning id into v_id;

  perform public.write_audit(
    'points.adjust', v_uid, p_user_id,
    jsonb_build_object('ledger_id', v_id, 'amount', p_amount, 'event_id', p_event_id, 'reason', btrim(p_reason))
  );
  return v_id;
end;
$$;

revoke all on function public.admin_adjust_points(uuid, int, text, uuid) from public, anon, authenticated;
grant  execute on function public.admin_adjust_points(uuid, int, text, uuid) to authenticated, service_role;

-- ============================================================================
-- points_balance — caller's own balance (admins may ask about anyone).
-- ============================================================================
create or replace function public.points_balance(p_user_id uuid default null)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, v_uid);
begin
  if v_uid is null then
    raise exception 'points_balance: unauthenticated' using errcode = 'P0001';
  end if;
  if v_target <> v_uid and not public.is_admin(v_uid) then
    raise exception 'points_balance: admin only' using errcode = 'P0001';
  end if;
  return coalesce((select sum(amount)::int from public.point_ledger where user_id = v_target), 0);
end;
$$;

revoke all on function public.points_balance(uuid) from public, anon, authenticated;
grant  execute on function public.points_balance(uuid) to authenticated, service_role;

grant select on public.point_rules  to authenticated;
grant all    on public.point_rules  to service_role;
grant select on public.point_ledger to authenticated, service_role;
