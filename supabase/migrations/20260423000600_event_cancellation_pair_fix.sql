-- Migration 000060 — relax events_cancellation_pair so archived events can
-- preserve their cancelled_at timestamp.
--
-- Original constraint in 20260423000100_events_core.sql required
-- (status = 'cancelled') ⇔ (cancelled_at is not null). But archive_event()
-- transitions a cancelled event to 'archived' while leaving cancelled_at
-- populated (history is preserved), which violates the iff. Replace with a
-- unidirectional rule: cancelled_at may only be set when the event has ever
-- been cancelled. Draft and published events must have cancelled_at null.

alter table public.events
  drop constraint if exists events_cancellation_pair;

alter table public.events
  add constraint events_cancellation_pair check (
    (status in ('draft', 'published') and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
    or (status = 'archived')
  );

comment on constraint events_cancellation_pair on public.events is
  'cancelled_at is populated once the event has been cancelled and persists through archival. Draft and published events must have null.';
