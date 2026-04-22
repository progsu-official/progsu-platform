import { test, expect } from "../fixtures";
import { adminClient } from "../helpers/session";

// Serial + last: this mutates the shared `consent_versions` row. Playwright
// fullyParallel is already off in config, but marking describe.serial makes
// the ordering contract explicit for future parallelization.

test.describe.serial("consent cascade", () => {
  test("privacy_policy version bump routes member through /onboarding/consent", async ({
    memberPage,
  }) => {
    const admin = adminClient();

    // Record the real current version so we can restore even on failure.
    const { data: before } = await admin
      .from("consent_versions")
      .select("version")
      .eq("consent_type", "privacy_policy")
      .single();
    const realVersion = (before as { version: string }).version;

    try {
      // Bump to an impossible-version string that will never match any
      // existing consent row → every user's requiredConsentsCurrent flips
      // false on next loadOnboardingState.
      const bumped = `v${Date.now()}`.slice(0, 10);
      const { error: bumpErr } = await admin
        .from("consent_versions")
        .update({ version: bumped })
        .eq("consent_type", "privacy_policy");
      if (bumpErr) throw new Error(`bump: ${bumpErr.message}`);

      // Any non-dashboard authenticated surface that runs loadOnboardingState
      // should redirect the member to /onboarding/consent.
      await memberPage.goto("/dashboard");
      await expect(memberPage).toHaveURL(/\/onboarding\/consent/, {
        timeout: 10_000,
      });
      await expect(
        memberPage.getByRole("heading").filter({ hasText: /consent/i }).first()
      ).toBeVisible();
    } finally {
      // Restore — otherwise every subsequent run starts with broken fixtures.
      await admin
        .from("consent_versions")
        .update({ version: realVersion })
        .eq("consent_type", "privacy_policy");
    }
  });
});
