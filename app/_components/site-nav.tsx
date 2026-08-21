"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Shared member-area nav (Events/Members). Previously each of
// app/profile, app/members, app/events hand-rolled its own header and
// they'd drifted: dashboard linked to neither Members nor Events at all.
// One nav, used by all three layouts, so that can't happen again.
// Profile lives in the header avatar menu, not here.
//
// The active pill is a single element that slides between items rather than a
// background that pops on and off. It moves on the click, not on the
// navigation: these routes are force-dynamic, so waiting for the new pathname
// would leave the pill sitting on the old tab for as long as the server takes.
export function SiteNav({
  showMembers,
  showEvents,
}: {
  showMembers: boolean;
  showEvents: boolean;
}) {
  const pathname = usePathname() ?? "";

  type Item = { href: string; label: string; icon: LucideIcon };
  const items: Item[] = [];
  if (showEvents) {
    items.push({ href: "/events", label: "Events", icon: CalendarDays });
  }
  if (showMembers) {
    items.push({ href: "/members", label: "Members", icon: Users });
  }

  const routeHref =
    items.find((i) => pathname.startsWith(i.href))?.href ?? null;
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const activeHref = pendingHref ?? routeHref;

  // Once the route catches up, hand control back to the pathname.
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  // Transitions stay off until the first measurement lands, otherwise the pill
  // slides in from the left edge on every page load.
  const [animated, setAnimated] = useState(false);
  const measured = useRef(false);

  const measure = useCallback(() => {
    const el = activeHref ? linkRefs.current[activeHref] : null;
    if (!el || !listRef.current) {
      setBox(null);
      measured.current = false;
      return;
    }
    setBox({ left: el.offsetLeft, width: el.offsetWidth });
    if (!measured.current) {
      measured.current = true;
      requestAnimationFrame(() => setAnimated(true));
    }
  }, [activeHref]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Font loading and viewport changes both move the items under the pill.
  useEffect(() => {
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  if (items.length === 0) return null;

  return (
    <div ref={listRef} className="relative flex items-center gap-0.5">
      {box ? (
        <span
          aria-hidden
          className={cn(
            // .glass, not .glass-blur: the header is already the blurred
            // layer, and stacking a second backdrop-filter inside it is both
            // the classic liquid-glass mistake and a per-frame repaint of the
            // same backdrop. This is the lens on top of that blur — a
            // translucent fill with a specular top edge and a hairline.
            "absolute inset-y-0 left-0 rounded-full glass",
            animated && "transition-[transform,width] duration-300",
            "motion-reduce:transition-none"
          )}
          style={{
            transform: `translateX(${box.left}px)`,
            width: box.width,
            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      ) : null}

      {items.map(({ href, label, icon: Icon }) => {
        const active = activeHref === href;
        return (
          <Link
            key={href}
            href={href}
            prefetch
            ref={(el) => {
              linkRefs.current[href] = el;
            }}
            onClick={() => setPendingHref(href)}
            aria-current={pathname.startsWith(href) ? "page" : undefined}
            className={cn(
              "relative z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm transition-colors sm:px-3",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
