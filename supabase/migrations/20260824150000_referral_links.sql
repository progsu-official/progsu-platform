-- Referral links — campaign attribution for events.
--
-- We push events through flyers, Discord posts, class announcements and
-- tabling, and today the only thing the platform can tell you afterwards is
-- how many people RSVP'd. Not which push worked. This adds a short link per
-- campaign — progsu.com/r/<slug> — that redirects to the event and counts
-- what happened next.
--
-- THE PRIVACY LINE, AND WHY IT IS STRUCTURAL:
--
-- referral_link_hits has no user column, and must never gain one. Not a
-- user_id, not an email, not a guest_rsvp_id, not an IP. The table can answer
-- "the flyer brought 40 RSVPs" and "they arrived on the 12th"; it can never
-- answer "Natasha came from the flyer".
--
-- That is a deliberate scope choice, not an oversight. Attaching a referral
-- source to a named member creates a new category of personal data about
-- where someone came from, which is a peer-invisible-but-still-personal fact
-- we would then hold indefinitely — CLAUDE.md hard rule #8 territory, needing
-- a privacy_policy bump and a re-acceptance cascade for all 214 members. The
-- aggregate answers are the ones anyone actually acts on when deciding where
-- to put next semester's posters, so we buy those and skip the rest.
--
-- If per-person attribution is ever genuinely wanted, it is a new migration
-- with a new table and a consent bump. Do not quietly widen this one.
--
-- Access model: RLS on, zero policies, so PostgREST refuses every direct
-- client read and write. Every entry point below is SECURITY DEFINER and
-- granted to service_role only — admin reads go through the server actions in
-- lib/actions/referrals.ts, and hit recording happens in the /r/<slug> route
-- handler and the RSVP actions on the admin client. Nothing here is reachable
-- from a browser, which is what stops an anon caller inflating a campaign's
-- numbers by replaying the RPC.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'referral_hit_kind_t') then
    create type public.referral_hit_kind_t as enum ('click', 'rsvp', 'signup');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.referral_links (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  slug        text not null unique,
  label       text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint referral_links_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  constraint referral_links_label_len
    check (char_length(trim(label)) between 1 and 80)
);

comment on table public.referral_links is
  'One campaign link per (event, channel). slug is the /r/<slug> path segment. Archived links stop resolving but keep their history.';

create index if not exists referral_links_event_idx
  on public.referral_links (event_id, created_at desc);

create table if not exists public.referral_link_hits (
  id             bigint generated always as identity primary key,
  link_id        uuid not null references public.referral_links(id) on delete cascade,
  kind           public.referral_hit_kind_t not null,
  -- For 'click': this browser had no prior cookie for this link, so it is a
  -- new visitor rather than a refresh. Always true for 'rsvp' and 'signup',
  -- which are deduped at the call site by a cookie flag.
  is_new_visitor boolean not null default true,
  occurred_at    timestamptz not null default now()
);

comment on table public.referral_link_hits is
  'Append-only aggregate counter rows for referral links. Deliberately holds NO identifier for the person: no user_id, no email, no IP. See the header of migration 20260824150000 before adding any column here.';

create index if not exists referral_link_hits_link_kind_idx
  on public.referral_link_hits (link_id, kind);

create index if not exists referral_link_hits_link_time_idx
  on public.referral_link_hits (link_id, occurred_at desc);

alter table public.referral_links      enable row level security;
alter table public.referral_link_hits  enable row level security;

-- No policies, on purpose. Everything goes through the helpers below.
revoke all on public.referral_links     from anon, authenticated;
revoke all on public.referral_link_hits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- generate_referral_slug() — random slug for the default case
-- ---------------------------------------------------------------------------
-- Alphabet drops i/l/o/0/1: these get read off a printed flyer and typed by
-- hand, and that is exactly where those five characters cost you a visitor.
create or replace function public.generate_referral_slug()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_slug     text;
  v_attempt  int := 0;
begin
  loop
    v_slug := '';
    for _ in 1..7 loop
      v_slug := v_slug || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (
      select 1 from public.referral_links rl where rl.slug = v_slug
    );

    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'generate_referral_slug: could not find a free slug'
        using errcode = 'P0001';
    end if;
  end loop;

  return v_slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_referral_link(event_id, slug, label) — admin only
-- ---------------------------------------------------------------------------
-- p_slug null/blank mints a random one. A supplied slug is normalised and
-- must be free; collision raises rather than silently suffixing, because the
-- admin typed that specific string for a reason and a surprise suffix is a
-- flyer reprint.
create or replace function public.create_referral_link(
  p_event_id uuid,
  p_slug     text default null,
  p_label    text default null
)
returns public.referral_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_slug  text;
  v_label text;
  v_row   public.referral_links;
begin
  if not public.is_admin(v_uid) then
    raise exception 'create_referral_link: admin only' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'create_referral_link: event not found' using errcode = 'P0002';
  end if;

  v_label := nullif(trim(coalesce(p_label, '')), '');
  if v_label is null then
    raise exception 'create_referral_link: label is required'
      using errcode = 'P0001';
  end if;
  if char_length(v_label) > 80 then
    raise exception 'create_referral_link: label must be 80 characters or fewer'
      using errcode = 'P0001';
  end if;

  v_slug := lower(trim(coalesce(p_slug, '')));
  if v_slug = '' then
    v_slug := public.generate_referral_slug();
  else
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
      raise exception 'create_referral_link: slug must be 3-40 characters, lowercase letters, numbers and dashes, not starting or ending with a dash'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.referral_links rl where rl.slug = v_slug) then
      raise exception 'create_referral_link: that link is already taken'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.referral_links (event_id, slug, label, created_by)
  values (p_event_id, v_slug, v_label, v_uid)
  returning * into v_row;

  perform public.write_audit(
    'referral.link_created',
    v_uid,
    null,
    jsonb_build_object('link_id', v_row.id, 'event_id', p_event_id, 'slug', v_slug, 'label', v_label)
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- archive_referral_link(id) — admin only, reversible
-- ---------------------------------------------------------------------------
-- Archiving stops the link resolving but keeps its counts, because "the
-- spring flyer did nothing" is a result worth keeping. p_archived false
-- brings it back — a link killed by mistake should not need a new slug.
create or replace function public.archive_referral_link(
  p_id       uuid,
  p_archived boolean default true
)
returns public.referral_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.referral_links;
begin
  if not public.is_admin(v_uid) then
    raise exception 'archive_referral_link: admin only' using errcode = 'P0001';
  end if;

  update public.referral_links
     set archived_at = case when p_archived then now() else null end
   where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'archive_referral_link: link not found' using errcode = 'P0002';
  end if;

  perform public.write_audit(
    case when p_archived then 'referral.link_archived' else 'referral.link_restored' end,
    v_uid,
    null,
    jsonb_build_object('link_id', v_row.id, 'slug', v_row.slug)
  );

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_referral_links_for(event_id) — admin only, aggregate read
-- ---------------------------------------------------------------------------
-- No audit row: this is a tab, read on every navigation to it, and every
-- number in it is an org-level aggregate. One audit row per page view would
-- bury the log in "an officer looked at a click count". Same reasoning as
-- admin_platform_analytics(); the line is drawn at per-member data, and this
-- function is structurally incapable of returning any.
create or replace function public.admin_referral_links_for(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows jsonb;
begin
  if not public.is_admin(v_uid) then
    raise exception 'admin_referral_links_for: admin only' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select
      rl.id,
      rl.slug,
      rl.label,
      rl.created_at,
      rl.archived_at,
      coalesce(nullif(trim(p.preferred_name), ''), p.first_name) as created_by_name,
      (select count(*) from public.referral_link_hits h
         where h.link_id = rl.id and h.kind = 'click')::int as clicks,
      (select count(*) from public.referral_link_hits h
         where h.link_id = rl.id and h.kind = 'click' and h.is_new_visitor)::int as visitors,
      (select count(*) from public.referral_link_hits h
         where h.link_id = rl.id and h.kind = 'rsvp')::int as rsvps,
      (select count(*) from public.referral_link_hits h
         where h.link_id = rl.id and h.kind = 'signup')::int as signups,
      (select max(h.occurred_at) from public.referral_link_hits h
         where h.link_id = rl.id) as last_hit_at
    from public.referral_links rl
    left join public.profiles p on p.id = rl.created_by
    where rl.event_id = p_event_id
  ) r;

  return jsonb_build_object('links', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_referral_click(slug, is_new_visitor) — resolve + count in one call
-- ---------------------------------------------------------------------------
-- Returns the destination event slug, or no rows when the link is unknown,
-- archived, or points at an event that is not published. The route handler
-- treats an empty result as "send them to /events" rather than 404 — a dead
-- campaign link in the wild should land somewhere useful, not on an error.
create or replace function public.record_referral_click(
  p_slug           text,
  p_is_new_visitor boolean default true
)
returns table (link_id uuid, event_slug text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link  uuid;
  v_eslug text;
begin
  select rl.id, e.slug
    into v_link, v_eslug
  from public.referral_links rl
  join public.events e on e.id = rl.event_id
  where rl.slug = lower(trim(coalesce(p_slug, '')))
    and rl.archived_at is null
    and e.status = 'published';

  if v_link is null then
    return;
  end if;

  insert into public.referral_link_hits (link_id, kind, is_new_visitor)
  values (v_link, 'click', coalesce(p_is_new_visitor, true));

  return query select v_link, v_eslug;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_referral_conversion(slug, kind) — count an RSVP or a signup
-- ---------------------------------------------------------------------------
-- Deliberately refuses 'click': clicks are only ever recorded by the redirect
-- above, so a bug in a call site cannot inflate top-of-funnel. Archived links
-- still accept conversions — someone who clicked before it was archived and
-- RSVPs after should still be counted to the campaign that brought them.
create or replace function public.record_referral_conversion(
  p_slug text,
  p_kind public.referral_hit_kind_t
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link uuid;
begin
  if p_kind = 'click' then
    raise exception 'record_referral_conversion: clicks are recorded by record_referral_click'
      using errcode = 'P0001';
  end if;

  select rl.id into v_link
  from public.referral_links rl
  where rl.slug = lower(trim(coalesce(p_slug, '')));

  if v_link is null then
    return false;
  end if;

  insert into public.referral_link_hits (link_id, kind)
  values (v_link, p_kind);

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — service_role only, all of it
-- ---------------------------------------------------------------------------

revoke all on function public.generate_referral_slug()                                     from public;
revoke all on function public.create_referral_link(uuid, text, text)                        from public;
revoke all on function public.archive_referral_link(uuid, boolean)                          from public;
revoke all on function public.admin_referral_links_for(uuid)                                from public;
revoke all on function public.record_referral_click(text, boolean)                          from public;
revoke all on function public.record_referral_conversion(text, public.referral_hit_kind_t)  from public;

-- The three admin entry points still check is_admin(auth.uid()) internally.
-- They are granted to authenticated as well as service_role because the
-- server actions call them on the user's own client, which is what makes
-- auth.uid() resolve to the acting admin for the audit row.
grant execute on function public.create_referral_link(uuid, text, text)  to authenticated, service_role;
grant execute on function public.archive_referral_link(uuid, boolean)    to authenticated, service_role;
grant execute on function public.admin_referral_links_for(uuid)          to authenticated, service_role;

-- Hit recording is service_role only: these have no caller identity to check,
-- so the only thing stopping replay is that a browser cannot reach them.
grant execute on function public.generate_referral_slug()                                    to service_role;
grant execute on function public.record_referral_click(text, boolean)                        to service_role;
grant execute on function public.record_referral_conversion(text, public.referral_hit_kind_t) to service_role;
