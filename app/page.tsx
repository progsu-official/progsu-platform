import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">Progsu</h1>
      <p className="max-w-prose text-center text-muted-foreground">
        The member platform for builders at GSU.
      </p>
      <Button asChild size="lg">
        <Link href="/login">Continue with Google</Link>
      </Button>
    </main>
  );
}
