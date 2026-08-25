// The referral attribution cookie.
//
// Plain module, no "use server": the /r/<slug> route handler, the RSVP server
// actions and /auth/callback all need these, and a "use server" file may only
// export async functions. Same shape as guest-claim.ts, for the same reason.
//
// Set by the /r/<slug> redirect, read wherever a conversion can happen, and
// never sent to the browser as anything but an opaque string. It holds a
// campaign slug — which is public, printed on a flyer — plus flags marking
// what this browser has already been counted for. No identity, matching the
// no-user-column rule the hits table enforces (migration 20260824150000).
//
// Last touch wins: clicking a second link overwrites the first. That is the
// honest default for "which push got them here", and it means the flags reset
// with the slug they belong to.

export const REFERRAL_COOKIE = "progsu_ref";

// Long enough to survive "I'll look at this tonight" and a semester's worth of
// posters staying up; short enough that a shared lab machine isn't still
// attributing RSVPs to a spring campaign in the fall.
export const REFERRAL_TTL_SECONDS = 30 * 24 * 60 * 60;

/** What this browser has already been counted for on the current slug. */
export type ReferralFlag = "rsvp" | "signup";

const FLAG_CHARS: Record<ReferralFlag, string> = { rsvp: "r", signup: "s" };

export type ReferralCookie = {
  slug: string;
  counted: ReferralFlag[];
};

/**
 * Parses `<slug>` or `<slug>|<flags>`. Returns null for anything malformed —
 * a cookie we can't read is treated as no attribution rather than an error,
 * since it can only ever cost us a stat.
 */
export function parseReferralCookie(raw: string | undefined): ReferralCookie | null {
  if (!raw) return null;

  const [slug, flags = ""] = raw.split("|", 2);
  // Same shape the DB check constraint enforces, so a hand-edited cookie can't
  // send a junk string into record_referral_conversion.
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return null;

  const counted = (Object.keys(FLAG_CHARS) as ReferralFlag[]).filter((f) =>
    flags.includes(FLAG_CHARS[f])
  );
  return { slug, counted };
}

export function serializeReferralCookie(cookie: ReferralCookie): string {
  const flags = cookie.counted.map((f) => FLAG_CHARS[f]).join("");
  return flags ? `${cookie.slug}|${flags}` : cookie.slug;
}

export function withCounted(
  cookie: ReferralCookie,
  flag: ReferralFlag
): ReferralCookie {
  if (cookie.counted.includes(flag)) return cookie;
  return { ...cookie, counted: [...cookie.counted, flag] };
}

/** Path a campaign link is printed as. */
export function referralPath(slug: string): string {
  return `/r/${slug}`;
}
