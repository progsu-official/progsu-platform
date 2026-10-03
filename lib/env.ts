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

  // Campaign links (/r/<slug> + the Links tab on an event). Off closes the
  // redirect route and hides the tab; existing links stop resolving and send
  // visitors to /events, which is the correct behaviour for a kill switch on
  // a surface strangers reach from a printed flyer.
  FEATURE_REFERRAL_LINKS: parseBool(process.env.FEATURE_REFERRAL_LINKS),

  // Discord RSVP announcements. Off is the shipped default and must stay off
  // until the privacy_policy v7 re-acceptance cascade has run — this posts
  // member names into a channel the whole server reads, which is exactly the
  // peer-visible surface CLAUDE.md hard rule #8 covers. Turning it off stops
  // every post; the notifier checks this before it reads anything.
  FEATURE_DISCORD_RSVP_ALERTS: parseBool(
    process.env.FEATURE_DISCORD_RSVP_ALERTS
  ),

  // The daily recap is a separate flag on purpose. It counts RSVPs and never
  // names one, so it is not a peer-visible surface and does not wait on the
  // v7 cascade — it can run today while the per-RSVP alert above stays off.
  FEATURE_DISCORD_RECAP: parseBool(process.env.FEATURE_DISCORD_RECAP),

  // SMS broadcasts (/admin/sms and the delivery worker). Off hides the page
  // and stops the worker between batches, so queued texts wait rather than
  // go. The STOP webhook is deliberately not behind this flag: turning
  // sending off must never turn opt-out capture off.
  FEATURE_SMS: parseBool(process.env.FEATURE_SMS),

  // 30-minute SMS reminders for RSVP'd, opted-in attendees. Ships on whenever
  // FEATURE_SMS is on; this is the switch to pull them alone without also
  // stopping officer broadcasts. Per-event opt-out is events.send_sms_reminder.
  FEATURE_SMS_EVENT_REMINDERS: parseBoolDefaultTrue(
    process.env.FEATURE_SMS_EVENT_REMINDERS
  ),

  // Native iOS app API (/api/mobile/v1/**). Route-edge kill switch: off makes
  // every mobile route answer 404 feature_off before any auth work runs.
  FEATURE_MOBILE_API: parseBool(process.env.FEATURE_MOBILE_API),

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

export function requireTeamFinderSyncSecret(): string {
  return required(
    "TEAM_FINDER_SYNC_SECRET",
    process.env.TEAM_FINDER_SYNC_SECRET
  );
}

// Sending authenticates with an API key (SK...), not the account's auth
// token, so the key can be rotated or revoked without touching the account.
// The Account SID still goes in the request path.
export function requireTwilioSendConfig() {
  return {
    accountSid: required("TWILIO_ACCOUNT_SID", process.env.TWILIO_ACCOUNT_SID),
    apiKeySid: required("TWILIO_API_KEY_SID", process.env.TWILIO_API_KEY_SID),
    apiKeySecret: required(
      "TWILIO_API_KEY_SECRET",
      process.env.TWILIO_API_KEY_SECRET
    ),
    messagingServiceSid: required(
      "TWILIO_MESSAGING_SERVICE_SID",
      process.env.TWILIO_MESSAGING_SERVICE_SID
    ),
  };
}

// Read access to the Hacklanta II database, for the SMS audience sync.
export function requireHacklantaSource() {
  return {
    url: required("HACKLANTA_SUPABASE_URL", process.env.HACKLANTA_SUPABASE_URL),
    secretKey: required(
      "HACKLANTA_SUPABASE_SECRET_KEY",
      process.env.HACKLANTA_SUPABASE_SECRET_KEY
    ),
  };
}

// Twilio signs webhooks with the account auth token and nothing else; an API
// key secret cannot verify X-Twilio-Signature.
export function requireTwilioAuthToken(): string {
  return required("TWILIO_AUTH_TOKEN", process.env.TWILIO_AUTH_TOKEN);
}

export function requireStaffCheckinToken(): string {
  return required("STAFF_CHECKIN_TOKEN", process.env.STAFF_CHECKIN_TOKEN);
}

export function requireWalletWalletApiKey(): string {
  return required("WALLETWALLET_API_KEY", process.env.WALLETWALLET_API_KEY);
}

function optional(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

// PEM values arrive from Vercel env with literal "\n" sequences.
function pem(value: string | undefined): string | null {
  const v = optional(value);
  return v ? v.replace(/\\n/g, "\n") : null;
}

// Optional integrations for the mobile API. Each getter returns null when any
// piece is missing so callers can no-op (push) or answer 503 (Wallet, Apple).
export function apnsConfig() {
  const keyId = optional(process.env.APNS_KEY_ID);
  const teamId = optional(process.env.APNS_TEAM_ID);
  const privateKey = pem(process.env.APNS_PRIVATE_KEY);
  const bundleId = optional(process.env.APNS_BUNDLE_ID);
  if (!keyId || !teamId || !privateKey || !bundleId) return null;
  return { keyId, teamId, privateKey, bundleId };
}

export function appleSignInConfig() {
  const teamId = optional(process.env.APPLE_TEAM_ID);
  const keyId = optional(process.env.APPLE_KEY_ID);
  const privateKey = pem(process.env.APPLE_PRIVATE_KEY);
  // Native Sign in with Apple: the app's bundle id. Web flow: the Services ID.
  const clientId = optional(process.env.APPLE_SERVICES_ID);
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return { teamId, keyId, privateKey, clientId };
}

export function walletConfig() {
  const passTypeId = optional(process.env.PASS_TYPE_ID);
  const teamId = optional(process.env.PASS_TEAM_ID);
  const signerCert = pem(process.env.PASS_SIGNER_CERT);
  const signerKey = pem(process.env.PASS_SIGNER_KEY);
  const wwdr = pem(process.env.PASS_WWDR_CERT);
  if (!passTypeId || !teamId || !signerCert || !signerKey || !wwdr) return null;
  return {
    passTypeId,
    teamId,
    signerCert,
    signerKey,
    signerKeyPassphrase: optional(process.env.PASS_SIGNER_KEY_PASSPHRASE) ?? undefined,
    wwdr,
  };
}

// 32 bytes, base64. Used for AES-256-GCM of stored provider tokens.
export function appEncryptionKey(): Buffer | null {
  const v = optional(process.env.APP_ENCRYPTION_KEY);
  if (!v) return null;
  const key = Buffer.from(v, "base64");
  return key.length === 32 ? key : null;
}
