import QRCode from "qrcode";

// D12/§7.5: the member's personal event ticket. The QR encodes their
// per-RSVP checkin_token (unique per attendee, minted by the DB trigger when
// status enters `going`); staff scan it inline from /admin/events/[id].
// Rendered whenever the RSVP is `going` — redemption is admin-gated
// server-side, so showing the pass early costs nothing and gives members a
// keepsake object, Luma-style.

type Colorway = {
  // Ticket surface.
  gradient: string;
  // True when the surface is light enough to need dark ink.
  darkInk: boolean;
};

// Curated colorways; each event deterministically gets one (hash of id), so
// a ticket's look is stable across visits and differs across events.
const COLORWAYS: Colorway[] = [
  {
    // Mint → periwinkle → lilac → pink. The pastel ticket in the reference.
    gradient:
      "linear-gradient(160deg, #a9e9e1 0%, #c5d9f1 32%, #e5d2ef 58%, #f6c3dc 100%)",
    darkInk: true,
  },
  {
    // Deep indigo → violet → plum.
    gradient:
      "linear-gradient(160deg, #23105a 0%, #47189b 42%, #6b1cba 68%, #8f2a88 100%)",
    darkInk: false,
  },
  {
    // Wine → crimson → sunset ember.
    gradient:
      "linear-gradient(160deg, #3d1024 0%, #7a1e3c 45%, #c2452e 82%, #e8823c 100%)",
    darkInk: false,
  },
  {
    // Midnight teal → lagoon.
    gradient:
      "linear-gradient(160deg, #04263a 0%, #0a4d68 45%, #0e7490 74%, #2fb8a6 100%)",
    darkInk: false,
  },
  {
    // Peach → rose → lavender dusk.
    gradient:
      "linear-gradient(160deg, #fbe2c7 0%, #f6c7cc 46%, #d9c6ec 100%)",
    darkInk: true,
  },
  {
    // Graphite → slate, for events that land on the quiet one.
    gradient:
      "linear-gradient(160deg, #101014 0%, #26262e 55%, #3d3d49 100%)",
    darkInk: false,
  },
];

function colorwayFor(eventId: string): Colorway {
  let h = 0;
  for (let i = 0; i < eventId.length; i++) {
    h = (h * 31 + eventId.charCodeAt(i)) >>> 0;
  }
  return COLORWAYS[h % COLORWAYS.length];
}

// Fine film grain, tiled. Keeps the flat gradient from banding and gives the
// surface a printed feel — same trick as the reference tickets.
const NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Two punched holes at the top and bottom edges (mask carves real
// transparency, so the page's ambient background shows through the cutouts).
const NOTCH_MASK =
  "radial-gradient(circle 10px at 50% 0%, transparent 9.5px, #000 10.5px), " +
  "radial-gradient(circle 10px at 50% 100%, transparent 9.5px, #000 10.5px)";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "long",
  day: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const checkedInAtFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export async function EventTicket({
  eventId,
  title,
  startsAt,
  token,
  holderName,
  checkedInAt,
  inCheckInWindow,
}: {
  eventId: string;
  title: string;
  startsAt: string;
  token: string;
  holderName: string | null;
  checkedInAt: string | null;
  inCheckInWindow: boolean;
}) {
  const colorway = colorwayFor(eventId);
  const ink = colorway.darkInk
    ? {
        strong: "rgba(24, 16, 38, 0.92)",
        soft: "rgba(24, 16, 38, 0.60)",
        faint: "rgba(24, 16, 38, 0.42)",
        dash: "rgba(24, 16, 38, 0.30)",
      }
    : {
        strong: "rgba(255, 255, 255, 0.96)",
        soft: "rgba(255, 255, 255, 0.70)",
        faint: "rgba(255, 255, 255, 0.50)",
        dash: "rgba(255, 255, 255, 0.38)",
      };

  // ECC level H tolerates the brand glyph covering the center of the code.
  const qrDataUrl = await QRCode.toDataURL(token, {
    errorCorrectionLevel: "H",
    margin: 0,
    width: 560,
    color: { dark: "#18181b", light: "#ffffff" },
  });

  const ticketNo = token.slice(0, 8).toUpperCase();
  const start = new Date(startsAt);
  const checkedIn = checkedInAt !== null;

  return (
    <section aria-label="Your ticket" className="space-y-3">
      <div
        className="w-full max-w-[320px] -rotate-1 transition-transform duration-300 ease-out hover:rotate-0"
        style={{ filter: "drop-shadow(0 24px 48px rgba(0, 0, 0, 0.45))" }}
      >
        <div
          className="relative overflow-hidden rounded-[26px]"
          style={{
            background: colorway.gradient,
            WebkitMaskImage: NOTCH_MASK,
            WebkitMaskComposite: "source-in",
            maskImage: NOTCH_MASK,
            maskComposite: "intersect",
          }}
        >
          {/* Grain + a diagonal sheen, both subtle. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 mix-blend-overlay"
            style={{ backgroundImage: NOISE_URL, opacity: 0.28 }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(115deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.04) 34%, transparent 55%)",
            }}
          />

          <div className="relative px-5 pt-6">
            <div className="relative rounded-[18px] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={checkedIn ? "" : "Your check-in QR code"}
                className={
                  "h-auto w-full rounded-md " +
                  (checkedIn ? "opacity-20 saturate-0" : "")
                }
              />
              {checkedIn ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="-rotate-12 rounded-lg border-[3px] border-emerald-600 px-3.5 py-1.5 text-sm font-extrabold uppercase tracking-[0.18em] text-emerald-600">
                    Checked in
                  </span>
                </div>
              ) : (
                <span
                  aria-hidden
                  className="absolute left-1/2 top-1/2 flex h-[19%] w-[19%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl bg-white shadow-[0_0_0_4px_white]"
                >
                  <span className="font-serif text-2xl font-black italic text-zinc-800">
                    P
                  </span>
                </span>
              )}
            </div>
          </div>

          <div aria-hidden className="px-5 py-4">
            <div
              className="border-t-2 border-dashed"
              style={{ borderColor: ink.dash }}
            />
          </div>

          <div className="relative px-5 pb-6">
            <h3
              className="text-[19px] font-semibold leading-snug"
              style={{ color: ink.strong }}
            >
              {title}
            </h3>
            <div className="mt-0.5 flex items-baseline justify-between gap-3">
              <p className="text-[15px]" style={{ color: ink.soft }}>
                General Admission
              </p>
              <p
                className="font-mono text-[10px] tracking-wider"
                style={{ color: ink.faint }}
              >
                N° {ticketNo}
              </p>
            </div>

            <dl className="mt-4 space-y-3">
              <div>
                <dt
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: ink.faint }}
                >
                  Date
                </dt>
                <dd
                  className="text-[15px] font-semibold"
                  style={{ color: ink.strong }}
                >
                  {dateFormatter.format(start)}
                </dd>
              </div>
              <div>
                <dt
                  className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: ink.faint }}
                >
                  Time
                </dt>
                <dd
                  className="text-[15px] font-semibold"
                  style={{ color: ink.strong }}
                >
                  {timeFormatter.format(start)}
                </dd>
              </div>
              {holderName ? (
                <div>
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: ink.faint }}
                  >
                    Admit
                  </dt>
                  <dd
                    className="text-[15px] font-semibold"
                    style={{ color: ink.strong }}
                  >
                    {holderName}
                  </dd>
                </div>
              ) : null}
            </dl>

            <span
              aria-hidden
              className="absolute bottom-5 right-5 font-serif text-xl font-black italic"
              style={{ color: ink.faint }}
            >
              P
            </span>
          </div>
        </div>
      </div>

      <p className="max-w-[320px] text-center text-xs text-muted-foreground">
        {checkedIn
          ? `Checked in ${checkedInAtFormatter.format(new Date(checkedInAt as string))}. See you in there.`
          : inCheckInWindow
            ? "Doors are open — show this at the door and staff will scan you in."
            : "Your entry pass. Staff scan it at the door when doors open."}
      </p>
    </section>
  );
}
