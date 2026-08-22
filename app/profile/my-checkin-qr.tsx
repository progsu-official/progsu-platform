import QRCode from "qrcode";

import { RegenerateCheckinCodeButton } from "./regenerate-checkin-code-button";

// Personal check-in QR: a stable per-profile code (profiles.checkin_code),
// distinct from the per-event ticket token in ./upcoming-events's
// event-ticket. Works at any event, including a walk-in with no RSVP —
// staff scan it from /admin/events/[id] and the event comes from the page
// they're on, not the code itself.
export async function MyCheckinQr({ code }: { code: string }) {
  const qrDataUrl = await QRCode.toDataURL(code, {
    errorCorrectionLevel: "H",
    margin: 0,
    width: 320,
    color: { dark: "#18181b", light: "#ffffff" },
  });

  return (
    <div className="space-y-3 rounded-2xl glass p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        My check-in QR
      </h2>
      <div className="mx-auto max-w-[200px] rounded-xl bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt="Your personal check-in QR code"
          className="h-auto w-full rounded-md"
        />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Show this at any event. Staff scan it to check you in, no RSVP needed.
      </p>
      <div className="flex justify-center">
        <RegenerateCheckinCodeButton />
      </div>
    </div>
  );
}
