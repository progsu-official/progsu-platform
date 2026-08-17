# 05 — QR check-in v2: wallet passes + scan modes

**Status**: Stub. Not spec'd in implementation detail, captured for future reference.
**Priority**: None assigned. v1 QR check-in (D12, `docs/09-events-platform-plan.md` §7.5) is additive and complete on its own; nothing here blocks it.
**Deferred from**: v1 QR check-in scoping (`SCOPE.md`, 2026-08-16), which explicitly cut these to ship the smallest working loop first. Source of the reference model: [Check In Guests for In-Person Events · Luma Help](https://help.luma.com/p/check-in).

## Why these two specifically

Luma's real check-in product has more surface area than v1 shipped. Two pieces are worth a real look later, not because v1 is broken, but because they're genuine UX upgrades once the core loop is proven:

1. **Wallet passes (Apple Wallet / Google Wallet)** — per Luma's docs, a guest can add their ticket to a wallet app and it "works even if the guest doesn't have the [app] or an internet connection." v1's QR only lives on the `/events/[slug]` page, which requires being online and signed in to view. A wallet pass survives phone-locked, offline, low-signal door lines, exactly the scenario Progsu events actually happen in (packed rooms, spotty campus wifi).
2. **Scan modes (Standard vs. Express)** — Luma's admin scanner has two modes: Standard opens guest details and requires a tap to confirm (review-before-commit); Express auto-confirms on scan with color-coded feedback, built for high-volume doors. v1's `QrScanner` only does the Express-style auto-confirm behavior. A Standard mode (show the resolved attendee's name before committing) is a real safety net against scanning the wrong badge in a crowded line, currently there's no confirmation step at all between "camera reads a QR" and "row gets written."

## What v2 would actually touch

**Wallet passes:**
- Apple Wallet: `.pkpass` file generation (a signed zip of JSON + assets), needs an Apple Developer account, a Pass Type ID certificate, and a small signing service, real new infrastructure, not a couple of lines.
- Google Wallet: simpler, REST API + JWT-signed pass object, no separate certificate infra needed.
- Both need a "Add to Wallet" button on the same `/events/[slug]` check-in CTA where the QR already renders, wired to whichever event the `checkin_token` belongs to.
- Non-trivial: neither wallet format is just "put the QR image in a wallet app", they're structured pass objects with their own field schema, and Apple's requires a paid developer account + cert rotation discipline.

**Scan modes:**
- Add a mode toggle to `QrScanner` (`app/admin/events/[id]/check-in/qr-scanner.tsx`), mirroring Luma's toggle.
- Standard mode: on decode, call a new read-only lookup (resolve token → attendee name, no write yet) and render a confirm/reject UI, only calling `admin_check_in_by_token` after the tap. This needs a new RPC (`resolve_check_in_token` or similar, read-only, admin-only, same auth shape as `admin_check_in_by_token` minus the insert) since the current flow couples "resolve" and "write" into one call.
- Express mode: what v1 already does, no change needed, just becomes the second option instead of the only one.
- Optional, matching Luma further: a default-mode setting per event and the ability to lock check-in staff to one mode (`docs/09` doesn't have a staff-permission-tier concept yet at all, this would be new).

## Don't build this until

- v1's actually been used at a real event and someone can point at a concrete pain point (a mis-scan, a signal-dead door line) rather than building both of these speculatively.
- For wallet passes specifically: confirm it's worth the Apple Developer account + cert-signing infra cost before starting, that's real recurring maintenance, not a one-time build.
