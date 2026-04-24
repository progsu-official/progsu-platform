import { test, expect } from "../fixtures";
import { adminClient, signInAndInjectCookies, SUPABASE_URL, SUPABASE_ANON_KEY } from "../helpers/session";

// Low-friction signup happy path (docs/14-low-friction-signup/06 §2).
// Seeds a freshly-created user with NO profile + NO consents, drives them
// through the minimal funnel, and verifies the dashboard renders the
// profile-completion ring at the expected count.

test("minimal signup: profile → consent → dashboard shows ring", async ({
  browser,
  suffix,
}) => {
  // Non-trivial: compiles /onboarding/profile + /onboarding/consent + /dashboard
  // cold in one pass. 60s global should cover it, but slow() gives headroom.
  test.slow();

  const admin = adminClient();
  const email = `low-friction-${suffix}@example.com`;
  const password = "e2e-testpassword-12345";

  // Seed a bare user — no profile fields, no consents, no resume.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`seed: ${createErr?.message ?? "no user"}`);
  }
  const userId = created.user.id;

  try {
    const context = await browser.newContext();
    await signInAndInjectCookies(context, email, password);
    const page = await context.newPage();

    // --- Step 1: minimal profile form ------------------------------------
    await page.goto("/onboarding/profile");
    await expect(
      page.getByRole("heading", { name: /your profile/i }).first()
    ).toBeVisible();

    // The Field/Label component doesn't set htmlFor, so labels aren't
    // programmatically associated — use positional role selectors. The
    // onboarding profile form renders inputs in a stable order:
    //   [first name, last name, phone, school, major].
    const textboxes = page.getByRole("textbox");
    await textboxes.nth(0).fill("Lowfric");
    await textboxes.nth(1).fill("Tester");
    await textboxes.nth(2).fill("404-555-0123");

    // Two selects on the page: school (first), major (second).
    const selects = page.locator("select");
    await selects.nth(0).selectOption("Georgia State University");
    await selects.nth(1).selectOption("computer_science");

    await page.getByRole("button", { name: /save and continue/i }).click();

    // --- Step 2: consents ------------------------------------------------
    // The profile server action + router.push can take > 5s on a cold compile.
    await page.waitForURL(/\/onboarding\/consent/, { timeout: 30_000 });

    // Accept the three required consents. The form uses checkbox inputs —
    // their labels come from /privacy copy but we only need the three that
    // block onboarding.
    for (const label of [/privacy/i, /terms/i, /18 or older/i]) {
      await page.getByLabel(label).first().check();
    }
    await page
      .getByRole("button", { name: /save|accept|continue/i })
      .first()
      .click();

    // --- Step 3: land on dashboard with the ring -------------------------
    // Consent posts to /onboarding/done first, which then client-redirects to
    // /dashboard. Cold /dashboard compile can take > 10s, so give it 45s.
    await page.waitForURL(/\/dashboard/, { timeout: 45_000 });

    // Ring is server-rendered as an SVG with "N/10" text. Fresh user has
    // nothing optional filled: no resume, unverified edu email, no grad
    // info, no roles, no recruiter opt-in, no social links = 0/10.
    const ring = page.locator("svg text", { hasText: /^\d+\/10$/ });
    await expect(ring.first()).toBeVisible();

    // Top CTA is "Upload your resume" for a user with nothing filled — the
    // ring's slot #1 is the first unfinished nudge rendered inline.
    await expect(
      page.getByRole("link", { name: /upload your resume/i }).first()
    ).toBeVisible();

    await context.close();
  } finally {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
});

// Silence unused imports until we need them — keeps the helper types
// referenceable without TypeScript complaining.
void SUPABASE_URL;
void SUPABASE_ANON_KEY;
