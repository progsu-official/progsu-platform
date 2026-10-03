import "server-only";

import http2 from "node:http2";

import { apnsConfig } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { signEs256Jwt } from "./crypto";

// APNs token-based auth over HTTP/2. With any APNS_* env missing the worker
// marks claimed rows 'skipped' and sends nothing.

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

let cachedJwt: { token: string; issuedAt: number } | null = null;

function providerToken(cfg: NonNullable<ReturnType<typeof apnsConfig>>): string {
  const now = Math.floor(Date.now() / 1000);
  // Apple rejects tokens older than an hour and throttles refreshing more
  // than every 20 minutes.
  if (cachedJwt && now - cachedJwt.issuedAt < 40 * 60) return cachedJwt.token;
  const token = signEs256Jwt({ kid: cfg.keyId }, { iss: cfg.teamId, iat: now }, cfg.privateKey);
  cachedJwt = { token, issuedAt: now };
  return token;
}

type SendOutcome = { ok: true } | { ok: false; status: number; reason: string };

function send(
  session: http2.ClientHttp2Session,
  cfg: NonNullable<ReturnType<typeof apnsConfig>>,
  deviceToken: string,
  payload: unknown,
  priority: "10" | "5"
): Promise<SendOutcome> {
  return new Promise((resolve) => {
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken(cfg)}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": priority,
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    req.setTimeout(10_000, () => {
      req.close();
      resolve({ ok: false, status: 0, reason: "timeout" });
    });
    req.on("response", (h) => {
      status = Number(h[":status"] ?? 0);
    });
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      if (status === 200) return resolve({ ok: true });
      let reason = "unknown";
      try {
        reason = (JSON.parse(body) as { reason?: string }).reason ?? reason;
      } catch {
        // keep unknown
      }
      resolve({ ok: false, status, reason });
    });
    req.on("error", (e) => resolve({ ok: false, status: 0, reason: e.message }));
    req.end(JSON.stringify(payload));
  });
}

export async function runPushOutbox({ maxBatch = 100 } = {}) {
  const admin = createAdminClient();
  const { data: claimed, error } = await admin.rpc("push_outbox_claim", { p_limit: maxBatch });
  if (error) throw new Error(`push_outbox_claim: ${error.message}`);
  const rows = (claimed ?? []) as Array<{
    id: string;
    user_id: string;
    announcement_id: string;
    title: string;
    body: string;
    deep_link: string | null;
    priority: string;
  }>;
  const cfg = apnsConfig();
  const stats = { claimed: rows.length, sent: 0, failed: 0, skipped: 0 };
  if (rows.length === 0) return stats;

  if (!cfg) {
    for (const r of rows) await admin.rpc("push_outbox_finish", { p_id: r.id, p_status: "skipped", p_error: "apns not configured" });
    stats.skipped = rows.length;
    return stats;
  }

  const sessions = new Map<string, http2.ClientHttp2Session>();
  const sessionFor = (env: "production" | "sandbox") => {
    let s = sessions.get(env);
    if (!s || s.closed || s.destroyed) {
      s = http2.connect(HOSTS[env]);
      s.on("error", () => undefined);
      sessions.set(env, s);
    }
    return s;
  };

  try {
    for (const r of rows) {
      const { data: tokens } = await admin
        .from("device_tokens")
        .select("token, env")
        .eq("user_id", r.user_id);
      if (!tokens || tokens.length === 0) {
        await admin.rpc("push_outbox_finish", { p_id: r.id, p_status: "skipped", p_error: "no device" });
        stats.skipped += 1;
        continue;
      }
      const payload = {
        aps: {
          alert: { title: r.title, body: r.body.slice(0, 1000) },
          sound: "default",
          "interruption-level": r.priority === "important" ? "time-sensitive" : "active",
        },
        announcementId: r.announcement_id,
        ...(r.deep_link ? { deepLink: r.deep_link } : {}),
      };
      let anyOk = false;
      let lastErr = "";
      for (const t of tokens) {
        const out = await send(
          sessionFor(t.env as "production" | "sandbox"),
          cfg,
          t.token as string,
          payload,
          r.priority === "important" ? "10" : "5"
        );
        if (out.ok) {
          anyOk = true;
        } else {
          lastErr = `${out.status} ${out.reason}`;
          if (out.status === 410 || out.reason === "BadDeviceToken" || out.reason === "Unregistered") {
            await admin.from("device_tokens").delete().eq("token", t.token);
          }
        }
      }
      await admin.rpc("push_outbox_finish", {
        p_id: r.id,
        p_status: anyOk ? "sent" : "failed",
        p_error: anyOk ? null : lastErr,
      });
      if (anyOk) stats.sent += 1;
      else stats.failed += 1;
    }
  } finally {
    for (const s of sessions.values()) s.close();
  }
  log.info("push outbox drained", { action: "push_outbox", ...stats });
  return stats;
}
