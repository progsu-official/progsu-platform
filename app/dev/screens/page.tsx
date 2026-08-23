import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { SCREENS, type Screen } from "./screens";

export const dynamic = "force-dynamic";

const GROUPS: Screen["group"][] = ["Guest RSVP", "Post-RSVP", "Onboarding"];

export default function DevScreensIndex() {
  return (
    <div className="mx-auto w-full max-w-[46rem] px-5 pb-32 pt-28 sm:px-8">
      <h1
        className="font-bold tracking-tight text-foreground"
        style={{ fontSize: "clamp(26px, 3.4vw, 36px)", lineHeight: 1.1 }}
      >
        Every screen, no account needed.
      </h1>
      <p className="mt-2.5 max-w-lg text-[14px] leading-[1.55] text-muted-foreground">
        The real components with fabricated props. Fill them in and press
        Continue — the funnel walks exactly as it does in production, with the
        same validation, transitions and reveals. Nothing reads or writes the
        database. Arrow keys jump between screens.
      </p>

      <div className="mt-10 space-y-10">
        {GROUPS.map((group) => (
          <section key={group}>
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              {group}
            </h2>
            <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-[18px] border border-border/60">
              {SCREENS.filter((s) => s.group === group).map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/dev/screens/${s.slug}`}
                    className="group flex items-center gap-4 bg-card/40 px-4 py-3.5 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-medium text-foreground">
                        {s.label}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-muted-foreground">
                        {s.note}
                      </span>
                    </span>
                    <ArrowUpRight
                      size={16}
                      strokeWidth={1.75}
                      aria-hidden
                      className="shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-10 text-[12.5px] leading-[1.5] text-muted-foreground">
        Each form skips exactly one thing here: the server action. Everything
        else is the shipped component, so a screen that looks right here looks
        right in production. Start at the RSVP form to walk the whole thing.
      </p>
    </div>
  );
}
