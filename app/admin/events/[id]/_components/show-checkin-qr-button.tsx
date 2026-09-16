"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, QrCode, X } from "lucide-react";

// D14: self-serve event QR, additive to the staff-scans-attendee flow
// (ScanQrButton in this same header). qrDataUrl is generated server-side in
// page.tsx (same `qrcode` package + settings as the personal/ticket QRs) so
// this component stays a plain client island, no QR library in this bundle.
export function ShowCheckinQrButton({
  qrDataUrl,
  eventTitle,
  // Admin header row (fixed-width icons in a shrink-0 row) needs the default
  // content-sized button; /checkin's mobile-stacked header needs it full-width
  // below sm. Caller opts in instead of this component guessing its context.
  triggerClassName = "",
}: {
  qrDataUrl: string;
  eventTitle: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [open]);

  async function toggleFullscreen() {
    if (!dialogRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await dialogRef.current.requestFullscreen();
    }
  }

  function close() {
    if (document.fullscreenElement) void document.exitFullscreen();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-full border border-border px-5 py-2.5 text-base font-semibold text-foreground shadow-sm transition-colors hover:bg-accent/10 ${triggerClassName}`}
      >
        <QrCode size={18} strokeWidth={1.75} aria-hidden />
        Show check-in QR
      </button>

      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Event check-in QR code"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black p-6"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={22} aria-hidden />
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            {fullscreen ? (
              <Minimize size={16} aria-hidden />
            ) : (
              <Maximize size={16} aria-hidden />
            )}
            {fullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>

          <p className="text-center text-lg font-semibold text-white">
            {eventTitle}
          </p>
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Scan to check in"
              className="h-auto w-full rounded-md"
            />
          </div>
          <p className="text-center text-sm text-white/70">
            Scan with your phone camera to check in
          </p>
        </div>
      ) : null}
    </>
  );
}
