"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { signOut } from "@/lib/actions/session";

import { Avatar } from "./avatar";
import { useTheme } from "./theme-shell";

// Account menu behind the header avatar. Replaces the old "Profile" nav pill
// and the always-visible "Sign out" button — both were spending top-level
// header room on things you reach once a session.
//
// Hand-rolled rather than pulled from a menu library: @radix-ui/react-slot is
// the only Radix package here, and adding a dependency for one dropdown isn't
// worth it. Keyboard contract matches the WAI-ARIA menu button pattern:
// Enter/Space/ArrowDown opens, Escape closes and restores focus, ArrowUp/Down
// move between items, Tab or an outside click dismisses.

type MenuItem =
  | { kind: "link"; label: string; href: string }
  | { kind: "theme"; label: string }
  | { kind: "signout"; label: string };

export function UserMenu({
  displayName,
  email,
  avatarUrl,
}: {
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const menuId = useId();
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  const items: MenuItem[] = [
    { kind: "link", label: "View profile", href: "/profile" },
    { kind: "link", label: "Settings", href: "/profile/settings" },
    { kind: "theme", label: "Dark mode" },
    { kind: "signout", label: "Sign out" },
  ];

  // Route changes don't unmount the header, so close on navigation or the menu
  // hangs open over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openWithFocus(index: number) {
    setOpen(true);
    // Wait for the menu to mount before moving focus into it.
    requestAnimationFrame(() => itemRefs.current[index]?.focus());
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openWithFocus(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openWithFocus(items.length - 1);
    }
  }

  function onItemKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      itemRefs.current[(index + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      itemRefs.current[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemRefs.current[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const itemClass =
    "block w-full rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus:bg-muted focus:outline-none";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${displayName}`}
        className="flex shrink-0 items-center rounded-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar src={avatarUrl} name={displayName} className="h-8 w-8 rounded-full" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border/80 bg-popover shadow-xl shadow-black/10 dark:shadow-black/40"
        >
          <div className="flex items-center gap-3 px-3 py-3">
            <Avatar
              src={avatarUrl}
              name={displayName}
              className="h-10 w-10 shrink-0 rounded-full"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {displayName}
              </p>
              {email ? (
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              ) : null}
            </div>
          </div>

          <div className="border-t border-border/70 p-1.5">
            {items.map((item, i) =>
              item.kind === "link" ? (
                <Link
                  key={item.label}
                  href={item.href}
                  role="menuitem"
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  tabIndex={-1}
                  onKeyDown={(e) => onItemKeyDown(e, i)}
                  onClick={() => setOpen(false)}
                  className={itemClass}
                >
                  {item.label}
                </Link>
              ) : item.kind === "theme" ? (
                <button
                  key={item.label}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isDark}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  tabIndex={-1}
                  onKeyDown={(e) => onItemKeyDown(e, i)}
                  // Stays open so the switch visibly lands on the new state.
                  onClick={toggleTheme}
                  className={`${itemClass} flex items-center justify-between gap-3`}
                >
                  <span className="flex items-center gap-2">
                    {isDark ? (
                      <Moon size={15} strokeWidth={1.75} aria-hidden />
                    ) : (
                      <Sun size={15} strokeWidth={1.75} aria-hidden />
                    )}
                    {item.label}
                  </span>
                  <span
                    aria-hidden
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                      isDark ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                        isDark ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </span>
                </button>
              ) : (
                <form key={item.label} action={signOut}>
                  <button
                    type="submit"
                    role="menuitem"
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    tabIndex={-1}
                    onKeyDown={(e) => onItemKeyDown(e, i)}
                    className={itemClass}
                  >
                    {item.label}
                  </button>
                </form>
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
