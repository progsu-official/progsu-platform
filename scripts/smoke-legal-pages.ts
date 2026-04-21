import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { spawn, type ChildProcess } from "node:child_process";

async function waitForServer(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 307) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("dev server did not start");
}

async function main() {
  let proc: ChildProcess | null = null;
  try {
    proc = spawn("pnpm", ["dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3000" },
    });
    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});
    await waitForServer("http://localhost:3000/");

    const privacy = await fetch("http://localhost:3000/privacy", {
      redirect: "manual",
    });
    if (privacy.status !== 200)
      throw new Error(`/privacy ${privacy.status}`);
    const pBody = await privacy.text();
    if (!pBody.includes("Privacy Policy"))
      throw new Error("/privacy missing heading");
    console.log(`  ✓ /privacy = 200`);

    const terms = await fetch("http://localhost:3000/terms", {
      redirect: "manual",
    });
    if (terms.status !== 200) throw new Error(`/terms ${terms.status}`);
    const tBody = await terms.text();
    if (!tBody.includes("Terms of Service"))
      throw new Error("/terms missing heading");
    console.log(`  ✓ /terms = 200`);

    console.log("✓ legal pages smoke OK");
  } finally {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((err) => {
  console.error("✗ smoke failed:", err);
  process.exit(1);
});
