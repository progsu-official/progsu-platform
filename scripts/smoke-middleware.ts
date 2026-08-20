import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn } from "node:child_process";

function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || res.status === 307) return resolve();
      } catch {
        // not yet
      }
      if (Date.now() > deadline) return reject(new Error("dev server did not start"));
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function headWithRedirect(path: string, cookie?: string) {
  const res = await fetch(`http://localhost:3000${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  return { status: res.status, location: res.headers.get("location") };
}

async function main() {
  // Start the dev server in the background.
  const proc = spawn("pnpm", ["dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "3000" },
  });
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});

  let ok = false;
  try {
    await waitForServer("http://localhost:3000/");

    // 1. Public root passes through (200).
    const root = await headWithRedirect("/");
    if (root.status !== 200) throw new Error(`/ status=${root.status}`);
    console.log(`  ✓ GET / = ${root.status}`);

    // 2. Unauthenticated visit to /profile → 307 → /login?next=/profile.
    const dash = await headWithRedirect("/profile");
    if (dash.status !== 307) throw new Error(`/profile expected 307 got ${dash.status}`);
    if (!dash.location?.includes("/login")) throw new Error(`expected /login redirect, got ${dash.location}`);
    if (!dash.location?.includes("next=%2Fdashboard") && !dash.location?.includes("next=/profile"))
      throw new Error(`expected next query, got ${dash.location}`);
    console.log(`  ✓ GET /profile = 307 → ${dash.location}`);

    // 3. Unauthenticated /onboarding/profile → /login.
    const onb = await headWithRedirect("/onboarding/profile");
    if (onb.status !== 307) throw new Error(`/onboarding/profile expected 307 got ${onb.status}`);
    if (!onb.location?.includes("/login")) throw new Error(`onb redirect: ${onb.location}`);
    console.log(`  ✓ GET /onboarding/profile = 307 → ${onb.location}`);

    // 4. Unauthenticated /admin → /login (admin check happens in layout, not middleware;
    //    middleware just bounces no-session traffic).
    const admin = await headWithRedirect("/admin");
    if (admin.status !== 307) throw new Error(`/admin expected 307 got ${admin.status}`);
    console.log(`  ✓ GET /admin (no session) = 307 → ${admin.location}`);

    // 5. /auth/callback with no code → /login?error=missing_code.
    const cb = await headWithRedirect("/auth/callback");
    if (cb.status !== 307) throw new Error(`callback expected 307 got ${cb.status}`);
    if (!cb.location?.includes("error=missing_code"))
      throw new Error(`callback redirect: ${cb.location}`);
    console.log(`  ✓ GET /auth/callback (no code) = 307 → ${cb.location}`);

    // 6. /auth/callback with an invalid code → /login?error=exchange_failed.
    const cbBad = await headWithRedirect("/auth/callback?code=nonsense");
    if (cbBad.status !== 307) throw new Error(`cbBad status ${cbBad.status}`);
    if (!cbBad.location?.includes("error=exchange_failed"))
      throw new Error(`cbBad redirect: ${cbBad.location}`);
    console.log(`  ✓ GET /auth/callback?code=bad = 307 → ${cbBad.location}`);

    ok = true;
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!ok) process.exit(1);
  console.log("✓ middleware + callback smoke OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
