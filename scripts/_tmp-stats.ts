import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.SUPABASE_DB_URL!, { prepare: false, max: 1 });
  const W = "14 days";
  try {
    console.log(`\n=== WINDOW: last ${W} (since ${new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)}) ===`);

    // --- Door 1: guest RSVPs (no account at the time) -----------------------
    const guests = await sql`
      with g as (
        select lower(trim(email)) as email, max(phone) as phone, min(created_at) as first_seen
        from event_guest_rsvps
        where created_at >= now() - ${W}::interval
        group by lower(trim(email))
      )
      select
        count(*)::int as people,
        count(*) filter (where phone is not null and phone <> '')::int as with_phone,
        count(*) filter (where exists (
          select 1 from profiles p
          where lower(p.google_email) = g.email or lower(p.student_email) = g.email
        ))::int as now_have_account
      from g`;
    console.log("\n-- Guest RSVPs (unique people by email) --");
    console.table(guests);

    // --- Door 2: new accounts ----------------------------------------------
    const accounts = await sql`
      select
        count(*)::int as new_accounts,
        count(*) filter (where public.is_fully_onboarded(p.id))::int as fully_onboarded,
        count(*) filter (where p.profile_completed)::int as profile_completed,
        count(*) filter (where p.phone_e164 is not null)::int as has_phone,
        count(*) filter (where p.student_email_verified)::int as student_verified
      from profiles p
      where p.created_at >= now() - ${W}::interval and p.is_archived = false`;
    console.log("\n-- New accounts --");
    console.table(accounts);

    // How many of those new accounts arrived through a guest RSVP
    const converted = await sql`
      select count(distinct p.id)::int as from_guest_rsvp
      from profiles p
      where p.created_at >= now() - ${W}::interval and p.is_archived = false
        and (
          exists (select 1 from event_guest_rsvps g
                   where lower(trim(g.email)) in (lower(p.google_email), lower(p.student_email)))
          or exists (select 1 from legacy_members lm where lm.claimed_profile_id = p.id)
        )`;
    console.log("new accounts traceable to a guest RSVP / legacy row:", converted[0].from_guest_rsvp);

    // --- Where the new accounts stall --------------------------------------
    console.log("\n-- Where incomplete accounts stall --");
    console.table(await sql`
      select
        count(*) filter (where not p.profile_completed)::int as profile_unfinished,
        count(*) filter (where p.profile_completed and not public.is_fully_onboarded(p.id))::int as profile_done_but_not_onboarded,
        count(*) filter (where p.phone_e164 is null)::int as no_phone
      from profiles p
      where p.created_at >= now() - ${W}::interval and p.is_archived = false`);

    // --- Phones -------------------------------------------------------------
    console.log("\n-- New phone numbers --");
    console.table(await sql`
      select
        (select count(*) from profiles
          where created_at >= now() - ${W}::interval and phone_e164 is not null and is_archived = false)::int as member_phones,
        (select count(distinct phone_e164) from legacy_members
          where answered_at >= now() - ${W}::interval and phone_e164 is not null)::int as guest_phones,
        (select count(distinct lower(trim(phone))) from event_guest_rsvps
          where created_at >= now() - ${W}::interval and phone is not null and phone <> '')::int as guest_rsvp_phones_raw`);

    // --- SMS opt-ins --------------------------------------------------------
    console.log("\n-- SMS opt-ins --");
    console.table(await sql`
      select
        (select count(distinct user_id) from consents
          where consent_type='sms_marketing' and accepted
            and accepted_at >= now() - ${W}::interval)::int as member_sms_optins_in_window,
        (select count(*) from legacy_members
          where sms_consent_at >= now() - ${W}::interval)::int as guest_sms_optins_in_window,
        (select count(distinct user_id) from consents
          where consent_type='sms_marketing' and accepted)::int as member_sms_optins_all_time,
        (select count(*) from legacy_members where sms_consent_at is not null)::int as guest_sms_optins_all_time`);

    // Of the NEW accounts specifically, how many opted into SMS
    console.log("\n-- SMS among the new accounts --");
    console.table(await sql`
      select
        count(*)::int as new_accounts,
        count(*) filter (where p.phone_e164 is not null)::int as gave_phone,
        count(*) filter (where exists (
          select 1 from consents c where c.user_id = p.id
            and c.consent_type='sms_marketing' and c.accepted))::int as opted_into_sms
      from profiles p
      where p.created_at >= now() - ${W}::interval and p.is_archived = false`);
  } finally { await sql.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
