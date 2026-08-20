# 04 — Playwright End-to-End Browser Testing

Status: Planned
Owner: Platform
Target: mid-Phase-B (once R2/R3 dogfooding surfaces the first real UI regression)
Created: 2026-04-22

## 1. Intent — what Playwright catches that smokes don't

Our existing `scripts/smoke-*.ts` suite (~35 files, ~10 of them load-bearing) proves the RPC and RLS surface is correct. Every smoke follows the same shape: a service-role admin seeds users, promotes one, then opens anon clients and calls `rpc()` / table inserts directly. They are fast, deterministic, and uncover DB-layer regressions before they ship. They are also blind to everything the browser does.

Playwright gives us a second layer, targeted at the browser-only class of bug we have already shipped and hot-fixed at least once each:

- `datetime-local` inputs that parse as `Invalid Date` in a non-UTC browser (the admin event form path).
- Signed-URL expiry in the cover-image path (`event-covers` bucket, 60-minute TTL): works on first load, 404s on refresh after the renderer caches the URL past expiry.
- `router.refresh()` stalling because a Server Action returned `{ ok: false }` without throwing.
- Middleware misfire on `/onboarding/consent` after `migration 20260425000200 (privacy_policy_v3)` — DB agreed the consents were stale, but `loadOnboardingState` never ran because a layout short-circuited.
- Client-side form validation (RsvpPanel capacity check, CheckInForm length guard) that silently accepts invalid input because the disabled-state logic flipped.
- Tailwind class purging removing `bg-destructive/10` on a rarely-rendered alert branch.

None of those are reachable from `pnpm tsx scripts/smoke-*.ts`. Playwright opens a real Chromium, follows real redirects, waits on React hydration, and clicks real buttons.

**Playwright supplements smokes; it does not replace them.** Smokes run in ~5 seconds and catch RLS/RPC/migration regressions. Playwright will run in ~2–3 minutes (target) and catch browser regressions. Keep both.

---

## 2. Setup

### 2.1 Install

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium --with-deps
```

Start with **Chromium only**. Firefox and WebKit come at meaningful cost (install time, flake surface, CI minutes) and we do not currently have a Safari/Firefox user reporting bugs we need to reproduce. Revisit if/when we do.

Add to `package.json` scripts:

```jsonc
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:debug": "PWDEBUG=1 playwright test"
  }
}
```

### 2.2 `playwright.config.ts` at the repo root

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"], ["list"]]
    : [["list"], ["html", { open: "on-failure" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3000",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
```

### 2.3 Directory layout

```
tests/
  e2e/
    fixtures.ts
    helpers/
      seed.ts
      session.ts
      email.ts
      cleanup.ts
    scenarios/
      01-admin-creates-and-member-checks-in.spec.ts
      02-capacity-waitlist.spec.ts
      03-private-invite-visibility.spec.ts
      04-cancel-event-fan-out.spec.ts
      05-member-directory.spec.ts
      06-shared-events.spec.ts
      07-onboarding-consent-cascade.spec.ts
    README.md
```

---

## 3. Auth strategy — the critical detail

This is the single hardest thing to get right. Our production login is `signInWithOAuth({ provider: "google" })` and the local `supabase/config.toml` enables the same external provider. Driving that flow from Playwright is **not viable**:

- Google detects headless Chrome and blocks the login screen.
- Even headful, Google's bot heuristics flag the automation.
- 2FA, device checks, and account-review emails inject nondeterminism.
- Shared test accounts get rate-limited and locked within a week.

Three alternatives:

| Option | Verdict |
|---|---|
| (A) Bypass OAuth entirely via Supabase admin API + `signInWithPassword` | **Recommended.** Matches every existing smoke script. Zero external dependencies. |
| (B) Stub the Google redirect behind a local echo endpoint | Fragile; would require conditionally changing `GoogleSignInButton` based on env; high chance of masking real OAuth regressions. |
| (C) Real Google account + stored refresh tokens | Tokens expire, 2FA friction, Google locks shared accounts. |

### 3.1 Why option A is safe

The production `google-sign-in-button.tsx` redirects to Google, Google redirects back to `/auth/callback` with a `code`, and `exchangeCodeForSession` writes `sb-<ref>-auth-token` cookies. Everything downstream of the callback — middleware, `loadOnboardingState`, layouts, server actions — reads only those cookies. **They do not care how the user got them.** If Playwright plants a valid session cookie directly, the rest of the app behaves identically to a user who arrived via Google.

### 3.2 Implementation — `tests/e2e/helpers/session.ts`

```ts
import type { BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function projectRef(): string {
  const host = new URL(SUPABASE_URL).hostname;
  return host.split(".")[0];
}

export async function signInAndInjectCookies(
  context: BrowserContext,
  email: string,
  password: string
): Promise<{ userId: string }> {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw new Error(`signIn ${email}: ${error?.message}`);
  }

  const ref = projectRef();
  const cookieName = `sb-${ref}-auth-token`;

  const value =
    "base64-" +
    Buffer.from(JSON.stringify(data.session)).toString("base64");

  await context.addCookies([
    {
      name: cookieName,
      value,
      url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      httpOnly: true,
      sameSite: "Lax",
      expires: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    },
  ]);

  return { userId: data.user.id };
}

export function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

Implementation notes:

- The cookie *name* format (`sb-<ref>-auth-token`) and the `base64-<b64>` value shape come from `@supabase/ssr@0.10`. If we bump ssr, re-verify via `pnpm dev`, sign in manually, and inspect the cookie jar. Pin this in a comment in `session.ts`.
- Do **not** call `signInWithPassword` from inside the browser context. Call it from the Node side, then inject the result.
- The test user is created by the seed helper with `password: "e2e-testpassword-12345"` and `email_confirm: true`.

### 3.3 Why not sign in on the Login page?

We could add a hidden `/login/test-password` form behind an env flag. We won't — exfiltration risk if the flag ever flips in prod; doesn't test anything we care about beyond the cookie-forwarding logic. Cover the callback path with a dedicated *smoke* test, not an E2E — Playwright can't stub Google either way.

---

## 4. Test fixtures

### 4.1 Shape

`tests/e2e/fixtures.ts` extends the base Playwright `test` with named fixtures that return ready-to-use logged-in pages:

```ts
import { test as base, type Page } from "@playwright/test";
import { adminClient, signInAndInjectCookies } from "./helpers/session";
import { makeFullyOnboardedUser, makeAdminUser, deleteUser } from "./helpers/seed";

type Fixtures = {
  adminPage: Page;
  adminUserId: string;
  memberPage: Page;
  memberUserId: string;
  memberAlicePage: Page;
  memberAliceUserId: string;
  suffix: string;
};

export const test = base.extend<Fixtures>({
  suffix: async ({}, use, testInfo) => {
    const raw = `${Date.now()}-${testInfo.workerIndex}-${testInfo.testId.slice(0, 6)}`;
    await use(raw);
  },

  adminUserId: async ({ suffix }, use) => {
    const { id } = await makeAdminUser(`admin-${suffix}@example.com`);
    await use(id);
    await deleteUser(id);
  },

  adminPage: async ({ browser, suffix, adminUserId }, use) => {
    const email = `admin-${suffix}@example.com`;
    const context = await browser.newContext();
    await signInAndInjectCookies(context, email, "e2e-testpassword-12345");
    const page = await context.newPage();
    await page.goto("/admin");
    await use(page);
    await context.close();
  },

  memberUserId: async ({ suffix }, use) => {
    const { id } = await makeFullyOnboardedUser(`member-${suffix}@example.com`);
    await use(id);
    await deleteUser(id);
  },

  memberPage: async ({ browser, suffix, memberUserId }, use) => {
    const email = `member-${suffix}@example.com`;
    const context = await browser.newContext();
    await signInAndInjectCookies(context, email, "e2e-testpassword-12345");
    const page = await context.newPage();
    await page.goto("/profile");
    await use(page);
    await context.close();
  },

  memberAliceUserId: async ({ suffix }, use) => {
    const { id } = await makeFullyOnboardedUser(`alice-${suffix}@example.com`);
    await use(id);
    await deleteUser(id);
  },

  memberAlicePage: async ({ browser, suffix, memberAliceUserId }, use) => {
    const email = `alice-${suffix}@example.com`;
    const context = await browser.newContext();
    await signInAndInjectCookies(context, email, "e2e-testpassword-12345");
    const page = await context.newPage();
    await page.goto("/profile");
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
```

### 4.2 Seed helpers

`tests/e2e/helpers/seed.ts` deduplicates the "create + promote + fully onboard + consent + resume" pattern currently copy-pasted across smokes. Mirrors the block at `scripts/smoke-event-rsvp.ts:27-87`. The important contract: `makeFullyOnboardedUser()` satisfies `is_fully_onboarded()` — every required profile field set, active current resume row inserted, all required consents at the current `consent_versions` version.

Do not hardcode consent version strings (`v1`, `v2`, etc.). Fetch them from `consent_versions` at call time. Privacy-policy bumps will otherwise silently invalidate every seeded user.

---

## 5. Database reset strategy

Three options:

| Strategy | Speed | Determinism | Verdict |
|---|---|---|---|
| `supabase db reset` before each test | ~8s per test | Perfect | Too slow. |
| Separate schema/database per test | Complex | Perfect | Overkill. |
| **Unique suffix per test, targeted cleanup** | ~0.3s per test | Good enough | **Recommended.** |
| One reset per suite + targeted cleanup between tests | ~8s once + 0.3s/test | Good | CI fallback. |

### 5.1 Recommended approach

- Each test gets a `suffix` fixture (timestamp + workerIndex + testId hash) and threads it into every email, slug, and display name it creates.
- Cleanup lives in fixture teardown (`deleteUser`, `deleteEventsBySuffix`) and runs even on test failure.
- Run `supabase db reset` **once** at the start of the CI job (after `supabase start`) to guarantee a known baseline.
- Locally, developers do not need to reset between runs.

### 5.2 Flakes

If the suite ever produces a flake that bisects to "another test's data polluted me," you have a missing `suffix` somewhere. Grep scenario files for literals (`@example.com`, hardcoded slugs) — every one should route through the `suffix` fixture.

---

## 6. Priority test scenarios

Each scenario below is self-contained: it seeds its own users, does its own cleanup, and does not depend on any other test's state. Order of implementation in §10.

### 6.1 Scenario 1 — Admin creates event → member RSVPs → member checks in → admin sees attendance

Exercises: full happy path, server actions, `router.refresh()`, signed-URL cover rendering, RSVP mutations, check-in form, admin roster view. If this passes, 80% of the platform is functional.

### 6.2 Scenario 2 — Capacity-full waitlist

Exercises RSVP panel's capacity/waitlist branch and admin waitlist-promotion UI. Create cap=2 event, three members RSVP, third lands on waitlist with position shown, admin promotes.

### 6.3 Scenario 3 — Private-invite visibility

Invitee gets the page; non-invitee gets a 404 status. Next App Router returns 404 when `notFound()` is thrown server-side (verified in `app/events/[slug]/page.tsx:60`).

### 6.4 Scenario 4 — Cancel event fan-out

Two members RSVP'd, admin cancels with reason, both receive a cancellation email. Verify via log transport: `lib/email/resend.ts` already logs every send in dev (absence of `RESEND_API_KEY`). The `waitForEmailLog` helper reads the Next dev server's stdout buffer (exposed by Playwright's `webServer.stdout: "pipe"`) and pattern-matches the `[email:log]` lines.

### 6.5 Scenario 5 — R2 member directory

Two members opt into `/members`, each sees the other's card. Matches `scripts/smoke-member-cards-visibility.ts` contract.

### 6.6 Scenario 6 — R3 shared events

Two members attend same event with mutual share_shared_event_counts=true, each sees the event in their profile's "Shared events" section.

**Threshold coupling.** `SHARED_EVENT_MIN_ATTENDEES = 2` today (dogfood). When item 01 raises it to 10 for public launch, this scenario needs seeding 10+ attendees. Leave a `// TODO threshold-sensitive` comment.

### 6.7 Scenario 7 — Onboarding consent cascade re-acceptance

Privacy version bump pushes user to `/onboarding/consent`.

```ts
test("privacy_policy version bump pushes user to /onboarding/consent", async ({
  memberPage,
  memberUserId,
}) => {
  await memberPage.goto("/profile");
  await expect(memberPage.getByRole("heading", { name: /profile/i })).toBeVisible();

  const admin = adminClient();
  const newVersion = `v${Date.now()}`;
  await admin.from("consent_versions").update({ version: newVersion }).eq("consent_type", "privacy_policy");

  try {
    await memberPage.goto("/profile");
    await expect(memberPage).toHaveURL(/\/onboarding\/consent/);
    await expect(memberPage.getByText(/privacy policy/i)).toBeVisible();

    await memberPage.getByLabel(/i accept the privacy policy/i).check();
    await memberPage.getByLabel(/i accept the terms/i).check();
    await memberPage.getByLabel(/i confirm i am 18/i).check();
    await memberPage.getByRole("button", { name: /continue/i }).click();
    await expect(memberPage).toHaveURL(/\/onboarding\/done|\/profile/);
  } finally {
    await admin
      .from("consent_versions")
      .update({ version: "v3" })
      .eq("consent_type", "privacy_policy");
  }
});
```

**Serial execution.** This scenario mutates a shared `consent_versions` row that all other tests read during `makeFullyOnboardedUser`. Mark it `test.describe.serial()` and place it last, or gate it behind a separate Playwright project that runs after the others.

---

## 7. CI wiring

### 7.1 Proposed `.github/workflows/e2e.yml`

Keep separate from `ci.yml` so lint/typecheck/build stay <2 min on every PR and E2E runs in parallel as its own status check.

```yaml
name: E2E

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  playwright:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Install Playwright browsers
        run: pnpm exec playwright install chromium --with-deps
      - name: Start Supabase
        uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase start
      - name: Apply migrations + seed
        run: supabase db reset --debug
      - name: Write .env.local for Playwright
        run: |
          supabase status --output env > .env.local
          echo "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000" >> .env.local
          echo "FEATURE_EVENTS=true" >> .env.local
          echo "FEATURE_MEMBER_DIRECTORY=true" >> .env.local
          echo "FEATURE_SHARED_EVENT_HISTORY=true" >> .env.local
      - name: Run Playwright
        run: pnpm test:e2e
        env:
          CI: "true"
      - name: Upload traces + HTML report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          retention-days: 14
```

### 7.2 When to run

- **PRs to main:** yes, blocking.
- **Pushes to feature branches:** no.
- **Pushes to main (post-merge):** yes.
- **Nightly:** not yet. Revisit if we hit a flake-rate >2%.

### 7.3 Runtime budget

Target: **under 3 minutes total CI time**.
- `supabase start` + reset: ~45s
- `pnpm install` (cached): ~15s
- `playwright install chromium`: ~20s (cached)
- Test execution (7 scenarios, 2 workers, ~12s avg each): ~45s
- Overhead: ~30s
- **Total: ~2:30–3:00**

---

## 8. Flakiness mitigation

- **Deterministic seeds.** Every test's data is scoped by `suffix`.
- **No arbitrary timeouts.** Use `expect(locator).toBeVisible()` with default 5s timeout. Never `page.waitForTimeout(n)`.
- **State-based assertions.** "admin sees 2/2 checked in" > "admin sees the count incremented by 1."
- **`retries: 1` in CI, `0` locally.**
- **`fullyParallel: true`** at config + file level. Scenario 7 is the single `test.describe.serial()` exception.
- **Trace viewer**, screenshots + video on failure, HTML reporter, interactive UI mode (`pnpm test:e2e:ui`), debug mode (`pnpm test:e2e:debug`).

---

## 9. Maintenance story

### 9.1 Selector policy

**Semantic first, `data-testid` as escape hatch.** Priority order:

1. **`getByRole('button', { name: /i'm going/i })`** — default. Forces accessible labels.
2. **`getByLabel('Title')`** — for form inputs.
3. **`getByText(/you're going/i)`** — for status lines.
4. **`getByTestId('…')`** — only when no accessible role/label exists, or disambiguation via `.filter()` is more brittle.

### 9.2 Who updates tests

The dev who changed the UI is responsible for updating the affected E2E. If non-trivial (>15 min), pair with whoever wrote it first.

---

## 10. Rollout order

Don't build all seven scenarios at once:

1. **§2–5 (setup + fixtures + auth + cleanup).** Foundation; one PR. End with scenario 1 passing.
2. **Scenario 1** (happy path) — validates the whole toolchain.
3. **Scenario 2** (waitlist) — highest-leverage correctness test.
4. **Scenario 3** (private-invite visibility) — small, catches 404/visibility regressions.
5. **Scenario 4** (cancel fan-out) — email-log polling is a new capability; worth isolating.
6. **Scenario 5** (member directory) — simple, high-coverage.
7. **Scenario 6** (shared events) — marginal coverage over the existing smoke; last.
8. **Scenario 7** (consent cascade) — serial, mutates shared state; go last.
9. **CI wiring** — turn on after scenarios 1–4 are green locally for a week.

Ship scenarios 1–3 behind `continue-on-error: true` in CI for the first week so a flake doesn't block merges. Flip to blocking once the flake rate is <1 in 50 runs.

---

## 11. Open questions / deferred

- **Visual regression.** Playwright supports `toHaveScreenshot()`. Pixel diffing on a Tailwind app is notoriously flaky across OS/font-rendering. Skip for now.
- **Accessibility audits.** `@axe-core/playwright` is a natural add-on. Defer to a follow-up roadmap item.
- **Cross-browser.** Firefox + WebKit when we get a UA-specific bug report. Not before.
- **Mobile viewport.** Defer until we hear about a mobile bug.
- **Load / concurrency.** Out of scope; that's a k6 / Artillery job.

---

## 12. Critical files for implementation

New:
- `/Users/joey/Developer/progsu-platform/playwright.config.ts`
- `/Users/joey/Developer/progsu-platform/tests/e2e/fixtures.ts`
- `/Users/joey/Developer/progsu-platform/tests/e2e/helpers/session.ts` (the cookie-injection trick is the whole ballgame)
- `/Users/joey/Developer/progsu-platform/tests/e2e/helpers/seed.ts`
- `/Users/joey/Developer/progsu-platform/.github/workflows/e2e.yml`

Reference files the new work depends on (do not modify):
- `/Users/joey/Developer/progsu-platform/middleware.ts`
- `/Users/joey/Developer/progsu-platform/app/auth/callback/route.ts`
- `/Users/joey/Developer/progsu-platform/lib/auth/onboarding.ts`
- `/Users/joey/Developer/progsu-platform/lib/supabase/{server,browser,admin}.ts`
- `/Users/joey/Developer/progsu-platform/scripts/smoke-event-rsvp.ts` (the template)
- `/Users/joey/Developer/progsu-platform/scripts/smoke-onboarding-parity.ts` (for seed-helper logic)
- `/Users/joey/Developer/progsu-platform/lib/email/resend.ts` (email log transport used by scenario 4)
- `/Users/joey/Developer/progsu-platform/supabase/config.toml` (auth + storage config for local runs)
