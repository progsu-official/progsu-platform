#!/usr/bin/env tsx
// Smoke: /api/mobile/v1 against a running app (default http://localhost:3000,
// override with MOBILE_SMOKE_BASE). Needs FEATURE_MOBILE_API=true and
// FEATURE_EVENTS=true on the server.
//   - auth required on personal routes; bad bearer is 401
//   - cross-user denial (private events, staff routes, announcements audience)
//   - public vs private events for anon / member / invitee
//   - every response parses against lib/mobile/contracts.ts
//   - Hacklanta guide: unpublished = 404; imported + published = 37 sessions
// With --write-fixtures, writes real responses to ios/Progsu/ProgsuTests/Fixtures.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import * as C from "../lib/mobile/contracts";
import { importHacklantaSchedule } from "./import-hacklanta-schedule";
import {
  admin,
  check,
  cleanup,
  failureCount,
  makeEvent,
  makeUser,


} from "./_smoke-mobile-helpers";

const BASE = (process.env.MOBILE_SMOKE_BASE ?? "http://localhost:3000") + "/api/mobile/v1";
const WRITE = process.argv.includes("--write-fixtures");
const FIXTURES = "ios/Progsu/ProgsuTests/Fixtures";

type Res = { status: number; body: Record<string, unknown>; headers: Headers };

async function call(path: string, opts: { method?: string; token?: string | null; body?: unknown; rawAuth?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.rawAuth) headers.Authorization = opts.rawAuth;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? ((await res.json()) as Record<string, unknown>) : { raw: await res.text() };
  return { status: res.status, body, headers: res.headers };
}

function expectOk<T extends z.ZodTypeAny>(r: Res, schema: T, label: string, fixture?: string): z.infer<T> | null {
  const parsed = C.okEnvelope(schema).safeParse(r.body);
  check(r.status === 200 && parsed.success, `${label} -> 200 + contract`, parsed.success ? r.status : { status: r.status, body: r.body, issues: parsed.error?.issues.slice(0, 3) });
  check(Boolean(r.headers.get("x-request-id")), `${label} has X-Request-Id`);
  if (parsed.success && WRITE && fixture) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(join(FIXTURES, `${fixture}.json`), JSON.stringify(r.body, null, 2) + "\n");
  }
  return parsed.success ? (parsed.data as { data: z.infer<T> }).data : null;
}

function expectErr(r: Res, status: number, code: string, label: string, fixture?: string) {
  const parsed = C.errorEnvelope.safeParse(r.body);
  check(
    r.status === status && parsed.success && parsed.data.error.code === code,
    `${label} -> ${status} ${code}`,
    { status: r.status, body: r.body }
  );
  if (parsed.success && WRITE && fixture) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(join(FIXTURES, `${fixture}.json`), JSON.stringify(r.body, null, 2) + "\n");
  }
}

async function main() {
  const ping = await fetch(`${BASE}/config`).catch(() => null);
  if (!ping) throw new Error(`no server at ${BASE}; start the app first`);

  const officer = await makeUser("officer", { admin: true, onboarded: true });
  const alice = await makeUser("alice", { onboarded: true });
  const bob = await makeUser("bob", { onboarded: true });
  const fresh = await makeUser("fresh");

  const pub = await makeEvent({ startsInMinutes: 30, title: "Smoke public build night" });
  const priv = await makeEvent({ startsInMinutes: 45, visibility: "private_invite", title: "Smoke private dinner" });
  const draft = await makeEvent({ startsInMinutes: 60, status: "draft" });
  await admin.from("event_invites").insert({ event_id: priv.id, user_id: alice.id, invited_by: officer.id });
  await officer.db.rpc("admin_set_event_points", { p_event_id: pub.id, p_points: 5 });

  // ---------------------------------------------------------------- config / auth
  expectOk(await call("/config"), C.config, "GET /config", "config");
  expectErr(await call("/me"), 401, "unauthenticated", "GET /me without bearer", "error");
  expectErr(await call("/me", { rawAuth: "Bearer not-a-real-token-xxxxxxxxxxxx" }), 401, "unauthenticated", "GET /me bad bearer");
  expectErr(await call("/events", { rawAuth: "Bearer not-a-real-token-xxxxxxxxxxxx" }), 401, "unauthenticated", "optional route with bad bearer");

  // ---------------------------------------------------------------- me
  const me = expectOk(await call("/me", { token: alice.token }), C.me, "GET /me", "me");
  check(me?.id === alice.id && me.onboarding.fullyOnboarded, "me is alice + onboarded", me?.onboarding);
  const freshMe = expectOk(await call("/me", { token: fresh.token }), C.me, "GET /me (new account)", "me_not_onboarded");
  check(freshMe?.onboarding.nextStep === "profile" && freshMe.affiliation === "unknown", "new account needs profile", freshMe?.onboarding);

  expectErr(await call("/me/profile", { method: "PATCH", token: fresh.token, body: { phoneNumber: "12" } }), 400, "invalid_input", "PATCH bad phone");
  expectErr(await call("/me/profile", { method: "PATCH", token: fresh.token, body: { isAdmin: true } }), 400, "invalid_input", "PATCH unknown field rejected");
  const patched = expectOk(
    await call("/me/profile", {
      method: "PATCH",
      token: fresh.token,
      body: { firstName: "Fresh", lastName: "Person", phoneNumber: "404-555-0199", affiliation: "nonstudent", institutionName: "Acme" },
    }),
    C.me,
    "PATCH /me/profile nonstudent"
  );
  check(patched?.onboarding.profileFieldsComplete === true && patched.onboarding.nextStep === "consent", "nonstudent profile complete without school/major", patched?.onboarding);
  const consented = expectOk(
    await call("/me/consents", {
      method: "POST",
      token: fresh.token,
      body: { acceptances: { privacy_policy: true, terms_of_service: true, age_confirmation: true } },
    }),
    C.consentsResult,
    "POST /me/consents"
  );
  check(consented?.recorded.length === 3, "3 consents recorded");
  const after = expectOk(await call("/me", { token: fresh.token }), C.me, "GET /me after onboarding");
  check(after?.onboarding.fullyOnboarded === true, "fresh now fully onboarded (same helper as web)");
  expectErr(
    await call("/me/consents", { method: "POST", token: fresh.token, body: { acceptances: { privacy_policy: true } } }),
    400,
    "invalid_input",
    "consents missing required"
  );

  // ---------------------------------------------------------------- events
  const anonList = expectOk(await call("/events?limit=50"), C.page(C.eventSummary), "GET /events anon", "events_anon");
  check(anonList?.items.some((e) => e.id === pub.id), "anon sees public event");
  check(!anonList?.items.some((e) => e.id === priv.id || e.id === draft.id), "anon does not see private/draft");
  const bobList = expectOk(await call("/events?limit=50", { token: bob.token }), C.page(C.eventSummary), "GET /events bob");
  check(!bobList?.items.some((e) => e.id === priv.id), "uninvited member does not see private event");
  const aliceList = expectOk(await call("/events?limit=50", { token: alice.token }), C.page(C.eventSummary), "GET /events alice", "events");
  check(aliceList?.items.some((e) => e.id === priv.id), "invitee sees private event");
  const pageOne = expectOk(await call("/events?limit=1", { token: alice.token }), C.page(C.eventSummary), "GET /events limit=1");
  if (pageOne?.nextCursor) {
    const pageTwo = expectOk(await call(`/events?limit=1&cursor=${pageOne.nextCursor}`, { token: alice.token }), C.page(C.eventSummary), "GET /events page 2");
    check(pageTwo?.items[0]?.id !== pageOne.items[0]?.id, "cursor advances");
  }
  expectErr(await call("/events?cursor=garbage", { token: alice.token }), 400, "invalid_input", "bad cursor");

  expectErr(await call(`/events/${priv.slug}`, { token: bob.token }), 404, "not_found", "bob GET private detail");
  expectErr(await call(`/events/${priv.slug}`), 404, "not_found", "anon GET private detail", "error_not_found");
  expectErr(await call(`/events/${draft.slug}`, { token: alice.token }), 404, "not_found", "draft detail hidden");
  expectOk(await call(`/events/${pub.slug}`), C.eventDetail, "anon GET public detail", "event_detail_anon");

  const rsvp = expectOk(
    await call(`/events/${pub.id}/rsvp`, { method: "POST", token: alice.token, body: { desired: "going" } }),
    C.rsvpResult,
    "POST rsvp going",
    "rsvp"
  );
  check(rsvp?.effectiveStatus === "going", "alice going");
  expectErr(await call(`/events/${pub.id}/rsvp`, { method: "POST", body: { desired: "going" } }), 401, "unauthenticated", "rsvp needs auth");
  expectErr(await call(`/events/${priv.id}/rsvp`, { method: "POST", token: bob.token, body: { desired: "going" } }), 403, "forbidden", "bob cannot RSVP private");
  const detail = expectOk(await call(`/events/${pub.slug}`, { token: alice.token }), C.eventDetail, "GET detail as alice", "event_detail");
  check(detail?.viewer?.rsvpStatus === "going" && detail.viewer.pointsAvailable === 5, "detail shows my RSVP + points", detail?.viewer);

  const mine = expectOk(await call("/me/events", { token: alice.token }), C.page(C.myEvent).omit({ nextCursor: true }), "GET /me/events", "my_events");
  check(mine?.items.some((i) => i.event.id === pub.id && i.rsvpStatus === "going"), "my events include RSVP");
  const bobMine = expectOk(await call("/me/events", { token: bob.token }), C.page(C.myEvent).omit({ nextCursor: true }), "GET /me/events bob");
  check(!bobMine?.items.some((i) => i.event.id === pub.id), "bob doesn't see alice's RSVPs");

  const pass = expectOk(await call("/me/pass", { token: alice.token }), C.pass, "GET /me/pass", "pass");
  const { data: prof } = await admin.from("profiles").select("checkin_code").eq("id", alice.id).single();
  check(pass?.qrPayload === prof?.checkin_code, "pass payload = own checkin_code");
  expectErr(await call(`/me/events/${pub.id}/wallet`, { token: alice.token }), 503, "unavailable", "wallet unconfigured -> 503", "error_unavailable");

  // ---------------------------------------------------------------- staff
  expectErr(await call(`/staff/events/${pub.id}/scan`, { method: "POST", token: bob.token, body: { code: pass!.qrPayload } }), 403, "forbidden", "non-staff scan", "error_forbidden");
  expectErr(await call(`/staff/events/${pub.id}/roster`, { token: bob.token }), 403, "forbidden", "non-staff roster");
  await officer.db.rpc("admin_grant_event_staff", { p_event_id: pub.id, p_user_id: bob.id });
  const staffEvents = expectOk(await call("/staff/events", { token: bob.token }), C.page(C.staffEvent).omit({ nextCursor: true }), "GET /staff/events", "staff_events");
  check(staffEvents?.items.some((e) => e.id === pub.id), "bob sees assigned event");
  const scanned = expectOk(
    await call(`/staff/events/${pub.id}/scan`, { method: "POST", token: bob.token, body: { code: pass!.qrPayload } }),
    C.scanResult,
    "POST scan",
    "staff_scan_checked_in"
  );
  check(scanned?.result === "checked_in" && scanned.pointsAwarded === 5, "scan checks in + awards", scanned);
  const rescanned = expectOk(
    await call(`/staff/events/${pub.id}/scan`, { method: "POST", token: bob.token, body: { code: pass!.qrPayload } }),
    C.scanResult,
    "POST scan again",
    "staff_scan"
  );
  check(rescanned?.result === "already_checked_in" && rescanned.pointsAwarded === 0, "rescan idempotent");
  expectOk(await call(`/staff/events/${pub.id}/scan`, { method: "POST", token: bob.token, body: { code: "nope" } }), C.scanResult, "scan invalid", "staff_scan_invalid");
  expectOk(await call(`/staff/events/${pub.id}/roster?q=ali`, { token: bob.token }), C.page(C.rosterEntry).omit({ nextCursor: true }), "GET roster", "roster");
  expectErr(
    await call(`/staff/events/${pub.id}/manual-checkin`, { method: "POST", token: bob.token, body: { userId: fresh.id, reason: "" } }),
    400,
    "invalid_input",
    "manual check-in needs reason"
  );

  const pts = expectOk(await call("/me/points", { token: alice.token }), C.points, "GET /me/points", "points");
  check(pts?.balance === 5 && pts.items[0]?.kind === "award", "alice has 5 points", pts);

  // ---------------------------------------------------------------- announcements
  const pubAnn = async (audience: string, title: string, eventId: string | null = null) => {
    const { data, error } = await officer.db.rpc("admin_publish_announcement", {
      p_title: title, p_body: `${title} body`, p_audience: audience, p_event_id: eventId,
      p_priority: "normal", p_deep_link: null, p_expires_at: null, p_push: true,
    });
    if (error) throw new Error(error.message);
    return String((data as Array<{ announcement_id: string }>)[0].announcement_id);
  };
  const aAll = await pubAnn("all", "Smoke all");
  const aEvent = await pubAnn("event_rsvps", "Smoke rsvps", pub.id);
  const aHack = await pubAnn("hacklanta", "Smoke hacklanta");
  const anonFeed = expectOk(await call("/announcements?limit=50"), C.page(C.announcement), "GET /announcements anon");
  const anonIds = new Set(anonFeed?.items.map((a) => a.id));
  check(anonIds.has(aAll) && !anonIds.has(aEvent) && !anonIds.has(aHack), "anon sees only audience=all");
  check(anonFeed?.items.every((a) => a.read === null), "anon read flag null");
  const aliceFeed = expectOk(await call("/announcements?limit=50", { token: alice.token }), C.page(C.announcement), "GET /announcements alice", "announcements");
  const aliceIds = new Set(aliceFeed?.items.map((a) => a.id));
  check(aliceIds.has(aEvent) && !aliceIds.has(aHack), "RSVP'd member sees event announcement, not hacklanta");
  const freshFeed = expectOk(await call("/announcements?limit=50", { token: fresh.token }), C.page(C.announcement), "GET /announcements fresh");
  check(!freshFeed?.items.some((a) => a.id === aEvent), "non-RSVP member doesn't see event announcement");
  expectOk(await call(`/announcements/${aEvent}/read`, { method: "POST", token: alice.token }), C.readAck, "mark read");
  expectErr(await call(`/announcements/${aEvent}/read`, { method: "POST", token: fresh.token }), 404, "not_found", "cannot mark invisible announcement read");
  const reread = expectOk(await call("/announcements?limit=50", { token: alice.token }), C.page(C.announcement), "feed after read");
  check(reread?.items.find((a) => a.id === aEvent)?.read === true, "read flag set");

  // ---------------------------------------------------------------- devices
  const token = "ab".repeat(32);
  expectOk(await call("/devices", { method: "POST", token: alice.token, body: { token, env: "sandbox" } }), C.deviceAck, "register device");
  expectOk(await call("/devices", { method: "POST", token: bob.token, body: { token, env: "sandbox" } }), C.deviceAck, "re-register to bob");
  const { data: dt } = await admin.from("device_tokens").select("user_id").eq("token", token).single();
  check(dt?.user_id === bob.id, "token reassigned to current user only", dt);
  const aliceDel = await call(`/devices/${token}`, { method: "DELETE", token: alice.token });
  check((aliceDel.body.data as { removed?: boolean })?.removed === false, "alice cannot remove bob's token");
  const bobDel = await call(`/devices/${token}`, { method: "DELETE", token: bob.token });
  check((bobDel.body.data as { removed?: boolean })?.removed === true, "bob removes own token");
  expectErr(await call("/devices", { method: "POST", token: alice.token, body: { token: "xyz", env: "sandbox" } }), 400, "invalid_input", "bad device token");

  // ---------------------------------------------------------------- hacklanta
  await admin.from("hacklanta_editions").update({ published_at: null }).eq("slug", "hacklanta-ii");
  await importHacklantaSchedule({ publish: false, file: "data/hacklanta-ii-schedule.json" });
  expectErr(await call("/hacklanta"), 404, "not_found", "unpublished guide hidden");
  const imported = await importHacklantaSchedule({ publish: true, file: "data/hacklanta-ii-schedule.json" });
  check(imported.published && imported.upserted === 37, "import publishes 37 sessions", imported);
  const again = await importHacklantaSchedule({ publish: true, file: "data/hacklanta-ii-schedule.json" });
  const { count } = await admin.from("hacklanta_sessions").select("id", { count: "exact", head: true }).eq("edition_id", again.editionId);
  check(count === 37, "re-import is idempotent", count);
  const guide = expectOk(await call("/hacklanta"), C.hacklantaGuide, "GET /hacklanta", "hacklanta");
  check(guide?.sessions.length === 37 && guide.edition.scheduleTentative === true, "guide has 37 tentative sessions");
  check(guide?.edition.lat === null && guide.edition.lng === null, "no unverified coordinates");
  const cfg = expectOk(await call("/config"), C.config, "GET /config with edition", "config_hacklanta");
  check(cfg?.hacklanta?.slug === "hacklanta-ii", "config carries edition summary");

  const sid = guide!.sessions[0].id;
  expectErr(await call(`/hacklanta/bookmarks/${sid}`, { method: "PUT" }), 401, "unauthenticated", "bookmark needs auth");
  expectOk(await call(`/hacklanta/bookmarks/${sid}`, { method: "PUT", token: alice.token }), C.bookmarkAck, "PUT bookmark");
  expectOk(await call(`/hacklanta/bookmarks/${sid}`, { method: "PUT", token: alice.token }), C.bookmarkAck, "PUT bookmark idempotent");
  const bm = expectOk(await call("/hacklanta/bookmarks", { token: alice.token }), C.bookmarks, "GET bookmarks", "bookmarks");
  check(bm?.sessionIds.includes(sid), "bookmark saved");
  const bobBm = expectOk(await call("/hacklanta/bookmarks", { token: bob.token }), C.bookmarks, "GET bookmarks bob");
  check(!bobBm?.sessionIds.includes(sid), "bookmarks are per user");
  expectErr(await call(`/hacklanta/bookmarks/${crypto.randomUUID()}`, { method: "PUT", token: alice.token }), 404, "not_found", "bookmark unknown session");
  expectOk(await call(`/hacklanta/bookmarks/${sid}`, { method: "DELETE", token: alice.token }), C.bookmarkAck, "DELETE bookmark");
  const hm = expectOk(await call("/hacklanta/me", { token: alice.token }), C.hacklantaMe, "GET /hacklanta/me", "hacklanta_me");
  check(hm?.linked === false, "not linked");
  const start = await call("/hacklanta/link/start", { method: "POST", token: alice.token, body: { email: "someone@example.com" } });
  check(
    start.status === 503 || start.status === 200,
    "link/start answers 503 (no Hacklanta env) or 200 without revealing a match",
    start.body
  );
  expectErr(await call("/hacklanta/link/verify", { method: "POST", token: alice.token, body: { code: "12" } }), 400, "invalid_input", "verify code shape");

  // Delete requires the literal confirmation.
  expectErr(await call("/me/delete", { method: "POST", token: fresh.token, body: { confirm: "yes" } }), 400, "invalid_input", "delete needs confirm DELETE");
}

main()
  .catch((e) => {
    console.error("[smoke-mobile-api] threw:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    if (failureCount() > 0) {
      console.error(`[smoke-mobile-api] ${failureCount()} FAILED`);
      process.exitCode = 1;
    } else if (!process.exitCode) console.log("[smoke-mobile-api] ALL OK");
  });
