-- Migration — cut the shared per-event check-in code (D5), superseded by
-- QR check-in (D12) as the primary path + admin_check_in_member's roster
-- search as the fallback, matching Luma's actual pattern (QR scan + staff
-- name search, not a typed shared code, confirmed against their real docs).
-- See docs/09-events-platform-plan.md D5/D12 and SCOPE.md.

drop function if exists public.self_check_in(uuid, text);
drop function if exists public.rotate_check_in_code_with_raw(uuid, text, timestamptz);

alter table public.events drop column if exists check_in_code_hash;
alter table public.events drop column if exists check_in_code_expires_at;

-- attendance_method_t keeps 'self_code' as a value: Postgres can't drop an
-- enum value without recreating the type, and it's cheap, harmless residue
-- now that nothing can produce it going forward.
