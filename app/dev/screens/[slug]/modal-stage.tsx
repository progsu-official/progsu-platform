"use client";

import { useEffect, useState } from "react";

import { ThemeShell } from "@/app/_components/theme-shell";
import { GuestRsvpModal } from "@/app/events/[slug]/_components/guest-rsvp-modal";

// The guest modal portals into <body> and reads useTheme(), which throws
// outside a ThemeShell, so it gets a real one here rather than a stub. Keeping
// the actual provider means the dark variant is reachable from this page too,
// which a mock would have quietly removed.
//
// The collision state is normally reached by submitting details that match a
// member. `forceAccountExists` lets it be looked at without a database.
export function ModalStage({ variant }: { variant: "form" | "collision" }) {
  const [open, setOpen] = useState(true);
  // The modal portals into document.body, so it cannot render on the server.
  // In the app it only ever mounts after a click, which is why this never
  // came up there. Hold it until after hydration rather than teaching the
  // production component about a case it does not have.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ThemeShell initialTheme="light">
      <div className="flex min-h-dvh items-center justify-center px-5">
        {open && mounted ? (
          <GuestRsvpModal
            eventId="00000000-0000-0000-0000-000000000000"
            capacityReached={false}
            waitlistEnabled
            onClose={() => setOpen(false)}
            onSuccess={() => {}}
            forceAccountExists={variant === "collision"}
          />
        ) : mounted ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Reopen the modal
          </button>
        ) : null}
      </div>
    </ThemeShell>
  );
}
