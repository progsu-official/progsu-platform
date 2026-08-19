// Click-through of the Discord connect button. Can't automate an actual
// Discord login (needs real credentials, likely 2FA) — this verifies
// everything up to that boundary: the button's disabled/enabled state, and
// that clicking it actually reaches Discord's real OAuth authorize endpoint
// with the configured client_id (proves config.toml + env wiring is correct
// without needing to complete a real login).
//
// Requires SUPABASE_AUTH_EXTERNAL_DISCORD_CLIENT_ID/SECRET to be set and
// `supabase stop && supabase start` rerun after adding them to .env.local —
// config.toml's env() substitution only re-reads on container start.
//
// Usage: pnpm tsx scripts/smoke-discord-username.ts

import { chromium, type Locator } from "@playwright/test";

async function waitForDisabled(locator: Locator, expected: boolean, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await locator.isDisabled()) === expected) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for disabled=${expected}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let ok = false;

  try {
    await page.goto("http://localhost:3000/api/dev-login?role=member");
    await page.waitForURL("**/dashboard");
    console.log("✓ signed in via dev-login bypass");

    await page.goto("http://localhost:3000/dashboard/settings#visibility");

    const discoverableToggle = page.getByRole("checkbox", {
      name: "Let other Progsu members find my profile",
    });

    // Toggle off first to prove the button is disabled when visibility is off.
    // This is a controlled checkbox that only flips after a server round
    // trip, so click + poll rather than check()/uncheck() (which assert an
    // immediate DOM change).
    const connectBtn = page.getByRole("button", { name: "Connect Discord" });
    await connectBtn.waitFor({ state: "visible" });
    if (await discoverableToggle.isChecked()) {
      await discoverableToggle.click();
    }
    await waitForDisabled(connectBtn, true);
    console.log("✓ disabled while visibility is off");

    await discoverableToggle.click();
    await waitForDisabled(connectBtn, false);
    console.log("✓ enabled once visibility is on");

    await Promise.all([
      page.waitForURL(/discord\.com\/oauth2\/authorize/, { timeout: 10_000 }),
      connectBtn.click(),
    ]);
    const landedUrl = new URL(page.url());
    const clientId = landedUrl.searchParams.get("client_id");
    if (!clientId) {
      throw new Error("reached Discord authorize but client_id param is missing");
    }
    console.log(`✓ reached Discord's real OAuth authorize page with client_id=${clientId}`);
    console.log("  (stopping here — completing the real login isn't automatable)");

    ok = true;
  } finally {
    await browser.close();
  }

  if (!ok) process.exit(1);
  console.log("\n✓ discord-connect smoke OK (config wiring verified, login not completed)");
}

main().catch((err) => {
  console.error("✗ discord-connect smoke failed:", err);
  process.exit(1);
});
