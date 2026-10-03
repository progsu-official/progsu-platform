import Link from "next/link";

export const metadata = {
  title: "Support · progsu",
};

const linkClass = "text-primary underline underline-offset-4";

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
        <p className="text-sm text-muted-foreground">
          Help for the progsu member platform and the progsu iOS app.
        </p>
      </header>

      <article className="prose prose-sm max-w-none space-y-4 text-sm leading-6">
        <h2 className="text-lg font-semibold">Contact us</h2>
        <p>
          Email progsu leadership at{" "}
          <a href="mailto:hello@progsu.com" className={linkClass}>
            hello@progsu.com
          </a>
          . Include the email address you sign in with and, for app problems,
          your iPhone model and iOS version. We are a student organization, so
          replies usually take a few days.
        </p>

        <h2 className="text-lg font-semibold">Signing in</h2>
        <p>
          You can sign in with Apple or Google. If you used &quot;Hide My
          Email&quot; with Apple, your account is tied to the relay address
          Apple created, so signing in with Google later creates a separate
          account. Tell us if that happens and we can help.
        </p>

        <h2 className="text-lg font-semibold">Event check-in</h2>
        <p>
          Your check-in code is under My QR in the app. Show it to event staff
          at the door; the screen brightens automatically while it is open. If
          the code will not scan, staff can type the 8-character short code
          shown below it.
        </p>

        <h2 className="text-lg font-semibold">Notifications</h2>
        <p>
          The app only asks for notification permission when you turn it on in
          the app&apos;s Settings. You can turn notifications off at any time
          in iOS Settings, Progsu, Notifications.
        </p>

        <h2 className="text-lg font-semibold">Deleting your account</h2>
        <p>In the iOS app:</p>
        <ol className="list-decimal pl-6">
          <li>Open the Profile tab and go to Settings.</li>
          <li>Tap &quot;Delete my account&quot;.</li>
          <li>Type DELETE to confirm and tap &quot;Delete my account&quot;.</li>
        </ol>
        <p>
          Deletion is permanent and happens immediately. It removes your
          profile, RSVPs, check-in history, points, uploaded files, push
          tokens, and Hacklanta link, and revokes Sign in with Apple access if
          you used it. If you do not use the app, email{" "}
          <a href="mailto:hello@progsu.com" className={linkClass}>
            hello@progsu.com
          </a>{" "}
          from the address on your account and we will delete it within 30
          days. The{" "}
          <Link href="/privacy" className={linkClass}>
            privacy policy
          </Link>{" "}
          lists exactly what is deleted and what is kept.
        </p>

        <h2 className="text-lg font-semibold">Policies</h2>
        <ul className="list-disc pl-6">
          <li>
            <Link href="/privacy" className={linkClass}>
              Privacy policy
            </Link>
          </li>
          <li>
            <Link href="/terms" className={linkClass}>
              Terms of service
            </Link>
          </li>
        </ul>
      </article>
    </main>
  );
}
