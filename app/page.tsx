import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="dark relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <AmbientGlow />

      <div className="relative flex max-w-xl animate-fade-up flex-col items-center gap-6 text-center">
        <p className="text-sm font-bold tracking-tight text-muted-foreground">
          progsu
        </p>
        <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl">
          Where GSU builders meet.
        </h1>
        <p className="max-w-md text-balance text-lg text-muted-foreground">
          Events, people, and opportunities for the builder community at
          Georgia State.
        </p>
        <Button asChild size="lg" className="mt-2 h-12 rounded-full px-8 text-base">
          <Link href="/login">Continue with Google</Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Members only · You&apos;ll verify your student email after signing in
        </p>
      </div>
    </main>
  );
}

// Soft color wash behind the hero — echoes the event pages' ambient covers.
function AmbientGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-56 left-1/4 h-[420px] w-[560px] rounded-full bg-fuchsia-500/10 blur-3xl" />
      <div className="absolute -right-40 top-1/3 h-[360px] w-[480px] rounded-full bg-indigo-500/10 blur-3xl" />
    </div>
  );
}
