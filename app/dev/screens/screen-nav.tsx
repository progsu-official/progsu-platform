"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";

import { SCREENS, screenAt } from "./screens";

// Fixed prev/next bar so you can walk the whole funnel with two keys and
// never go back to an index to reach the next screen. Arrow keys work too.
export function ScreenNav() {
  const pathname = usePathname() ?? "";
  const slug = pathname.replace(/^\/dev\/screens\/?/, "");
  const at = slug ? screenAt(slug) : null;

  if (!at) return null;
  const { screen, prev, next } = at;
  const index = SCREENS.findIndex((s) => s.slug === screen.slug);

  return (
    <>
      <ArrowKeys prev={prev?.slug ?? null} next={next?.slug ?? null} />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-popover/95 p-1 shadow-lg backdrop-blur">
          <NavLink href={prev ? `/dev/screens/${prev.slug}` : null} label="Previous screen">
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </NavLink>

          <Link
            href="/dev/screens"
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LayoutGrid size={13} strokeWidth={1.75} aria-hidden />
            <span className="font-medium text-foreground">{screen.label}</span>
            <span className="tabular-nums">
              {index + 1}/{SCREENS.length}
            </span>
          </Link>

          <NavLink href={next ? `/dev/screens/${next.slug}` : null} label="Next screen">
            <ChevronRight size={16} strokeWidth={2} aria-hidden />
          </NavLink>
        </div>
      </div>
    </>
  );
}

function NavLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <span
        aria-disabled
        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/30"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </Link>
  );
}

function ArrowKeys({ prev, next }: { prev: string | null; next: string | null }) {
  const router = useRouter();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never hijack arrows while someone is inside a field — these screens
      // are mostly forms.
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      if (e.key === "ArrowLeft" && prev) router.push(`/dev/screens/${prev}`);
      if (e.key === "ArrowRight" && next) router.push(`/dev/screens/${next}`);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prev, next, router]);

  return null;
}
