"use client";

import { useState } from "react";
import { QrCode, X } from "lucide-react";

import { QrScanner } from "./qr-scanner";

// Replaces the old separate /admin/events/[id]/check-in page — that page's
// roster+manual-check-in half duplicated the Members tab, so scanning now
// opens right here instead of navigating away. See guests-tab.tsx (still
// internally named "guests", displayed as "Members") for the manual
// fallback.
export function ScanQrButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        <QrCode size={18} strokeWidth={1.75} aria-hidden />
        Scan QR code
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scan QR code"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="relative w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
            >
              <X size={18} aria-hidden />
            </button>
            <QrScanner eventId={eventId} />
          </div>
        </div>
      ) : null}
    </>
  );
}
