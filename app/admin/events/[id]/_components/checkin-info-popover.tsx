"use client";

import { Info } from "lucide-react";

import { Popover } from "@/app/admin/events/_composer/_components/popover";

// Self-contained: the parent event page is a Server Component and can't
// pass the Popover's render-prop functions across that boundary directly
// (functions aren't serializable). Rendering the whole trigger+panel here
// keeps everything on the client side of that boundary.
export function CheckInInfoPopover() {
  return (
    <Popover
      align="end"
      trigger={({ props, ref }) => (
        <button
          ref={ref}
          type="button"
          {...props}
          aria-label="How day-of check-in works"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-input text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
        >
          <Info size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      panelClassName="w-72 border-border bg-popover p-4 text-sm text-foreground shadow-xl"
    >
      {() => (
        <p className="text-sm text-muted-foreground">
          Opens a camera right here to scan each attendee&apos;s personal QR
          code and checks them in instantly — no app needed, any phone or
          laptop with a camera works. Can&apos;t scan? Use the Members tab to
          check someone in manually by name.
        </p>
      )}
    </Popover>
  );
}
