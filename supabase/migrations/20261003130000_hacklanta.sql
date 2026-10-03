-- Hacklanta event-guide data (editions, floors, rooms, sessions), personal
-- bookmarks, and the link between a Progsu account and a Hacklanta
-- application (which lives in a separate Supabase project).
--
-- Nothing is seeded here. Sessions come from scripts/import-hacklanta-schedule.ts
-- (data/hacklanta-ii-schedule.json); floors, rooms and theme from /admin/hacklanta.
-- points_note is display text for competition prizes, never an auto-award;
-- officers award those through admin_adjust_points.

do $$ begin
  create type public.hacklanta_theme_override_t as enum ('auto', 'force_on', 'force_off');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.hacklanta_session_status_t as enum ('scheduled', 'cancelled', 'moved');
exception when duplicate_object then null; end $$;

create table public.hacklanta_editions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid references public.events(id) on delete set null,
  slug            text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9\-]{0,62}[a-z0-9])?$'),
  name            text not null check (length(name) between 1 and 120),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  time_zone       text not null default 'America/New_York' check (length(time_zone) between 1 and 64),
  venue_name      text check (venue_name is null or length(venue_name) <= 200),
  venue_address   text check (venue_address is null or length(venue_address) <= 500),
  lat             double precision check (lat is null or lat between -90 and 90),
  lng             double precision check (lng is null or lng between -180 and 180),
  theme           jsonb not null default '{}'::jsonb,
  theme_override  public.hacklanta_theme_override_t not null default 'auto',
  schedule_tentative boolean not null default true,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint hacklanta_editions_time_order check (starts_at < ends_at)
);

create table public.hacklanta_floors (
  id          uuid primary key default gen_random_uuid(),
  edition_id  uuid not null references public.hacklanta_editions(id) on delete cascade,
  name        text not null check (length(name) between 1 and 80),
  sort        int not null default 0,
  image_path  text check (image_path is null or length(image_path) <= 500),
  version     int not null default 1 check (version >= 1),
  updated_at  timestamptz not null default now()
);
create index hacklanta_floors_edition_idx on public.hacklanta_floors (edition_id, sort);

create table public.hacklanta_rooms (
  id           uuid primary key default gen_random_uuid(),
  edition_id   uuid not null references public.hacklanta_editions(id) on delete cascade,
  floor_id     uuid references public.hacklanta_floors(id) on delete set null,
  name         text not null check (length(name) between 1 and 120),
  kind         text not null default 'room' check (kind ~ '^[a-z_]{1,32}$'),
  description  text check (description is null or length(description) <= 1000),
  x            double precision check (x is null or x between 0 and 1),
  y            double precision check (y is null or y between 0 and 1),
  updated_at   timestamptz not null default now()
);
create index hacklanta_rooms_edition_idx on public.hacklanta_rooms (edition_id);

create table public.hacklanta_sessions (
  id           uuid primary key default gen_random_uuid(),
  edition_id   uuid not null references public.hacklanta_editions(id) on delete cascade,
  key          text not null check (key ~ '^[a-z0-9][a-z0-9\-]{0,79}$'),
  title        text not null check (length(title) between 1 and 200),
  description  text check (description is null or length(description) <= 4000),
  kind         text not null default 'session' check (kind ~ '^[a-z_]{1,32}$'),
  track        text check (track is null or length(track) <= 80),
  room_id      uuid references public.hacklanta_rooms(id) on delete set null,
  room_label   text check (room_label is null or length(room_label) <= 120),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  status       public.hacklanta_session_status_t not null default 'scheduled',
  points_note  text check (points_note is null or length(points_note) <= 200),
  updated_at   timestamptz not null default now(),
  constraint hacklanta_sessions_key_uniq unique (edition_id, key),
  constraint hacklanta_sessions_time_order check (ends_at is null or starts_at < ends_at)
);
create index hacklanta_sessions_edition_idx on public.hacklanta_sessions (edition_id, starts_at);

create trigger hacklanta_editions_set_updated_at before update on public.hacklanta_editions
  for each row execute function public.set_updated_at();
create trigger hacklanta_floors_set_updated_at before update on public.hacklanta_floors
  for each row execute function public.set_updated_at();
create trigger hacklanta_rooms_set_updated_at before update on public.hacklanta_rooms
  for each row execute function public.set_updated_at();
create trigger hacklanta_sessions_set_updated_at before update on public.hacklanta_sessions
  for each row execute function public.set_updated_at();

create or replace function public.hacklanta_edition_is_published(p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hacklanta_editions e
     where e.id = p_edition_id and e.published_at is not null and e.published_at <= now()
  );
$$;

revoke all on function public.hacklanta_edition_is_published(uuid) from public, anon, authenticated;
grant  execute on function public.hacklanta_edition_is_published(uuid) to anon, authenticated, service_role;

alter table public.hacklanta_editions enable row level security;
alter table public.hacklanta_floors   enable row level security;
alter table public.hacklanta_rooms    enable row level security;
alter table public.hacklanta_sessions enable row level security;

create policy hacklanta_editions_public_read on public.hacklanta_editions for select
  to anon, authenticated using (published_at is not null and published_at <= now());
create policy hacklanta_floors_public_read on public.hacklanta_floors for select
  to anon, authenticated using (public.hacklanta_edition_is_published(edition_id));
create policy hacklanta_rooms_public_read on public.hacklanta_rooms for select
  to anon, authenticated using (public.hacklanta_edition_is_published(edition_id));
create policy hacklanta_sessions_public_read on public.hacklanta_sessions for select
  to anon, authenticated using (public.hacklanta_edition_is_published(edition_id));

-- Admin CRUD from the web admin pages runs under the admin's own session.
create policy hacklanta_editions_admin_all on public.hacklanta_editions for all
  to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy hacklanta_floors_admin_all on public.hacklanta_floors for all
  to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy hacklanta_rooms_admin_all on public.hacklanta_rooms for all
  to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy hacklanta_sessions_admin_all on public.hacklanta_sessions for all
  to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

revoke insert, update, delete, truncate on public.hacklanta_editions, public.hacklanta_floors,
  public.hacklanta_rooms, public.hacklanta_sessions from anon;

-- Admin writes are audited by trigger so every path (page, SQL editor via
-- an admin JWT) leaves a trail with the real actor.
create or replace function public.audit_hacklanta_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor_user_id, target_user_id, action, metadata)
  values (
    auth.uid(), null,
    'hacklanta.' || tg_table_name || '.' || lower(tg_op),
    jsonb_build_object(
      'before', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      'after',  case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    )
  );
  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_hacklanta_change() from public, anon, authenticated;

create trigger hacklanta_editions_audit after insert or update or delete on public.hacklanta_editions
  for each row execute function public.audit_hacklanta_change();
create trigger hacklanta_floors_audit after insert or update or delete on public.hacklanta_floors
  for each row execute function public.audit_hacklanta_change();
create trigger hacklanta_rooms_audit after insert or update or delete on public.hacklanta_rooms
  for each row execute function public.audit_hacklanta_change();
create trigger hacklanta_sessions_audit after insert or update or delete on public.hacklanta_sessions
  for each row execute function public.audit_hacklanta_change();

-- No seed rows: scripts/import-hacklanta-schedule.ts creates the edition and
-- sessions (unpublished unless run with --publish).

-- ============================================================================
-- session_bookmarks — self-editable by design (personal agenda only).
-- ============================================================================
create table public.session_bookmarks (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  session_id  uuid not null references public.hacklanta_sessions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint session_bookmarks_pk primary key (user_id, session_id)
);

alter table public.session_bookmarks enable row level security;

create policy session_bookmarks_select_own on public.session_bookmarks for select
  to authenticated using (auth.uid() = user_id);
create policy session_bookmarks_insert_own on public.session_bookmarks for insert
  to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.hacklanta_sessions s
       where s.id = session_id and public.hacklanta_edition_is_published(s.edition_id)
    )
  );
create policy session_bookmarks_delete_own on public.session_bookmarks for delete
  to authenticated using (auth.uid() = user_id);

revoke update, truncate on public.session_bookmarks from anon, authenticated;
revoke all on public.session_bookmarks from anon;

-- ============================================================================
-- Hacklanta application links (application lives in the Hacklanta project).
-- Written only by the service-role helpers below, called from server code
-- after the emailed OTP is proven.
-- ============================================================================
create table public.hacklanta_links (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  application_id  uuid not null unique,
  email           citext not null,
  linked_at       timestamptz not null default now()
);

alter table public.hacklanta_links enable row level security;
create policy hacklanta_links_select_own on public.hacklanta_links for select
  to authenticated using (auth.uid() = user_id);
create policy hacklanta_links_select_admin on public.hacklanta_links for select
  to authenticated using (public.is_admin(auth.uid()));
revoke insert, update, delete, truncate on public.hacklanta_links from anon, authenticated;

create table public.hacklanta_link_codes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  email           citext not null,
  application_id  uuid,
  code_hash       text not null,
  expires_at      timestamptz not null,
  attempts        int not null default 0,
  max_attempts    int not null default 5,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index hacklanta_link_codes_user_idx on public.hacklanta_link_codes (user_id, created_at desc)
  where consumed_at is null;

alter table public.hacklanta_link_codes enable row level security;
revoke all on public.hacklanta_link_codes from anon, authenticated;

-- p_application_id null = no application matched that email. A code row is
-- still written (and the route answers identically) so the start endpoint
-- can't be used to test which emails applied; that code can never verify.
create or replace function public.hacklanta_link_code_create(
  p_user_id        uuid,
  p_email          citext,
  p_application_id uuid,
  p_code           text,
  p_ttl_minutes    int default 10
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60)));
begin
  if p_code !~ '^[0-9]{6}$' then
    raise exception 'hacklanta_link_code_create: bad code shape' using errcode = 'P0001';
  end if;
  update public.hacklanta_link_codes
     set consumed_at = now()
   where user_id = p_user_id and consumed_at is null;

  insert into public.hacklanta_link_codes (user_id, email, application_id, code_hash, expires_at)
  values (p_user_id, lower(p_email::text)::citext, p_application_id,
          extensions.crypt(p_code, extensions.gen_salt('bf', 8)), v_expires);

  perform public.write_audit(
    'hacklanta.link_code_sent', p_user_id, p_user_id,
    jsonb_build_object('matched', p_application_id is not null)
  );
  return v_expires;
end;
$$;

revoke all on function public.hacklanta_link_code_create(uuid, citext, uuid, text, int) from public, anon, authenticated;
grant  execute on function public.hacklanta_link_code_create(uuid, citext, uuid, text, int) to service_role;

-- Returns: linked | invalid | expired | locked | no_code | taken
create or replace function public.hacklanta_link_code_verify(p_user_id uuid, p_code text)
returns table (status text, application_id uuid, attempts_remaining int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  record;
  v_rows int;
begin
  select c.* into v_row
    from public.hacklanta_link_codes c
   where c.user_id = p_user_id and c.consumed_at is null
   order by c.created_at desc
   limit 1
   for update;

  if v_row.id is null then
    return query select 'no_code', null::uuid, 0;
    return;
  end if;
  if v_row.expires_at < now() then
    update public.hacklanta_link_codes set consumed_at = now() where id = v_row.id;
    return query select 'expired', null::uuid, 0;
    return;
  end if;
  if v_row.attempts >= v_row.max_attempts then
    return query select 'locked', null::uuid, 0;
    return;
  end if;

  if coalesce(p_code, '') !~ '^[0-9]{6}$'
     or extensions.crypt(p_code, v_row.code_hash) <> v_row.code_hash
     or v_row.application_id is null then
    update public.hacklanta_link_codes set attempts = attempts + 1 where id = v_row.id;
    return query select 'invalid', null::uuid, greatest(0, v_row.max_attempts - v_row.attempts - 1);
    return;
  end if;

  update public.hacklanta_link_codes set consumed_at = now() where id = v_row.id;

  if exists (
    select 1 from public.hacklanta_links l
     where l.application_id = v_row.application_id and l.user_id <> p_user_id
  ) then
    perform public.write_audit('hacklanta.link_taken', p_user_id, p_user_id,
      jsonb_build_object('application_id', v_row.application_id));
    return query select 'taken', null::uuid, 0;
    return;
  end if;

  insert into public.hacklanta_links (user_id, application_id, email)
  values (p_user_id, v_row.application_id, v_row.email)
  on conflict (user_id) do update
    set application_id = excluded.application_id,
        email          = excluded.email,
        linked_at      = now();
  get diagnostics v_rows = row_count;

  perform public.write_audit('hacklanta.linked', p_user_id, p_user_id,
    jsonb_build_object('application_id', v_row.application_id));

  return query select 'linked', v_row.application_id, 0;
end;
$$;

revoke all on function public.hacklanta_link_code_verify(uuid, text) from public, anon, authenticated;
grant  execute on function public.hacklanta_link_code_verify(uuid, text) to service_role;

-- ============================================================================
-- Storage: floor plan images (public read; admin write).
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hacklanta-floors', 'hacklanta-floors', true, 5 * 1024 * 1024,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy hacklanta_floors_storage_admin_insert on storage.objects for insert
  to authenticated
  with check (bucket_id = 'hacklanta-floors' and public.is_admin(auth.uid()));
create policy hacklanta_floors_storage_admin_update on storage.objects for update
  to authenticated
  using (bucket_id = 'hacklanta-floors' and public.is_admin(auth.uid()))
  with check (bucket_id = 'hacklanta-floors' and public.is_admin(auth.uid()));
create policy hacklanta_floors_storage_admin_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'hacklanta-floors' and public.is_admin(auth.uid()));

grant select on public.hacklanta_editions, public.hacklanta_floors,
  public.hacklanta_rooms, public.hacklanta_sessions to anon;
grant select, insert, update, delete on public.hacklanta_editions, public.hacklanta_floors,
  public.hacklanta_rooms, public.hacklanta_sessions to authenticated;
grant all on public.hacklanta_editions, public.hacklanta_floors,
  public.hacklanta_rooms, public.hacklanta_sessions to service_role;
grant select, insert, delete on public.session_bookmarks to authenticated;
grant all on public.session_bookmarks to service_role;
grant select on public.hacklanta_links to authenticated;
grant all on public.hacklanta_links, public.hacklanta_link_codes to service_role;
