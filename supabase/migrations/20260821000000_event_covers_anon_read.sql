-- Gap found 2026-08-21 while testing a real prod event's cover image: the
-- 2026-08-20 RSVP-first decision made event pages public, but the
-- `event-covers` storage bucket only ever got authenticated-role read
-- policies (event_covers_select_admin, event_covers_select_member). Anon
-- visitors could never resolve a signed URL for a cover image on any public
-- event page — silently fell back to the gradient placeholder, not an error.
--
-- Mirrors event_covers_select_member exactly, just for `anon`. can_view_event()
-- already returns the correct answer for a null user_id (verified earlier for
-- public_event_by_slug()) — draft/archived/private_invite/cancelled-without-
-- attendance all correctly return false, published+members-visibility
-- returns true. Widening its execute grant to anon is the same narrow
-- widening pattern already used for public_event_by_slug()/
-- public_upcoming_events(), not a new posture.

grant execute on function public.can_view_event(uuid, uuid) to anon;

drop policy if exists event_covers_select_anon on storage.objects;
create policy event_covers_select_anon
  on storage.objects for select
  to anon
  using (
    bucket_id = 'event-covers'
    and public.can_view_event(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );
