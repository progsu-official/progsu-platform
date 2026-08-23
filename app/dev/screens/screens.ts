// One list, used by the index, the prev/next bar, and the routes themselves,
// so a screen can never appear in the nav and 404, or exist and be unlinkable.
export type Screen = {
  slug: string;
  label: string;
  group: "Post-RSVP" | "Onboarding" | "Guest RSVP";
  note: string;
};

export const SCREENS: Screen[] = [
  {
    slug: "guest-modal",
    label: "RSVP form",
    group: "Guest RSVP",
    note: "Full name, school email, phone, SMS opt-in.",
  },
  {
    slug: "guest-modal-collision",
    label: "Already a member",
    group: "Guest RSVP",
    note: "What you hit when the email or phone is on an account.",
  },
  {
    slug: "joined-landed",
    label: "You're in",
    group: "Post-RSVP",
    note: "First beat. Holds ~1.5s, then fades.",
  },
  {
    slug: "joined-ask",
    label: "Almost there",
    group: "Post-RSVP",
    note: "Second beat. The only decision on the page.",
  },
  {
    slug: "joined-waitlisted",
    label: "Waitlisted variant",
    group: "Post-RSVP",
    note: "Same two beats, different copy.",
  },
  {
    slug: "verify-email",
    label: "Verify email",
    group: "Onboarding",
    note: "First screen after OAuth. Skippable.",
  },
  {
    slug: "verify-email-verified",
    label: "Already verified",
    group: "Onboarding",
    note: "Return visit with an address on file.",
  },
  {
    slug: "profile",
    label: "Your name",
    group: "Onboarding",
    note: "Ghost-input name step. Details follow behind a seam.",
  },
  {
    slug: "profile-returning",
    label: "Name step, pre-filled",
    group: "Onboarding",
    note: "Legacy match banner + carried-over values.",
  },
  {
    slug: "links",
    label: "What are you into?",
    group: "Onboarding",
    note: "Optional links collapsed behind a disclosure.",
  },
  {
    slug: "resume",
    label: "Resume",
    group: "Onboarding",
    note: "Empty state.",
  },
  {
    slug: "resume-existing",
    label: "Resume, on file",
    group: "Onboarding",
    note: "With a previous upload.",
  },
  {
    slug: "consent",
    label: "Consent",
    group: "Onboarding",
    note: "Three required, three optional.",
  },
  {
    slug: "consent-no-phone",
    label: "Consent, no phone",
    group: "Onboarding",
    note: "SMS row disabled with a reason.",
  },
  {
    slug: "done",
    label: "Done",
    group: "Onboarding",
    note: "Last beat.",
  },
];

export function screenAt(slug: string) {
  const i = SCREENS.findIndex((s) => s.slug === slug);
  if (i < 0) return null;
  return { screen: SCREENS[i], prev: SCREENS[i - 1] ?? null, next: SCREENS[i + 1] ?? null };
}
