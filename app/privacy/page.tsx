import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · Progsu",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Draft · v7
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">
          Last reviewed: pre-launch. This draft needs attorney sign-off before
          any external recruiter export ships.
        </p>
      </header>

      <article className="prose prose-sm max-w-none space-y-4 text-sm leading-6">
        <h2 className="text-lg font-semibold">Who we are</h2>
        <p>
          Progsu is a programming and builders community at Georgia State
          University. The Progsu member platform is operated by Progsu
          leadership as a student organization, not by GSU itself.
        </p>

        <h2 className="text-lg font-semibold">What we collect</h2>
        <p>When you sign up, we collect:</p>
        <ul className="list-disc pl-6">
          <li>Your Google identity (email, name, avatar) for login.</li>
          <li>A student email at an allowlisted school domain, which we verify with a 6-digit code.</li>
          <li>Profile information you enter: name, school, major, class standing, graduation term, and up to six role interests.</li>
          <li>Optional contact info: phone, LinkedIn, GitHub, portfolio URL.</li>
          <li>Your resume PDF, if you upload one.</li>
          <li>Your consent choices (privacy, terms, age, recruiter sharing, email, SMS), with version and timestamp.</li>
          <li>Your event activity: RSVPs, waitlist entries, and check-ins for events you choose to engage with.</li>
        </ul>
        <p>We do not collect date of birth, SSN, home address, GPA, gender, or race.</p>

        <h2 className="text-lg font-semibold">How we use it</h2>
        <ul className="list-disc pl-6">
          <li>To run your member account.</li>
          <li>To let Progsu admins help you with problems (e.g. manual verification).</li>
          <li>To share with sponsors and recruiters Progsu works with — only if you toggle &quot;open to recruiters&quot; AND accept the recruiter-sharing consent.</li>
          <li>To operate events you participate in — RSVP confirmations, reminders, and cancellations (see Events below).</li>
          <li>To send marketing event and opportunity emails or text messages, if you opt in separately.</li>
        </ul>

        <h2 className="text-lg font-semibold">
          If you register for an event without an account
        </h2>
        <p>
          New in v6: you can RSVP to a Progsu event as a guest, without signing
          up. When you do, we store the name, email, and phone number you enter
          so we can send you the event details and check you in at the door.
        </p>
        <p>
          After registering you may be asked three optional questions — your
          major, when you graduate, and what kind of work you are looking for.
          Answering is entirely optional and skipping costs you nothing; your
          RSVP is already complete before we ask. If you later sign in with the
          same email address, those answers are copied onto your member profile
          so you do not have to type them twice.
        </p>
        <p>
          Guest registrations are visible to Progsu admins running the event.
          They are not shown to other members, and guests do not appear on the
          public attendee list on an event page.
        </p>

        <h2 className="text-lg font-semibold">Text messages</h2>
        <p>
          We only text you if you tick the SMS box yourself. It is never
          pre-ticked, and your RSVP, ticket, and event emails all work exactly
          the same whether you tick it or not.
        </p>
        <p className="font-medium">
          We do not sell, rent, or share mobile opt-in data or consent with
          anyone for their own marketing. Your phone number and the fact that
          you opted in stay with Progsu.
        </p>
        <p>
          Message frequency varies. Message and data rates may apply. Reply
          STOP to any message to stop receiving them, or HELP for help. A STOP
          applies to your number permanently and overrides every consent we
          hold — including one given on a different form or at a different
          event.
        </p>

        <h2 className="text-lg font-semibold">Events</h2>
        <p>
          When you RSVP to a Progsu event, we store your RSVP status, any
          waitlist position, and whether you checked in. Admins running the
          event can see this roster so they can manage capacity, run
          check-in, and follow up with attendees.
        </p>
        <p>
          If you RSVP &quot;going&quot; to an event, you may receive a small number
          of operational emails related to that specific event:
        </p>
        <ul className="list-disc pl-6">
          <li>An RSVP confirmation when you sign up.</li>
          <li>A reminder before the event starts.</li>
          <li>A cancellation or reschedule notice if the event changes.</li>
        </ul>
        <p>
          These are transactional emails tied to your participation. They are
          separate from the marketing email setting in your{" "}
          <Link href="/profile/settings" className="text-primary underline underline-offset-4">
            dashboard settings
          </Link>
          , and turning marketing email off does <em>not</em> silence event
          operational mail — the only way to stop those is to cancel your RSVP
          or skip the event.
        </p>
        <p>
          Other members do not see your event activity by default. The
          member-directory section below explains the opt-in path that makes
          some of your profile and event history visible to peers.
        </p>

        <h2 className="text-lg font-semibold">Member directory and profile visibility</h2>
        <p>
          You can opt into a peer-visible member directory from your{" "}
          <Link href="/profile/settings/visibility" className="text-primary underline underline-offset-4">
            settings
          </Link>
          . When it&apos;s on, other Progsu members can visit{" "}
          <span className="font-mono text-xs">progsu.app/members/&lt;your-slug&gt;</span>{" "}
          and see a sanitized view of your profile.
        </p>
        <p>
          Accounts created on or after 20 August 2026 start with directory
          visibility on, and can turn it off at any time in the same settings
          page. Accounts created before that date keep whatever they had
          already chosen; we did not switch anyone on.
        </p>
        <p className="font-medium">Fields visible to other members:</p>
        <ul className="list-disc pl-6">
          <li>Your name (preferred name, or first name if none).</li>
          <li>Your avatar, whether from Google or uploaded by you.</li>
          <li>
            New in v4: your profile banner image, and your note — the short
            status line shown above your avatar. Both are optional, both are
            written by you, and neither is reviewed before other members see
            it, so treat them as public writing.
          </li>
          <li>Your one-line bio.</li>
          <li>School, class standing, and graduation term.</li>
          <li>Up to six interested roles.</li>
          <li>
            Your LinkedIn, GitHub, and portfolio links, and your Discord
            username, when you have added them.
          </li>
          <li>
            Optional: events you attended — only public, non-sensitive events
            with at least a handful of attendees. Private-invite events are
            never shown. You can turn this on or off separately.
          </li>
        </ul>
        <p className="font-medium">Fields never visible to other members:</p>
        <ul className="list-disc pl-6">
          <li>Email addresses (Google or student).</li>
          <li>Phone number.</li>
          <li>Resume content or file path.</li>
          <li>Consent history or verification status.</li>
          <li>Admin status.</li>
          <li>Major and minor.</li>
        </ul>
        <p>
          Progsu admins can still see full profile data regardless of your
          directory setting. Every time another member views your card we
          record an audit row so admins can investigate suspicious patterns.
          Turning off visibility hides your card from the directory and from
          peer URL lookups immediately; previously-recorded audit rows are
          retained.
        </p>

        <h2 className="text-lg font-semibold">
          Who can see that you are going to an event
        </h2>
        <p>
          New in v5: event pages show the people who are going. If your
          directory visibility is on, your name and avatar can appear in that
          group, and your face links to your member card.
        </p>
        <p>
          Event pages are public, so this group is visible to anyone with the
          link, not only to signed-in members. This is the one place your
          directory profile is shown to people outside Progsu, and it is worth
          reading twice before you leave visibility on:
        </p>
        <ul className="list-disc pl-6">
          <li>
            It shows the same name and avatar the member directory already
            shows. No new field about you becomes visible.
          </li>
          <li>
            What is new is the link between you and a specific event — that you
            are going, or that you attended.
          </li>
          <li>
            Only a handful of faces are shown; everyone else is part of the
            total count, unnamed.
          </li>
          <li>
            Draft, cancelled, and private-invite events never show an attendee
            list to anyone who could not already see the event.
          </li>
        </ul>
        <p>
          Turning off directory visibility in your settings removes you from
          this group immediately, on past and upcoming events alike. You stay
          in the total count, because the count is just a number of people. If
          you would rather RSVP without appearing anywhere, turn visibility off
          before you RSVP.
        </p>
        <p>
          Attendees from events we ran before this platform existed are
          included in the total count only. We imported those guest lists from
          our previous event tool; those people never created an account here
          and are never named on an event page.
        </p>

        <h2 className="text-lg font-semibold">
          RSVP announcements in our Discord
        </h2>
        <p>
          New in v7: when you RSVP to an event, we post a short announcement in
          the Progsu Discord server. It names you by first name and last
          initial &mdash; &quot;Natasha K.&quot; &mdash; along with the event
          you are going to and how many people are going in total.
        </p>
        <p>
          Everyone in the Progsu Discord can read that channel. This is a
          different audience from the rest of the platform, so it is worth
          being specific about what is and is not in it:
        </p>
        <ul className="list-disc pl-6">
          <li>
            Your full last name, email address, phone number, and profile
            details are never posted. Neither is your avatar.
          </li>
          <li>
            Events marked sensitive, private-invite events, and unpublished
            drafts are never announced at all, to anyone.
          </li>
          <li>
            If you registered as a guest without an account, the same rule
            applies to you: first name and last initial, nothing else you
            typed into the form.
          </li>
          <li>
            We post when you RSVP, when you land on a waitlist, and when you
            cancel an RSVP you had. We do not post anything else about you.
          </li>
        </ul>
        <p>
          <strong>Campaign links.</strong> If you reached the event through one
          of our short links &mdash; a QR code on a flyer, a link in a class
          announcement &mdash; the announcement also names which one. This is
          the only place we connect a person to the campaign that reached them.
          Our database deliberately does not store that connection: it counts
          how many people a flyer brought, and it has nowhere to record which
          people. The Discord announcement is the exception, it is not written
          down anywhere else, and it exists so that whoever put up the poster
          knows it worked.
        </p>
        <p>
          If you would rather not appear in that channel, tell a Progsu officer
          and we will stop announcing your RSVPs. There is no toggle for this
          in your settings yet.
        </p>

        <h2 className="text-lg font-semibold">Shared event history with other members</h2>
        <p>
          There is a separate opt-in toggle for showing events you and another
          member both attended. When you and another member have <em>both</em>{" "}
          turned it on, each of you can see:
        </p>
        <ul className="list-disc pl-6">
          <li>
            A count of events you both attended that meet our anonymity
            threshold (enough other attendees were present that knowing
            you were both there doesn&apos;t narrow the field).
          </li>
          <li>
            The names of specific events — but only if the event was public,
            non-sensitive, and cleared the same threshold.
          </li>
        </ul>
        <p>
          &quot;Attended&quot; means you both actually checked in, not just
          that you RSVP&apos;d yes. Private-invite events are never included,
          even in the aggregate count. Events marked sensitive by an admin
          are never shown by name.
        </p>
        <p>
          We record an audit row each time another member views your shared
          event history. Turning the toggle off hides future views; audit
          rows of past views are retained so admins can investigate abuse.
        </p>

        <h2 className="text-lg font-semibold">Recruiter sharing</h2>
        <p>
          If you opt in, the recruiter CSV can include your name, preferred name,
          google email, student email, phone, school, major, minor, class
          standing, graduation term, role interests, LinkedIn/GitHub/portfolio
          links, and a 15-minute signed link to your current resume.
        </p>
        <p>
          We do not sell your data. You can withdraw consent at any time from
          your{" "}
          <Link href="/profile/settings" className="text-primary underline underline-offset-4">
            dashboard settings
          </Link>
          . CSVs already downloaded before you withdraw remain out of our reach
          — regenerating the export will exclude you immediately.
        </p>

        <h2 className="text-lg font-semibold">How we protect it</h2>
        <ul className="list-disc pl-6">
          <li>All data is stored in Supabase Postgres with row-level security policies denying cross-user reads.</li>
          <li>Resumes live in a private storage bucket; download links are short-lived signed URLs.</li>
          <li>Admin exports are recorded in an audit log with the acting admin, the export ID, and row count.</li>
          <li>OTP codes are hashed (bcrypt) before storage and never logged.</li>
        </ul>

        <h2 className="text-lg font-semibold">Retention and deletion</h2>
        <p>
          We keep your data while you&apos;re an active member. If you request
          deletion, Progsu will process it within 30 days. Consent rows are
          retained (with name and email redacted) so we can prove what you
          agreed to at what time.
        </p>

        <h2 className="text-lg font-semibold">Your rights</h2>
        <p>
          You can view, edit, or ask to delete your data by emailing Progsu
          leadership or using the settings page. If you&apos;re in a jurisdiction
          with stronger rights (GDPR, CCPA), we will honor them even though our
          users are primarily in Georgia, USA.
        </p>

        <h2 className="text-lg font-semibold">Changes to this policy</h2>
        <p>
          If we make a material change, we&apos;ll prompt you to re-accept the new
          version the next time you sign in. Minor cleanups are applied silently
          with a new version number.
        </p>

        <h2 className="text-lg font-semibold">Contact</h2>
        <p>
          Email Progsu leadership at{" "}
          <span className="font-mono text-xs">hello@progsu.org</span> with any
          privacy questions.
        </p>
      </article>
    </main>
  );
}
