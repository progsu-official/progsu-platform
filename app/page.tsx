import Link from "next/link";
import { ArrowRight } from "lucide-react";

// Logged-out welcome screen. Mirrors the reference collage system measured
// off luma.com's logged-out page: flat #151515 ground, 80px/0.92 medium
// hero with a gradient last line, 20px/30px sub at 50% white, 46px white
// pill CTA with layered shadows, 147px poster tiles inside an 8%-white
// frame ring. Artwork and copy are our own; every tile is drawn in CSS.

type Tile = {
  art: React.ReactNode;
  position: string;
  tilt: string;
  size: string;
  duration: string;
  // Negative on purpose: a positive delay leaves the card at its base
  // position until the delay elapses, then snaps it to the 0% keyframe
  // (translateY(-7px)) — a visible one-time upward jump on load. Negative
  // delays start every card mid-cycle on the first paint instead.
  delay: string;
};

function Poster({
  gradient,
  className,
  children,
}: {
  gradient: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-full w-full rounded-2xl bg-gradient-to-br p-3 ${gradient} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

const TILES: Tile[] = [
  {
    art: (
      <Poster gradient="from-violet-600 to-indigo-500" className="items-end">
        <span className="text-[19px] font-black uppercase leading-[0.95] tracking-tight text-white">
          Work
          <br />
          shop
        </span>
      </Poster>
    ),
    position: "left-[4%] top-[13%]",
    tilt: "-rotate-6",
    size: "h-[9.5rem] w-[9.5rem]",
    duration: "8s",
    delay: "0s",
  },
  {
    art: (
      <Poster gradient="from-zinc-900 to-zinc-800" className="items-center justify-center">
        <span className="font-mono text-[15px] font-bold lowercase leading-snug text-lime-300">
          demo
          <br />
          night_
        </span>
      </Poster>
    ),
    position: "left-[12%] top-[44%]",
    tilt: "rotate-3",
    size: "h-36 w-36",
    duration: "9s",
    delay: "-1.2s",
  },
  {
    art: (
      <Poster gradient="from-amber-300 to-orange-400" className="items-end">
        <span className="text-[13px] font-extrabold uppercase leading-snug tracking-[0.18em] text-amber-950">
          Career
          <br />
          Mixer
        </span>
      </Poster>
    ),
    position: "-bottom-8 left-[3%]",
    tilt: "rotate-6",
    size: "h-44 w-44",
    duration: "7.5s",
    delay: "-0.6s",
  },
  {
    art: (
      <Poster gradient="from-rose-600 to-red-500" className="items-center justify-center">
        <span className="text-center text-[21px] font-black uppercase italic leading-[0.95] text-white">
          Hack
          <br />
          Night
        </span>
      </Poster>
    ),
    position: "-top-9 left-[30%]",
    tilt: "rotate-2",
    size: "h-40 w-40",
    duration: "8.5s",
    delay: "-2s",
  },
  {
    art: (
      <Poster gradient="from-blue-600 to-indigo-700" className="items-end">
        <span className="text-[15px] font-semibold lowercase leading-snug tracking-wide text-sky-100">
          study
          <br />
          jam
        </span>
      </Poster>
    ),
    position: "right-[27%] top-[7%]",
    tilt: "-rotate-3",
    size: "h-36 w-36",
    duration: "9.5s",
    delay: "-0.3s",
  },
  {
    art: (
      <Poster gradient="from-emerald-400 to-teal-500" className="items-end">
        <span className="text-[17px] font-black uppercase leading-[0.95] text-emerald-950">
          Game
          <br />
          Night
        </span>
      </Poster>
    ),
    position: "right-[4%] top-[14%]",
    tilt: "rotate-6",
    size: "h-[9.5rem] w-[9.5rem]",
    duration: "7s",
    delay: "-1.6s",
  },
  {
    art: (
      <Poster gradient="from-cyan-500 to-sky-600" className="items-center justify-center">
        <span className="text-center text-[13px] font-extrabold uppercase leading-snug tracking-widest text-cyan-950">
          Mock
          <br />
          Inter
          <br />
          views
        </span>
      </Poster>
    ),
    position: "right-[13%] top-[46%]",
    tilt: "-rotate-6",
    size: "h-36 w-36",
    duration: "8.2s",
    delay: "-0.9s",
  },
  {
    art: (
      <Poster gradient="from-fuchsia-500 to-pink-500" className="items-end">
        <span className="text-[16px] font-extrabold lowercase leading-snug text-white">
          launch
          <br />
          party
        </span>
      </Poster>
    ),
    position: "-bottom-10 right-[28%]",
    tilt: "rotate-3",
    size: "h-40 w-40",
    duration: "8.8s",
    delay: "-1.9s",
  },
  {
    art: (
      <Poster gradient="from-amber-700 to-stone-800" className="items-end">
        <span className="text-[14px] font-bold lowercase leading-snug text-orange-100">
          coffee
          <br />
          chats
        </span>
      </Poster>
    ),
    position: "bottom-[9%] right-[4%]",
    tilt: "-rotate-3",
    size: "h-36 w-36",
    duration: "9s",
    delay: "-2.4s",
  },
  {
    art: (
      <Poster gradient="from-purple-900 to-violet-950" className="items-center justify-center">
        <span className="text-center text-[15px] font-bold capitalize leading-snug text-purple-200">
          Founder
          <br />
          Talks
        </span>
      </Poster>
    ),
    position: "-bottom-9 left-[27%]",
    tilt: "-rotate-2",
    size: "h-36 w-36",
    duration: "7.8s",
    delay: "-1.4s",
  },
];

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="dark relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#151515] px-6 text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        {TILES.map((tile, i) => (
          <div key={i} className={`absolute ${tile.position} ${tile.tilt}`}>
            <div
              className={`${tile.size} rounded-[20px] bg-white/[0.08] p-1 shadow-2xl shadow-black/60 motion-safe:animate-float`}
              style={{ animationDuration: tile.duration, animationDelay: tile.delay }}
            >
              {tile.art}
            </div>
          </div>
        ))}
      </div>

      <div className="relative flex max-w-2xl animate-fade-up flex-col items-center text-center">
        <p className="flex items-baseline gap-2 text-[15px] font-semibold tracking-tight text-white/40">
          progsu
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/45">
            beta
          </span>
        </p>

        <h1 className="mt-5 text-[56px] font-medium leading-[0.92] tracking-[-0.01em] text-white sm:text-[68px] lg:text-[80px]">
          Events worth
          <br />
          showing up for.
          <br />
          <span className="bg-gradient-to-r from-violet-400 via-pink-500 to-amber-400 bg-clip-text text-transparent">
            Get noticed.
          </span>
        </h1>

        <p className="mt-11 max-w-[28rem] text-xl leading-[1.5] text-white/50">
          Every event you show up to builds your member profile — the one we
          put in front of recruiters and sponsors.
        </p>

        <Link
          href="/login"
          className="mt-8 inline-flex h-[46px] items-center gap-2.5 rounded-full bg-white px-7 text-lg font-medium text-[#151515] shadow-[0_3px_3px_rgba(0,0,0,0.1),0_8px_7px_rgba(0,0,0,0.13),0_16px_14px_rgba(0,0,0,0.1)] transition-[transform,background-color] duration-150 hover:bg-white/90 active:scale-[0.98]"
        >
          <GoogleLogo className="h-5 w-5" />
          continue with google
        </Link>

        <Link
          href="/events"
          className="group mt-4 inline-flex items-center gap-1.5 text-[15px] font-medium text-white/50 transition-colors duration-150 hover:text-white/80"
        >
          discover events
          <ArrowRight
            size={16}
            strokeWidth={1.75}
            className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
          />
        </Link>

        <p className="mt-6 text-base font-medium text-white/50">
          only takes a few seconds.
        </p>

        <p className="mt-2 text-[13px] text-white/30">
          we&apos;re in beta — expect fresh paint and moving parts.
        </p>

        {process.env.NODE_ENV !== "production" ? (
          <div className="mt-4 flex gap-3 text-xs text-white/30">
            <Link href="/api/dev-login?role=member" className="underline">
              Dev bypass: member
            </Link>
            <Link href="/api/dev-login?role=admin" className="underline">
              Dev bypass: admin
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}
