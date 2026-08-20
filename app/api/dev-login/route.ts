import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

// Local-only Google OAuth bypass: signs in a fixed fully-onboarded test
// account (member or admin, via ?role=) and redirects to /profile.
// Hard-gated on NODE_ENV so this can never run against a real deployment
// regardless of any other env var. Same accounts scripts/dev-seed.ts seeds
// with a full mock dataset — this route just creates a bare-minimum version
// if dev-seed hasn't been run yet.
const DEV_PASSWORD = "dev-login-password-12345";
const ROLES = {
  member: { email: "dev-member@example.com", isAdmin: false, firstName: "Dev-Member", lastName: "Account" },
  admin: { email: "dev-admin@example.com", isAdmin: true, firstName: "Dev-Admin", lastName: "Account" },
  // Deleted and recreated blank on every visit, so each hit of
  // /api/dev-login?role=onboarding restarts the funnel from the top. Pair
  // with ONBOARDING_TEST_MODE=true to click through with dummy values.
  onboarding: { email: "dev-onboarding@example.com", isAdmin: false, firstName: "Dev-Onboarding", lastName: "Account" },
} as const;

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const roleParam = request.nextUrl.searchParams.get("role");
  const role =
    roleParam === "admin"
      ? "admin"
      : roleParam === "onboarding"
        ? "onboarding"
        : "member";
  const { email: DEV_EMAIL, isAdmin, firstName, lastName } = ROLES[role];

  const admin = createAdminClient();

  let userId: string;
  const signIn = () =>
    fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: DEV_EMAIL, password: DEV_PASSWORD }),
    });

  let signinRes = await signIn();

  if (role === "onboarding") {
    // Reset: drop any existing account (cascades wipe its profile, consents,
    // codes) and recreate it blank so the funnel starts fresh.
    if (signinRes.ok) {
      const existing = (await signinRes.json()) as { user: { id: string } };
      await admin.auth.admin.deleteUser(existing.user.id).catch(() => {});
    }
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { given_name: firstName, family_name: lastName },
    });
    if (createErr || !created.user) {
      return NextResponse.json(
        { error: `createUser failed: ${createErr?.message}` },
        { status: 500 }
      );
    }
    signinRes = await signIn();
    if (!signinRes.ok) {
      return NextResponse.json({ error: "sign-in failed after create" }, { status: 500 });
    }
  } else if (!signinRes.ok) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { given_name: firstName, family_name: lastName },
    });
    if (createErr || !created.user) {
      return NextResponse.json(
        { error: `createUser failed: ${createErr?.message}` },
        { status: 500 }
      );
    }
    userId = created.user.id;

    const y = new Date().getFullYear() + 1;
    await admin
      .from("profiles")
      .update({
        student_email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@student.gsu.edu`,
        student_email_verified: true,
        student_email_verified_at: new Date().toISOString(),
        verification_method: "admin_manual",
        first_name: firstName,
        last_name: lastName,
        school: "Georgia State University",
        major: "CS",
        phone_number: "+14045551234",
        class_standing: "junior",
        grad_year: y,
        grad_term: `Fall ${y}`,
        interested_roles: ["software_engineering"],
        is_admin: isAdmin,
      })
      .eq("id", userId);

    const { data: versions } = await admin
      .from("consent_versions")
      .select("consent_type, version")
      .in("consent_type", ["privacy_policy", "terms_of_service", "age_confirmation"]);
    const versionFor = (type: string) =>
      versions?.find((v) => v.consent_type === type)?.version ?? "v1";
    await admin.from("consents").insert([
      { user_id: userId, consent_type: "privacy_policy", accepted: true, version: versionFor("privacy_policy") },
      { user_id: userId, consent_type: "terms_of_service", accepted: true, version: versionFor("terms_of_service") },
      { user_id: userId, consent_type: "age_confirmation", accepted: true, version: versionFor("age_confirmation") },
    ]);

    signinRes = await signIn();
    if (!signinRes.ok) {
      return NextResponse.json({ error: "sign-in failed after create" }, { status: 500 });
    }
  }

  const tokens = (await signinRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: unknown;
  };

  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const sessionJson = JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
    token_type: tokens.token_type,
    user: tokens.user,
  });
  const cookieValue =
    "base64-" +
    Buffer.from(sessionJson)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const requestedNext = request.nextUrl.searchParams.get("next");
  const defaultPath =
    role === "onboarding" ? "/onboarding/verify-email" : "/profile";
  const targetPath =
    requestedNext && requestedNext.startsWith("/") ? requestedNext : defaultPath;
  const response = NextResponse.redirect(new URL(targetPath, request.url));
  response.cookies.set(`sb-${ref}-auth-token`, cookieValue, {
    path: "/",
    maxAge: tokens.expires_in,
  });
  return response;
}
