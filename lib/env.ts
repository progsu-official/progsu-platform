function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

// Same as parseBool, but unset means on. Used for kill switches meant to
// ship enabled and only need a flip when a specific section turns out to
// need pulling later.
function parseBoolDefaultTrue(value: string | undefined): boolean {
  if (value === undefined) return true;
  return parseBool(value);
}

export const env = {
  NEXT_PUBLIC_SUPABASE_URL: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ),
  NEXT_PUBLIC_SITE_URL:
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",

  FEATURE_EVENTS: parseBool(process.env.FEATURE_EVENTS),
  FEATURE_MEMBER_DIRECTORY: parseBool(process.env.FEATURE_MEMBER_DIRECTORY),
  FEATURE_SHARED_EVENT_HISTORY: parseBool(
    process.env.FEATURE_SHARED_EVENT_HISTORY
  ),

  // Public member-profile sections (/members/[slug]). Events ships on;
  // resume stays off for now (per John, 2026-08-20) until there's a per-member
  // opt-in — flip FEATURE_PUBLIC_PROFILE_RESUME on later, no code change needed.
  FEATURE_PUBLIC_PROFILE_RESUME: parseBool(
    process.env.FEATURE_PUBLIC_PROFILE_RESUME
  ),
  FEATURE_PUBLIC_PROFILE_EVENTS: parseBoolDefaultTrue(
    process.env.FEATURE_PUBLIC_PROFILE_EVENTS
  ),

  // Dev-only onboarding walkthrough: forms come pre-filled with dummy values,
  // no OTP email is sent, the code is always 000000, and OTP rate limits are
  // skipped. Hard-gated on NODE_ENV like DEV_AUTO_LOGIN so it can never be
  // active on a real deployment regardless of the env var.
  ONBOARDING_TEST_MODE:
    parseBool(process.env.ONBOARDING_TEST_MODE) &&
    process.env.NODE_ENV !== "production",
};

export function requireServerEnv() {
  return {
    SUPABASE_SERVICE_ROLE_KEY: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ),
  };
}

export function requireCronSecret(): string {
  return required("CRON_SECRET", process.env.CRON_SECRET);
}

export function requireWalletWalletApiKey(): string {
  return required("WALLETWALLET_API_KEY", process.env.WALLETWALLET_API_KEY);
}
