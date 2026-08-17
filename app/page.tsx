import Link from "next/link";

import { GoogleSignInButton } from "@/app/login/google-sign-in-button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">Progsu</h1>
      <p className="max-w-prose text-center text-muted-foreground">
        The member platform for builders at GSU.
      </p>
      <div className="w-full max-w-xs">
        <GoogleSignInButton />
      </div>
      {process.env.NODE_ENV !== "production" ? (
        <div className="flex gap-3 text-xs text-muted-foreground">
          <Link href="/api/dev-login?role=member" className="underline">
            Dev bypass: member
          </Link>
          <Link href="/api/dev-login?role=admin" className="underline">
            Dev bypass: admin
          </Link>
        </div>
      ) : null}
    </main>
  );
}
