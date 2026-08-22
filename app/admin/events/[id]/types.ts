import type { EventVisibility } from "@/lib/actions/event-schemas";

export type EventStatus =
  | "draft"
  | "published"
  | "cancelled"
  | "archived";

export type EventHost = {
  display_name: string;
  profile_id: string | null;
  sort_order: number;
};

export type EventRecord = {
  id: string;
  slug: string;
  title: string;
  description_md: string | null;
  status: EventStatus;
  visibility: EventVisibility;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  location_url: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  is_sensitive: boolean;
  cover_image_path: string | null;
  send_rsvp_email: boolean;
  send_reminder_email: boolean;
  reminder_sent_at: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  hosts: EventHost[];
  // Null for live/platform-created events. Set for events backfilled from
  // pre-platform data sources (see historical_event_attendances).
  import_source: string | null;
};

export type RosterRsvpStatus =
  | "going"
  | "waitlisted"
  | "declined"
  | "cancelled"
  | null;

// Guest RSVP (2026-08-21 decision) — account-free, no user_id/profile.
export type GuestRsvpStatus = "going" | "waitlisted" | "cancelled";

export type GuestRsvpRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: GuestRsvpStatus;
  waitlisted_at: string | null;
  created_at: string;
};

export type RosterRow = {
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  google_email: string | null;
  student_email: string | null;
  rsvp_status: RosterRsvpStatus;
  rsvp_comment: string | null;
  rsvp_changed_at: string | null;
  waitlisted_at: string | null;
  waitlist_position: number | null;
  attended: boolean;
  checked_in_at: string | null;
  checked_in_by: string | null;
  attendance_method: string | null;
  invited: boolean;
  invited_by: string | null;
  invited_at: string | null;
  // Imported from a pre-platform source (see historical_event_attendances),
  // identified by legacy_members instead of a profiles row. Promote/check-in/
  // remove actions don't apply — those RPCs FK into profiles.
  is_historical: boolean;
  legacy_member_id: string | null;
  legacy_email: string | null;
};
