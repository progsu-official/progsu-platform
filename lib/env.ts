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
