import Link from "next/link";

import { Button } from "@/components/ui/button";

// Logged-out welcome screen. Structure borrows the floating-poster-collage
// pattern (tiles drift around a centered hero); every tile is drawn in CSS —
// no image assets — so the page stays weightless and theme-consistent.

type Tile = {
  label: React.ReactNode;
  position: string;
  tilt: string;
  gradient: string;
  duration: string;
  delay: string;
};

const TILES: Tile[] = [
  {
    label: (
      <span className="text-lg font-black uppercase leading-none tracking-tight text-white">
        Work
        <br />
        shop
      </span>
    ),
    position: "left-[6%] top-[16%]",
    tilt: "-rotate-6",
    gradient: "from-violet-600 to-indigo-500",
    duration: "8s",
    delay: "0s",
  },
  {
    label: (
      <span className="font-mono text-sm font-bold lowercase text-lime-300">
        demo
        <br />
        night_
      </span>
    ),
    position: "left-[16%] top-[52%]",
    tilt: "rotate-3",
    gradient: "from-zinc-900 to-zinc-800",
    duration: "9s",
    delay: "1.2s",
  },
  {
    label: (
      <span className="text-sm font-extrabold uppercase tracking-widest text-amber-950">
        Career
        <br />
        Mixer
      </span>
    ),
    position: "left-[3%] bottom-[8%]",
    tilt: "rotate-6",
    gradient: "from-amber-300 to-orange-400",
    duration: "7.5s",
    delay: "0.6s",
  },
  {
    label: (
      <span className="text-xl font-black uppercase italic leading-none text-white">
        Hack
        <br />
        Night
      </span>
    ),
    position: "left-[24%] top-[6%]",
    tilt: "rotate-2",
    gradient: "from-rose-600 to-red-500",
    duration: "8.5s",
    delay: "2s",
  },
  {
    label: (
      <span className="text-sm font-semibold lowercase tracking-wide text-sky-100">
        study
        <br />
        jam ☕
      </span>
    ),
    position: "right-[24%] top-[8%]",
    tilt: "-rotate-3",
    gradient: "from-blue-600 to-indigo-700",
    duration: "9.5s",
    delay: "0.3s",
  },
  {
    label: (
      <span className="text-base font-black uppercase leading-tight text-emerald-950">
        Game
        <br />
        Night
      </span>
    ),
    position: "right-[5%] top-[18%]",
    tilt: "rotate-6",
    gradient: "from-emerald-400 to-teal-500",
    duration: "7s",
    delay: "1.6s",
  },
  {
    label: (
      <span className="text-base font-extrabold lowercase leading-snug text-white">
        launch
        <br />
        party ✦
      </span>
    ),
    position: "right-[14%] top-[54%]",
    tilt: "-rotate-6",
    gradient: "from-fuchsia-500 to-pink-500",
    duration: "8.2s",
    delay: "0.9s",
  },
  {
    label: (
      <span className="text-sm font-bold lowercase text-orange-100">
        coffee
        <br />
        chats
      </span>
    ),
    position: "right-[4%] bottom-[10%]",
    tilt: "rotate-3",
    gradient: "from-amber-700 to-stone-800",
    duration: "9s",
    delay: "2.4s",
  },
];

export default function Home() {
  return (
    <main className="dark relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <AmbientGlow />

      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        {TILES.map((tile, i) => (
          <div key={i} className={`absolute ${tile.position} ${tile.tilt}`}>
            <div
              className={`flex h-36 w-28 items-end rounded-2xl border border-white/15 bg-gradient-to-br ${tile.gradient} p-3 shadow-2xl shadow-black/50 motion-safe:animate-float`}
              style={{ animationDuration: tile.duration, animationDelay: tile.delay }}
            >
              {tile.label}
            </div>
          </div>
        ))}
      </div>

      <div className="relative flex max-w-2xl animate-fade-up flex-col items-center gap-6 text-center">
        <p className="text-sm font-bold tracking-tight text-muted-foreground">
          progsu
        </p>
        <h1 className="text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Events worth{" "}
          <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-orange-300 bg-clip-text text-transparent">
            showing up
          </span>{" "}
          for.
        </h1>
        <p className="max-w-md text-balance text-lg text-muted-foreground">
          Workshops, demo nights, career mixers, and the people who build
          alongside you — all in one place.
        </p>
        <Button asChild size="lg" className="mt-2 h-12 rounded-full px-8 text-base">
          <Link href="/login">Continue with Google</Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Members only · Signing in takes a few seconds
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
