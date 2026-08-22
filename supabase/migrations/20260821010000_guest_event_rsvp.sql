-- Guest RSVP: per 2026-08-21 decision, event RSVP no longer requires Google
-- sign-in. A visitor can register with name/email/phone only, Luma-style.
-- This is a deliberate override of docs/14-low-friction-signup/00-overview.md
-- §3 ("Events platform: untouched" / "Auth model: Google OAuth only, no
-- magic links") — that doc predates this decision and will be updated
-- separately. Google OAuth membership is unchanged for everyone who signs in
-- normally; this only adds a second, parallel, account-free path.
--
-- Design mirrors this repo's existing event_rsvps / rsvp_to_event pattern:
-- zero client table access, all reads/writes through SECURITY DEFINER RPCs,
-- capacity/waitlist locked via `for update` on events, rate-limited, audited.

create table public.event_guest_rsvps (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete cascade,
  name              text not null,
  email             citext not null,
  phone             text not null,
  status            public.rsvp_status_t not null default 'going',
  waitlisted_at     timestamptz,
  created_at        timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  check (status in ('going', 'waitlisted', 'cancelled'))
);

comment on table public.event_guest_rsvps is
  'Account-free RSVPs (name/email/phone only). Zero client access — see guest_rsvp_to_event(). Not a profiles/auth.users identity; a guest who later creates a real account is a separate row.';

create unique index event_guest_rsvps_event_email_idx
  on public.event_guest_rsvps (event_id, email);

create index event_guest_rsvps_event_status_idx
  on public.event_guest_rsvps (event_id, status);

alter table public.event_guest_rsvps enable row level security;

create policy event_guest_rsvps_no_client_access
  on public.event_guest_rsvps for all
  to anon, authenticated
  using (false) with check (false);

-- ============================================================================
-- event_guest_counts — going/waitlisted counts among guest rows for one
-- event. Shared by public_event_by_slug() (anon detail read) and the
-- signed-in member detail page (capacity is one shared pool across members
-- + guests), since neither can read event_guest_rsvps directly.
-- ============================================================================
create or replace function public.event_guest_counts(p_event_id uuid)
returns table (going_count bigint, waitlisted_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where status = 'going'),
    count(*) filter (where status = 'waitlisted')
  from public.event_guest_rsvps
  where event_id = p_event_id;
$$;

revoke all on function public.event_guest_counts(uuid) from public;
grant execute on function public.event_guest_counts(uuid) to anon, authenticated, service_role;

-- ============================================================================
-- guest_rsvp_to_event — the write path. Callable with no session at all.
-- ============================================================================
create or replace function public.guest_rsvp_to_event(
  p_event_id uuid,
  p_name     text,
  p_email    text,
  p_phone    text
)
returns public.rsvp_status_t
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name        text := trim(p_name);
  v_email       citext := trim(p_email);
  v_phone       text := trim(p_phone);
  v_capacity    int;
  v_waitlist    boolean;
  v_status      public.event_status_t;
  v_visibility  public.event_visibility_t;
  v_member_going int;
  v_guest_going  int;
  v_effective   public.rsvp_status_t;
  v_rate        record;
begin
  if v_name = '' or length(v_name) > 100 then
    raise exception 'guest_rsvp_to_event: name required' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'guest_rsvp_to_event: invalid email' using errcode = 'P0001';
  end if;
  if v_phone !~ '^\+?[0-9\-\(\) ]{7,20}$' then
    raise exception 'guest_rsvp_to_event: invalid phone number' using errcode = 'P0001';
  end if;

  -- ponytail: rate-limit key is the submitted email, not the caller's IP —
  -- cheap and consistent with this table's dedup key, but a spammer can churn
  -- through fake emails. Upgrade path: pass client IP from the server action
  -- and key on that too if guest RSVP abuse shows up.
  select allowed into v_rate
    from public.consume_rate_limit('guest_event_rsvp', v_email::text, 5, 60);
  if not v_rate.allowed then
    raise exception 'guest_rsvp_to_event: rate limited' using errcode = 'P0001';
  end if;

  select status, visibility, capacity, waitlist_enabled
    into v_status, v_visibility, v_capacity, v_waitlist
  from public.events
  where id = p_event_id
  for update;

  if v_status is null then
    raise exception 'guest_rsvp_to_event: event not found' using errcode = 'P0002';
  end if;
  if v_status <> 'published' or v_visibility <> 'members' then
    raise exception 'guest_rsvp_to_event: event not open to guest rsvp' using errcode = 'P0001';
  end if;

  if v_capacity is null then
    v_effective := 'going';
  else
    select count(*)::int into v_member_going
      from public.event_rsvps
     where event_id = p_event_id and status = 'going';
    select count(*)::int into v_guest_going
      from public.event_guest_rsvps
     where event_id = p_event_id and status = 'going' and email <> v_email;
    if (v_member_going + v_guest_going) < v_capacity then
      v_effective := 'going';
    elsif v_waitlist then
      v_effective := 'waitlisted';
    else
      raise exception 'guest_rsvp_to_event: event is full' using errcode = 'P0001';
    end if;
  end if;

  insert into public.event_guest_rsvps
    (event_id, name, email, phone, status, waitlisted_at, status_changed_at)
  values (
    p_event_id, v_name, v_email, v_phone, v_effective,
    case when v_effective = 'waitlisted' then now() else null end,
    now()
  )
  on conflict (event_id, email) do update
    set name              = excluded.name,
        phone             = excluded.phone,
        status            = excluded.status,
        waitlisted_at      = excluded.waitlisted_at,
        status_changed_at = now();

  perform public.write_audit(
    'event.guest_rsvp', null, null,
    jsonb_build_object(
      'event_id',  p_event_id,
      'email',     v_email,
      'effective', v_effective
    )
  );

  return v_effective;
end;
$$;

revoke all on function public.guest_rsvp_to_event(uuid, text, text, text) from public;
grant execute on function public.guest_rsvp_to_event(uuid, text, text, text)
  to anon, authenticated, service_role;

-- ============================================================================
-- admin_event_guest_rsvps_for — admin-only read of guest rows, same posture
-- as admin_event_roster_for(). Kept separate from that function/RosterRow
-- shape on purpose: guests aren't profiles rows and don't carry attendance/
-- invite/waitlist-promotion semantics yet.
-- ============================================================================
create or replace function public.admin_event_guest_rsvps_for(p_event_id uuid)
returns table (
  id                uuid,
  name              text,
  email             citext,
  phone             text,
  status            public.rsvp_status_t,
  waitlisted_at     timestamptz,
  created_at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_event_guest_rsvps_for: admin only' using errcode = 'P0001';
  end if;

  return query
  select g.id, g.name, g.email, g.phone, g.status, g.waitlisted_at, g.created_at
  from public.event_guest_rsvps g
  where g.event_id = p_event_id
  order by
    case when g.status = 'going' then 0
         when g.status = 'waitlisted' then 1
         else 2
    end,
    g.created_at asc;
end;
$$;

revoke all on function public.admin_event_guest_rsvps_for(uuid) from public;
grant execute on function public.admin_event_guest_rsvps_for(uuid)
  to authenticated, service_role;

-- ============================================================================
-- public_event_by_slug — fold guest counts into the anon-safe capacity
-- numbers. Same signature/grants as 20260820180000; only going_count /
-- waitlisted_count change.
-- ============================================================================
create or replace function public.public_event_by_slug(p_slug text)
returns table (
  id                uuid,
  slug              text,
  title             text,
  description_md    text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  location_text     text,
  location_url      text,
  capacity          int,
  waitlist_enabled  boolean,
  cover_image_path  text,
  going_count       bigint,
  waitlisted_count  bigint,
  hosts             jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.slug,
    e.title,
    e.description_md,
    e.starts_at,
    e.ends_at,
    e.location_text,
    e.location_url,
    e.capacity,
    e.waitlist_enabled,
    e.cover_image_path,
    (
      select count(*) from public.event_rsvps r
      where r.event_id = e.id and r.status = 'going'
    ) + (select gc.going_count from public.event_guest_counts(e.id) gc) as going_count,
    (
      select count(*) from public.event_rsvps r
      where r.event_id = e.id and r.status = 'waitlisted'
    ) + (select gc.waitlisted_count from public.event_guest_counts(e.id) gc) as waitlisted_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('display_name', h.display_name, 'sort_order', h.sort_order)
          order by h.sort_order
        )
        from public.event_hosts h
        where h.event_id = e.id
      ),
      '[]'::jsonb
    ) as hosts
  from public.events e
  where e.slug = p_slug
    and e.status = 'published'
    and e.visibility = 'members';
$$;

comment on function public.public_event_by_slug(text) is
  'Anonymous-safe event detail projection. Published + members-visibility events only — see 2026-08-20 RSVP-first decision. going_count/waitlisted_count include guest RSVPs (2026-08-21 guest-RSVP decision) since capacity is one shared pool. Do not add columns here without confirming they are safe for a logged-out visitor.';

revoke all on function public.public_event_by_slug(text) from public;
grant execute on function public.public_event_by_slug(text) to anon, authenticated, service_role;
