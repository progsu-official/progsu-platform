#!/usr/bin/env tsx
// Validates migration 20260929140000 (Hacklanta SMS audiences + batching) inside
// ONE transaction that is always rolled back: applies the migration, seeds
// fake recipients, and asserts audience counts, suppression, the create/claim
// paths and that gsu / all_consented are unchanged. Nothing is committed and
// nothing is sent (the worker only sees committed rows).
//
// Refuses to run if any delivery is queued or sending, so it can't hold locks
// on a real broadcast's rows.
//
// Usage: pnpm tsx scripts/validate-hacklanta-sms-audience.ts

import { config } from "dotenv";
config({ path: ".env.local" });
import * as fs from "fs";
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Missing SUPABASE_DB_URL");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`);
}

class Rollback extends Error {}

async function main() {
  const migration = fs.readFileSync(
    "supabase/migrations/20260929140000_sms_hacklanta_emailed_batches.sql",
    "utf8"
  );

  try {
    await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '5s'`;

      const [busy] = await tx`
        select count(*)::int as n from public.sms_deliveries where status in ('queued','sending')`;
      if (busy.n > 0) throw new Error(`refusing: ${busy.n} deliveries queued/sending right now`);

      const [before] = await tx`
        select (select count(*) from public.sms_audience_numbers('gsu'))::int as gsu,
               (select count(*) from public.sms_audience_numbers('all_consented'))::int as everyone`;

      await tx.unsafe(migration);
      // Start from an empty roster; the real rows come back on rollback.
      await tx`delete from public.hacklanta_sms_recipients`;

      const [after] = await tx`
        select (select count(*) from public.sms_audience_numbers('gsu'))::int as gsu,
               (select count(*) from public.sms_audience_numbers('all_consented'))::int as everyone,
               (select count(*) from public.sms_audience_numbers('hacklanta_accepted'))::int as hack`;
      check("gsu count unchanged by migration", after.gsu === before.gsu, { before, after });
      check("all_consented count unchanged by migration", after.everyone === before.everyone, { before, after });
      void after.hack;

      // Fake numbers in the 555-01xx range; rolled back with everything else.
      const A = "+12025550101";
      const B = "+12025550102"; // suppressed
      const C = "+12025550103";
      await tx`insert into public.hacklanta_sms_recipients (phone_e164, first_name)
               values (${A}, 'a'), (${B}, 'b'), (${C}, 'c')`;
      await tx`insert into public.sms_suppressions (phone_e164, reason, note)
               values (${B}, 'manual', 'validate script')`;

      const nums = (await tx`select n from public.sms_audience_numbers('hacklanta_accepted') n`).map(
        (r) => r.n as string
      );
      check("audience = recipients minus suppressed", nums.length === 2 && nums.includes(A) && nums.includes(C) && !nums.includes(B), nums);
      check("hacklanta numbers do not leak into gsu/all_consented", (await tx`
        select count(*)::int as n from public.sms_audience_numbers('all_consented') n
         where n in (${A}, ${B}, ${C})`)[0].n === 0);

      const [admin] = await tx`
        select p.id from public.profiles p where public.is_admin(p.id) limit 1`;
      if (!admin) throw new Error("no admin profile to act as");
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: admin.id, role: "authenticated" })}, true)`;
      await tx`select set_config('request.jwt.claim.sub', ${admin.id}, true)`;

      // Runs fn as the admin inside a savepoint. A failing statement aborts the
      // transaction unless the savepoint is rolled back before anything else
      // runs, so errors come back as values for the refusal checks.
      const asAdmin = async <T>(fn: () => Promise<T>): Promise<T | Error> => {
        await tx`savepoint sp_admin`;
        await tx`set local role authenticated`;
        try {
          const v = await fn();
          await tx`reset role`;
          await tx`release savepoint sp_admin`;
          return v;
        } catch (e) {
          await tx`rollback to savepoint sp_admin`;
          await tx`reset role`;
          return e as Error;
        }
      };
      const body = "Team Hacklanta: test. Reply STOP to opt out.";

      const noStop = await asAdmin(() =>
        tx`select public.create_sms_broadcast('no opt out wording', 'hacklanta_accepted', 2)`
      );
      check("missing STOP wording is refused", noStop instanceof Error && /STOP/.test(noStop.message), noStop);

      const wrongCount = await asAdmin(() =>
        tx`select public.create_sms_broadcast(${body}, 'hacklanta_accepted', 5)`
      );
      check("wrong confirmed count is refused", wrongCount instanceof Error && /audience changed to 2/.test(wrongCount.message), wrongCount);

      const created = await asAdmin(async () => {
        const [r] = await tx`select public.create_sms_broadcast(${body}, 'hacklanta_accepted', 2) as r`;
        return r.r as { broadcast_id: string; recipient_count: number };
      });
      if (created instanceof Error) throw created;
      check("broadcast created for exactly 2", created.recipient_count === 2, created);

      const queued = (
        await tx`select phone_e164 from public.sms_deliveries where broadcast_id = ${created.broadcast_id}`
      ).map((r) => r.phone_e164 as string);
      check("queued rows are A and C only", queued.length === 2 && queued.includes(A) && queued.includes(C), queued);

      // Between enqueue and send: C is removed from the roster, A replies STOP.
      await tx`delete from public.hacklanta_sms_recipients where phone_e164 = ${C}`;
      await tx`insert into public.sms_suppressions (phone_e164, reason, note) values (${A}, 'stop_keyword', 'stop after send')`;
      await tx`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
      await tx`set local role service_role`;
      const claimed = await tx`select * from public.claim_sms_deliveries(10)`;
      await tx`reset role`;
      check("claim returns nobody once both left", claimed.length === 0, claimed);
      const st = Object.fromEntries(
        (await tx`select phone_e164, status from public.sms_deliveries where broadcast_id = ${created.broadcast_id}`).map(
          (r) => [r.phone_e164, r.status]
        )
      );
      check("A closed out as suppressed", st[A] === "suppressed", st);
      check("C closed out as skipped", st[C] === "skipped", st);

      // Happy path: a still-valid recipient IS handed to the worker.
      const D = "+12025550104";
      await tx`update public.sms_broadcasts set status = 'cancelled' where id = ${created.broadcast_id}`;
      await tx`insert into public.hacklanta_sms_recipients (phone_e164) values (${D})`;
      const c2 = await asAdmin(async () => {
        const [r] = await tx`select public.create_sms_broadcast(${body}, 'hacklanta_accepted', 1) as r`;
        return r.r as { broadcast_id: string };
      });
      if (c2 instanceof Error) throw c2;
      await tx`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
      await tx`set local role service_role`;
      const claimed2 = await tx`select * from public.claim_sms_deliveries(10)`;
      await tx`reset role`;
      check("valid recipient is claimed for sending", claimed2.length === 1 && claimed2[0].to_phone === D, claimed2);

      // Batching: only emailed people, and nobody texted twice across batches.
      await tx`update public.sms_broadcasts set status = 'done' where id = ${c2.broadcast_id}`;
      await tx`update public.sms_deliveries set status = 'delivered' where phone_e164 = ${D}`;
      const E = "+12025550105"; // emailed
      const F = "+12025550106"; // not emailed yet
      await tx`insert into public.hacklanta_sms_recipients (phone_e164, email_sent_at) values (${E}, now()), (${F}, null)`;
      await tx`update public.hacklanta_sms_recipients set email_sent_at = now() where phone_e164 = ${D}`;
      const emailed = (await tx`select n from public.sms_audience_numbers('hacklanta_emailed') n`).map((r) => r.n as string);
      check("emailed audience = emailed and not yet texted", emailed.length === 1 && emailed[0] === E, emailed);
      const accepted = (await tx`select n from public.sms_audience_numbers('hacklanta_accepted') n`).map((r) => r.n as string);
      check("accepted audience also skips already-texted D", !accepted.includes(D) && accepted.includes(E) && accepted.includes(F), accepted);

      const b1 = await asAdmin(async () => {
        const [r] = await tx`select public.create_sms_broadcast(${body}, 'hacklanta_emailed', 1) as r`;
        return r.r as { broadcast_id: string };
      });
      if (b1 instanceof Error) throw b1;
      const busy2 = await asAdmin(() => tx`select public.create_sms_broadcast(${body}, 'hacklanta_accepted', 2)`);
      check("second Hacklanta send refused while one is sending", busy2 instanceof Error && /still sending/.test(busy2.message), busy2);
      await tx`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
      await tx`set local role service_role`;
      const cb1 = await tx`select * from public.claim_sms_deliveries(10)`;
      await tx`reset role`;
      check("batch 1 claims E", cb1.length === 1 && cb1[0].to_phone === E, cb1);
      await tx`update public.sms_deliveries set status = 'sent' where broadcast_id = ${b1.broadcast_id}`;
      await tx`update public.sms_broadcasts set status = 'done' where id = ${b1.broadcast_id}`;

      // F's email goes out later: batch 2 is F only.
      await tx`update public.hacklanta_sms_recipients set email_sent_at = now() where phone_e164 = ${F}`;
      const next = (await tx`select n from public.sms_audience_numbers('hacklanta_emailed') n`).map((r) => r.n as string);
      check("batch 2 is only the newly emailed F", next.length === 1 && next[0] === F, next);

      // Race: F gets texted by another broadcast after batch 2 was queued.
      const b2 = await asAdmin(async () => {
        const [r] = await tx`select public.create_sms_broadcast(${body}, 'hacklanta_emailed', 1) as r`;
        return r.r as { broadcast_id: string };
      });
      if (b2 instanceof Error) throw b2;
      const [other] = await tx`insert into public.sms_broadcasts (body, audience, status) values ('x STOP', 'hacklanta_accepted', 'done') returning id`;
      await tx`insert into public.sms_deliveries (broadcast_id, phone_e164, status) values (${other.id}, ${F}, 'sent')`;
      await tx`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
      await tx`set local role service_role`;
      const cb2 = await tx`select * from public.claim_sms_deliveries(10)`;
      await tx`reset role`;
      const [f2] = await tx`select status from public.sms_deliveries where broadcast_id = ${b2.broadcast_id}`;
      check("send-time recheck skips someone texted meanwhile", cb2.length === 0 && f2.status === "skipped", { cb2, f2 });

      const ov = await asAdmin(async () => (await tx`select public.admin_sms_overview() as o`)[0].o);
      if (ov instanceof Error) throw ov;
      check("overview exposes both Hacklanta audiences", typeof ov.audiences.hacklanta_accepted === "number" && typeof ov.audiences.hacklanta_emailed === "number", ov.audiences);

      const [rls] = await tx`
        select relrowsecurity as rls from pg_class where oid = 'public.hacklanta_sms_recipients'::regclass`;
      check("recipients table has RLS on", rls.rls === true);
      const [grants] = await tx`
        select count(*)::int as n from information_schema.role_table_grants
         where table_name = 'hacklanta_sms_recipients' and grantee in ('anon','authenticated')`;
      check("recipients table has no anon/authenticated grants", grants.n === 0, grants);

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) {
      failed += 1;
      console.error("ERROR:", e instanceof Error ? e.message : e);
    }
  } finally {
    await sql.end();
  }
  console.log(failed === 0 ? "\nALL PASS (rolled back, nothing committed)" : `\n${failed} FAILED (rolled back)`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
