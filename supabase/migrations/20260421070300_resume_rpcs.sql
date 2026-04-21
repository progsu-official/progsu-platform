-- Migration 000004 — resume lifecycle helpers.
-- set_current_resume flips the current-resume marker atomically. finalize_resume_upload
-- transitions a pending row to active and triggers the flip. prune_orphan_pending_resumes
-- is called by a future cron to clean up rows whose PUT never completed.

create or replace function public.set_current_resume(p_resume_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_owner    uuid;
  v_status   public.resume_status_t;
begin
  if v_uid is null then
    raise exception 'set_current_resume: unauthenticated' using errcode = 'P0001';
  end if;

  select user_id, status into v_owner, v_status
    from public.resumes
   where id = p_resume_id
     for update;

  if v_owner is null then
    raise exception 'set_current_resume: resume % not found', p_resume_id using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception 'set_current_resume: not owner' using errcode = 'P0001';
  end if;
  if v_status <> 'active' then
    raise exception 'set_current_resume: resume is not active (status=%)', v_status using errcode = 'P0001';
  end if;

  -- Demote the current one (if any).
  update public.resumes
     set is_current = false
   where user_id = v_uid and is_current = true and id <> p_resume_id;

  -- Promote the target.
  update public.resumes
     set is_current = true
   where id = p_resume_id;
end;
$$;

revoke all on function public.set_current_resume(uuid) from public;
grant  execute on function public.set_current_resume(uuid) to authenticated, service_role;

-- finalize_resume_upload: caller has uploaded to storage. We trust the server action
-- (which HEADs the object and re-verifies size/mime) and transition the row to active.
create or replace function public.finalize_resume_upload(p_resume_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_status public.resume_status_t;
begin
  if v_uid is null then
    raise exception 'finalize_resume_upload: unauthenticated' using errcode = 'P0001';
  end if;

  select user_id, status into v_owner, v_status
    from public.resumes
   where id = p_resume_id
     for update;

  if v_owner is null then
    raise exception 'finalize_resume_upload: resume % not found', p_resume_id using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception 'finalize_resume_upload: not owner' using errcode = 'P0001';
  end if;
  if v_status <> 'pending' then
    raise exception 'finalize_resume_upload: expected pending, got %', v_status using errcode = 'P0001';
  end if;

  update public.resumes
     set status = 'active'
   where id = p_resume_id;

  perform public.set_current_resume(p_resume_id);
end;
$$;

revoke all on function public.finalize_resume_upload(uuid) from public;
grant  execute on function public.finalize_resume_upload(uuid) to authenticated, service_role;

-- soft_delete_resume: owner removes a non-current resume from history. current row
-- can't be soft-deleted directly (the user uploads a new one to replace instead).
create or replace function public.soft_delete_resume(p_resume_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_is_current boolean;
begin
  if v_uid is null then
    raise exception 'soft_delete_resume: unauthenticated' using errcode = 'P0001';
  end if;

  select user_id, is_current into v_owner, v_is_current
    from public.resumes
   where id = p_resume_id
     for update;

  if v_owner is null then
    raise exception 'soft_delete_resume: not found' using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception 'soft_delete_resume: not owner' using errcode = 'P0001';
  end if;
  if v_is_current then
    raise exception 'soft_delete_resume: cannot delete current resume' using errcode = 'P0001';
  end if;

  update public.resumes
     set status     = 'deleted',
         deleted_at = now()
   where id = p_resume_id;
end;
$$;

revoke all on function public.soft_delete_resume(uuid) from public;
grant  execute on function public.soft_delete_resume(uuid) to authenticated, service_role;

-- prune_orphan_pending_resumes: cron-invoked cleanup. A pending row older than 1h
-- without a storage object is stale; drop it. Callers must be service_role.
create or replace function public.prune_orphan_pending_resumes(p_older_than interval default interval '1 hour')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'prune_orphan_pending_resumes: service_role only' using errcode = 'P0001';
  end if;

  with deleted as (
    delete from public.resumes
     where status = 'pending'
       and uploaded_at < now() - p_older_than
     returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

revoke all on function public.prune_orphan_pending_resumes(interval) from public;
grant  execute on function public.prune_orphan_pending_resumes(interval) to service_role;
