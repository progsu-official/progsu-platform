import { z } from "zod";

// Wire contracts for /api/mobile/v1 (docs/ios/API.md). Mirrored by
// ios/Progsu/Progsu/Models/API.swift. No "server-only": smokes import these to
// validate live responses and the fixtures the Swift tests decode.

const iso = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

export const errorEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "unauthenticated",
      "forbidden",
      "not_found",
      "invalid_input",
      "conflict",
      "rate_limited",
      "not_onboarded",
      "feature_off",
      "unavailable",
      "internal",
    ]),
    message: z.string(),
    field: z.string().optional(),
    retryAfterMs: z.number().optional(),
  }),
  requestId: z.string(),
});

export function okEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

export function page<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const affiliation = z.enum(["gsu_student", "other_student", "nonstudent", "unknown"]);

// ---------------------------------------------------------------- config
export const hacklantaSummary = z.object({
  slug: z.string(),
  name: z.string(),
  startsAt: iso,
  endsAt: iso,
  timeZone: z.string(),
  themeOverride: z.enum(["auto", "force_on", "force_off"]),
  themeActive: z.boolean(),
  theme: z.record(z.string(), z.unknown()),
  scheduleTentative: z.boolean(),
});

export const config = z.object({
  minSupportedBuild: z.number().int(),
  features: z.object({
    events: z.boolean(),
    hacklanta: z.boolean(),
    wallet: z.boolean(),
    push: z.boolean(),
    appleRevocation: z.boolean(),
  }),
  hacklanta: hacklantaSummary.nullable(),
});

// ---------------------------------------------------------------- me
export const onboarding = z.object({
  fullyOnboarded: z.boolean(),
  nextStep: z.enum(["verify-email", "profile", "links", "resume", "consent"]).nullable(),
  profileFieldsComplete: z.boolean(),
  requiredConsentsCurrent: z.boolean(),
  studentEmailVerified: z.boolean(),
  hasCurrentResume: z.boolean(),
});

export const me = z.object({
  id: uuid,
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  preferredName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  affiliation,
  institutionName: z.string().nullable(),
  school: z.string().nullable(),
  major: z.string().nullable(),
  majorOtherText: z.string().nullable(),
  studentEmail: z.string().nullable(),
  studentEmailVerified: z.boolean(),
  verifiedGsu: z.boolean(),
  isAdmin: z.boolean(),
  onboarding,
  consentVersions: z.record(z.string(), z.string()),
  staffAssignments: z.array(z.object({ eventId: uuid, expiresAt: iso.nullable() })),
  pointsBalance: z.number().int(),
});

export const updateProfileBody = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    preferredName: z.string().trim().max(100).nullable(),
    affiliation: z.enum(["gsu_student", "other_student", "nonstudent"]),
    institutionName: z.string().trim().max(150).nullable(),
    school: z.string().trim().max(150).nullable(),
    major: z.string().trim().max(100).nullable(),
    majorOtherText: z.string().trim().max(100).nullable(),
    minor: z.string().trim().max(150).nullable(),
    phoneNumber: z.string().trim().min(1).max(40),
  })
  .partial()
  .strict();

export const consentsBody = z.object({
  acceptances: z.record(z.string(), z.boolean()),
});

export const consentsResult = z.object({ recorded: z.array(z.string()) });

export const studentEmailStartBody = z.object({ studentEmail: z.string() }).strict();
export const studentEmailStartResult = z.object({ expiresAt: iso });
export const studentEmailVerifyBody = z
  .object({ studentEmail: z.string(), code: z.string() })
  .strict();
export const studentEmailVerifyResult = z.object({ studentEmail: z.string(), verifiedAt: iso });

export const appleAuthorizationBody = z
  .object({ authorizationCode: z.string().min(10).max(2048) })
  .strict();

export const deleteBody = z.object({ confirm: z.literal("DELETE") }).strict();
export const deleteResult = z.object({ status: z.enum(["completed"]), deletedAt: iso });

// ---------------------------------------------------------------- events
export const rsvpStatus = z.enum(["going", "waitlisted", "declined", "cancelled"]);

export const eventSummary = z.object({
  id: uuid,
  slug: z.string(),
  title: z.string(),
  startsAt: iso,
  endsAt: iso,
  timeZone: z.string(),
  locationText: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  capacity: z.number().int().nullable(),
  goingCount: z.number().int(),
  waitlistEnabled: z.boolean(),
  externalUrl: z.string().nullable(),
  pinned: z.boolean(),
});

export const eventDetail = eventSummary.extend({
  descriptionMd: z.string().nullable(),
  locationUrl: z.string().nullable(),
  waitlistedCount: z.number().int(),
  hosts: z.array(z.object({ displayName: z.string() })),
  status: z.enum(["published", "cancelled", "archived"]),
  viewer: z
    .object({
      rsvpStatus: rsvpStatus.nullable(),
      checkedInAt: iso.nullable(),
      pointsAvailable: z.number().int().nullable(),
      pointsEarned: z.number().int(),
      isStaff: z.boolean(),
    })
    .nullable(),
});

export const rsvpBody = z
  .object({ desired: z.enum(["going", "cancelled"]), comment: z.string().max(500).optional() })
  .strict();
export const rsvpResult = z.object({ effectiveStatus: rsvpStatus });

export const myEvent = z.object({
  event: eventSummary,
  rsvpStatus: rsvpStatus.nullable(),
  checkedInAt: iso.nullable(),
});

export const pass = z.object({
  qrPayload: z.string(),
  shortCode: z.string(),
});

// ---------------------------------------------------------------- points
export const pointEntry = z.object({
  id: uuid,
  amount: z.number().int(),
  kind: z.enum(["award", "reversal", "adjustment"]),
  eventId: uuid.nullable(),
  eventTitle: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: iso,
});
export const points = z.object({
  balance: z.number().int(),
  items: z.array(pointEntry),
  nextCursor: z.string().nullable(),
});

// ---------------------------------------------------------------- announcements
export const announcement = z.object({
  id: uuid,
  title: z.string(),
  body: z.string(),
  audience: z.enum(["all", "event_rsvps", "hacklanta"]),
  eventId: uuid.nullable(),
  priority: z.enum(["normal", "important"]),
  deepLink: z.string().nullable(),
  publishedAt: iso,
  expiresAt: iso.nullable(),
  read: z.boolean().nullable(),
});

export const deviceBody = z
  .object({
    token: z.string().regex(/^[0-9a-fA-F]{32,200}$/, "Invalid device token"),
    env: z.enum(["sandbox", "production"]),
  })
  .strict();

// ---------------------------------------------------------------- hacklanta
export const hacklantaGuide = z.object({
  edition: hacklantaSummary.extend({
    venueName: z.string().nullable(),
    venueAddress: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    publishedAt: iso,
  }),
  floors: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      sort: z.number().int(),
      imageUrl: z.string().nullable(),
      version: z.number().int(),
    })
  ),
  rooms: z.array(
    z.object({
      id: uuid,
      floorId: uuid.nullable(),
      name: z.string(),
      kind: z.string(),
      description: z.string().nullable(),
      x: z.number().nullable(),
      y: z.number().nullable(),
    })
  ),
  sessions: z.array(
    z.object({
      id: uuid,
      key: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      kind: z.string(),
      track: z.string().nullable(),
      roomId: uuid.nullable(),
      roomLabel: z.string().nullable(),
      startsAt: iso,
      endsAt: iso.nullable(),
      status: z.enum(["scheduled", "cancelled", "moved"]),
      pointsNote: z.string().nullable(),
      updatedAt: iso,
    })
  ),
});

export const bookmarks = z.object({ sessionIds: z.array(uuid) });

export const hacklantaMe = z.object({
  linked: z.boolean(),
  application: z
    .object({
      status: z.enum(["pending", "accepted", "waitlisted", "rejected"]),
      attendanceConfirmed: z.boolean(),
      team: z
        .object({ name: z.string().nullable(), memberFirstNames: z.array(z.string()) })
        .nullable(),
    })
    .nullable(),
});

export const linkStartBody = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
export const linkStartResult = z.object({ expiresAt: iso });
export const linkVerifyBody = z.object({ code: z.string().regex(/^[0-9]{6}$/, "Enter the 6-digit code") }).strict();
export const linkVerifyResult = z.object({ linked: z.literal(true) });

// ---------------------------------------------------------------- staff
export const staffEvent = z.object({
  id: uuid,
  slug: z.string(),
  title: z.string(),
  startsAt: iso,
  endsAt: iso,
  status: z.string(),
  assignmentExpiresAt: iso.nullable(),
  goingCount: z.number().int(),
  checkedInCount: z.number().int(),
});

export const scanResultCode = z.enum([
  "checked_in",
  "already_checked_in",
  "wrong_event",
  "revoked",
  "not_rsvpd",
  "outside_window",
  "invalid_code",
]);

export const scanBody = z.object({ code: z.string().trim().min(1).max(200) }).strict();
export const scanResult = z.object({
  result: scanResultCode,
  attendee: z.object({ displayName: z.string(), kind: z.enum(["member", "guest"]) }).nullable(),
  pointsAwarded: z.number().int(),
  checkedInAt: iso.nullable(),
});

export const rosterEntry = z.object({
  userId: uuid,
  displayName: z.string(),
  rsvpStatus: rsvpStatus,
  checkedIn: z.boolean(),
  checkedInAt: iso.nullable(),
});

export const manualCheckinBody = z
  .object({ userId: uuid, reason: z.string().trim().min(3).max(500) })
  .strict();

// ---------------------------------------------------------------- small acks
export const readAck = z.object({ read: z.literal(true) });
export const deviceAck = z.object({ registered: z.literal(true) });
export const deviceRemoveAck = z.object({ removed: z.boolean() });
export const bookmarkAck = z.object({ bookmarked: z.boolean() });
export const appleAuthAck = z.object({ stored: z.boolean() });
