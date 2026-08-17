# SCOPE.md

## The one thing
A member's confirmed RSVP renders a personal QR code; staff scan it from the existing admin check-in screen to check them in, a second entry path alongside the existing shared per-event code, not a replacement.

## Non-goals
- No new table or "ticket" object, reuses `event_rsvps.checkin_token` + `event_attendances` exactly as scoped in `docs/09-events-platform-plan.md` §7.5 (D12)
- No native scanner app, no offline/kiosk mode, browser camera scan from the existing admin check-in screen
- No wallet passes (Apple/Google Wallet)
- No staff permission tiering, multi-ticket handling, or restrict-ticket-types, single ticket type per event assumed
- No email delivery of the QR for now (site-only); the existing RSVP confirmation email is untouched
- Doesn't touch or replace the D5 shared-code check-in path, that stays as-is, fully working fallback

## Done looks like
From `/admin/events/[id]/check-in`, staff can scan a guest's personal QR and see one of three outcomes: checked in, already checked in, or invalid. Writes `event_attendances` with `method='qr_token'`, shows up in the existing roster same as any other check-in method. Verified locally via `supabase db reset` + a smoke script, not just typecheck.
