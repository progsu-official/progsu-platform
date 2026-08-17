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
        /* not yet */
      }
      if (Date.now() > deadline) return reject(new Error("dev server did not start"));
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function getHtml(path: string) {
  const res = await fetch(`http://localhost:3000${path}`, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

async function main() {
  const proc = spawn("pnpm", ["dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "3000" },
  });
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});

  let ok = false;
  try {
    await waitForServer("http://localhost:3000/");

    // 1. /login (no session) renders 200 and contains "Continue with Google".
    const clean = await getHtml("/login");
    if (clean.status !== 200)
      throw new Error(`/login expected 200 got ${clean.status}`);
    if (!clean.body.includes("Continue with Google"))
      throw new Error(`/login missing CTA text`);
    if (!clean.body.includes("Sign in to continue"))
      throw new Error(`/login missing subheading`);
    console.log(`  ✓ GET /login = 200 with CTA + subheading`);

    // 2. /login?error=exchange_failed renders the mapped human message.
    const errPage = await getHtml("/login?error=exchange_failed");
    if (errPage.status !== 200) throw new Error(`err status ${errPage.status}`);
    if (!errPage.body.includes("couldn&#x27;t verify that sign-in")) {
      // HTML-entity encoded "couldn't"
      throw new Error(`/login?error=... missing friendly copy`);
    }
    console.log(`  ✓ GET /login?error=exchange_failed shows mapped copy`);

    // 3. Unknown error code falls back to generic copy.
    const unk = await getHtml("/login?error=nonsense");
    if (unk.status !== 200) throw new Error(`unk status ${unk.status}`);
    if (!unk.body.includes("Sign-in failed")) {
      throw new Error(`/login?error=nonsense missing fallback`);
    }
    console.log(`  ✓ GET /login?error=nonsense falls back`);

    // 4. / landing page has the real Google sign-in button (no /login hop).
    const landing = await getHtml("/");
    if (landing.status !== 200) throw new Error(`/ status ${landing.status}`);
    if (!landing.body.includes("Continue with Google"))
      throw new Error(`landing page missing Google sign-in CTA`);
    console.log(`  ✓ GET / has Google sign-in CTA`);

    ok = true;
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!ok) process.exit(1);
  console.log("✓ /login smoke OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ /login smoke failed:", err);
  process.exit(1);
});
