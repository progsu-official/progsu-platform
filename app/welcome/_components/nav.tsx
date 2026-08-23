"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

export function Nav({ showEvents }: { showEvents: boolean }) {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={solid ? "solid" : undefined}>
      <div className="nav-inner">
        {showEvents ? (
          <Link href="/events" className="nav-cta">
            go to events
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
