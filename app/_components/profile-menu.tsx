"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";

import { signOut } from "@/lib/actions/session";

import { Avatar } from "./avatar";

// Avatar-triggered dropdown: Dashboard/Profile/Settings + admin/sign-out.
// Hand-rolled (no dropdown-menu primitive exists in components/ui yet) —
// click-outside + Escape to close, matches the rest of the header's
// hover/focus styling instead of pulling in a new Radix dependency for one menu.
export function ProfileMenu({
  displayName,
  avatarUrl,
  isAdmin,
}: {
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${displayName}'s account menu`}
        className="block shrink-0 rounded-full outline-none ring-primary/50 transition-shadow focus-visible:ring-2"
      >
        <Avatar src={avatarUrl} name={displayName} className="h-8 w-8 rounded-full" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-48 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg"
        >
          {isAdmin ? (
            <>
              <MenuLink href="/admin" icon={ShieldCheck} onClick={() => setOpen(false)}>
                Admin
              </MenuLink>
              <div className="my-1 h-px bg-border" />
            </>
          ) : null}
          <MenuLink href="/dashboard" icon={LayoutDashboard} onClick={() => setOpen(false)}>
            Dashboard
          </MenuLink>
          <MenuLink href="/dashboard" icon={User} onClick={() => setOpen(false)}>
            Profile
          </MenuLink>
          <MenuLink href="/dashboard/settings" icon={Settings} onClick={() => setOpen(false)}>
            Settings
          </MenuLink>
          <div className="my-1 h-px bg-border" />
          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <LogOut size={15} strokeWidth={1.75} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  onClick,
  children,
}: {
  href: string;
  icon: typeof LayoutDashboard;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <Icon size={15} strokeWidth={1.75} aria-hidden />
      {children}
    </Link>
  );
}
