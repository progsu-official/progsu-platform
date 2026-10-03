// /support and /privacy render signed out; the apple-app-site-association
// file 404s without APPLE_TEAM_ID and, with it, serves JSON straight through
// middleware (no /login redirect, which would silently break universal links).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";

const PORT = "3017";
const BASE = `http://localhost:${PORT}`;
const TEAM = "SMOKETEAM1";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function waitForServer(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("dev server did not start");
}

async function main() {
  const saved = process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_TEAM_ID;
  const { GET } = await import("../app/.well-known/apple-app-site-association/route");
  assert(GET().status === 404, "AASA must 404 without APPLE_TEAM_ID");
  console.log("  ✓ AASA 404 without APPLE_TEAM_ID");
  process.env.APPLE_TEAM_ID = saved;

  let proc: ChildProcess | null = null;
  try {
    proc = spawn("node_modules/.bin/next", ["dev", "--port", PORT], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, APPLE_TEAM_ID: TEAM, IOS_BUNDLE_ID: "" },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer(`${BASE}/`);

    for (const [path, needle] of [["/support", "hello@progsu.com"], ["/privacy", "Privacy Policy"]]) {
      const res = await fetch(BASE + path, { redirect: "manual" });
      assert(res.status === 200, `${path} signed out: ${res.status}`);
      assert((await res.text()).includes(needle), `${path} missing "${needle}"`);
      console.log(`  ✓ ${path} = 200 signed out`);
    }

    const res = await fetch(`${BASE}/.well-known/apple-app-site-association`, { redirect: "manual" });
    assert(res.status === 200, `AASA status ${res.status}`);
    assert(res.headers.get("content-type")?.startsWith("application/json"), "AASA content-type");
    const body = await res.json();
    const appId = `${TEAM}.com.progsu.app`;
    assert(body.applinks.details[0].appIDs[0] === appId, "AASA applinks appID");
    assert(body.webcredentials.apps[0] === appId, "AASA webcredentials appID");
    const paths = body.applinks.details[0].components.map((c: { "/": string }) => c["/"]);
    assert(paths.includes("/events/*"), "AASA missing /events/*");
    assert(!paths.includes("/checkin"), "AASA must not claim /checkin");
    console.log(`  ✓ AASA = 200 application/json for ${appId}`);

    console.log("✓ support + AASA smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
