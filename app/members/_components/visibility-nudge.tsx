"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye } from "lucide-react";

import { setProfileVisibility } from "@/lib/actions/members";

// Shown only while the viewer is hidden from the directory. One click turns
// visibility on and the row disappears for good — the old copy sent people to
// a settings page to do the same thing, which is a detour nobody took.
export function VisibilityNudge() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hidden) return null;

  function turnOn() {
    setError(null);
    startTransition(async () => {
      const result = await setProfileVisibility({ discoverable: true });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setHidden(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-primary/25 bg-primary/[0.07] px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          You&apos;re not in the directory
        </p>
        <p className="text-sm text-muted-foreground">
          Other members can&apos;t find you here, and you won&apos;t show up
          when they search.
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={turnOn}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
      >
        <Eye size={15} strokeWidth={2} aria-hidden />
        {pending ? "Turning on…" : "Show me in the directory"}
      </button>
    </div>
  );
}
