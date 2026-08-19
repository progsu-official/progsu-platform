-- Migration — avatar uploads: 'avatars' storage bucket + policies.
--
-- Lets members replace the Google OAuth avatar (which intermittently 429s
-- when hotlinked, and which legacy rows can point at dead versions of) with
-- an uploaded photo. profiles.avatar_url already exists and is self-updatable
-- via profiles_update_own; this migration only adds the storage side.
--
-- Bucket is public-read: avatar URLs were already publicly fetchable when
-- they lived on lh3.googleusercontent.com, and object names are
-- {user_id}/{uuid}.{ext} so they are not enumerable.
-- Path convention: {user_id}/{random-uuid}.{jpg|png|webp}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owners can insert objects under their own prefix.
drop policy if exists avatars_storage_insert_own on storage.objects;
create policy avatars_storage_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners can delete their own objects (used when replacing or removing).
drop policy if exists avatars_storage_delete_own on storage.objects;
create policy avatars_storage_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
