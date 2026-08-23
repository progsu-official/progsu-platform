export const metadata = {
  title: "Terms of Service · Progsu",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Draft · v1
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">
          Draft. Needs attorney sign-off before launch.
        </p>
      </header>

      <article className="prose prose-sm max-w-none space-y-4 text-sm leading-6">
        <h2 className="text-lg font-semibold">Who can use Progsu</h2>
        <p>
          The Progsu member platform is for students 18 or older at an
          allowlisted school. If you&apos;re under 18 or not a student, please
          don&apos;t sign up. Admins may remove accounts that don&apos;t meet
          these criteria.
        </p>

        <h2 className="text-lg font-semibold">Your account</h2>
        <p>
          You&apos;re responsible for keeping your Google login secure and for
          the accuracy of the information on your profile. Don&apos;t create
          more than one account; don&apos;t impersonate anyone else.
        </p>

        <h2 className="text-lg font-semibold">Content you upload</h2>
        <p>
          Your resume and profile belong to you. By uploading content, you give
          Progsu permission to store it and, if you separately opt in, share it
          with recruiters we work with. You can remove content at any time from
          your dashboard.
        </p>

        <h2 className="text-lg font-semibold">Acceptable use</h2>
        <p>
          Don&apos;t upload malware, illegal content, or anyone else&apos;s
          resume. Don&apos;t try to access other members&apos; data, scrape the
          platform, or bypass rate limits.
        </p>

        <h2 className="text-lg font-semibold">Recruiter sharing</h2>
        <p>
          Being included in a recruiter export requires two separate opt-ins on
          your dashboard: &quot;open to recruiters&quot; plus the
          recruiter-resume-sharing consent. Turning either off removes you from
          future exports.
        </p>

        <h2 className="text-lg font-semibold">Text messages</h2>
        <p>
          If you opt in to text messages, you agree to receive event-related
          SMS from Progsu at the number you provided. Message frequency
          varies. Message and data rates may apply. Reply STOP to cancel or
          HELP for help. Carriers are not liable for delayed or undelivered
          messages. Opting out of texts does not affect your membership, your
          RSVPs, or the emails you receive.
        </p>

        <h2 className="text-lg font-semibold">Service availability</h2>
        <p>
          Progsu is run by volunteers. We&apos;ll do our best to keep it up, but
          we don&apos;t offer an uptime guarantee or a paid SLA.
        </p>

        <h2 className="text-lg font-semibold">Termination</h2>
        <p>
          Either party can end this agreement at any time. If Progsu ends your
          account, we&apos;ll tell you why and, if you disagree, you can ask for
          review.
        </p>

        <h2 className="text-lg font-semibold">Disclaimers and limits</h2>
        <p>
          Progsu provides the platform &quot;as is&quot; without warranties. To
          the extent allowed by law, our liability is limited to the amount
          you&apos;ve paid to use Progsu (which, for students, is usually $0).
        </p>

        <h2 className="text-lg font-semibold">Changes</h2>
        <p>
          When we make a material change to these terms, we&apos;ll prompt you
          to re-accept the new version before you continue using Progsu.
        </p>
      </article>
    </main>
  );
}
