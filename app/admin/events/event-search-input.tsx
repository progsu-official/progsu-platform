"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Debounced so every keystroke doesn't push a new URL/re-run the server
// query — 300ms is the same feel as the composer's location search.
export function EventSearchInput({
  tab,
  initialQuery,
}: {
  tab: string;
  initialQuery: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const timeoutRef = useRef<number | undefined>(undefined);

  function push(q: string) {
    const params = new URLSearchParams({ tab });
    if (q.trim()) params.set("q", q.trim());
    router.push(`/admin/events?${params.toString()}`);
  }

  return (
    <div className="relative">
      <Search
        size={14}
        strokeWidth={1.75}
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = window.setTimeout(() => push(next), 300);
        }}
        placeholder="Search events..."
        aria-label="Search events by title"
        className="w-56 rounded-lg border border-border/70 bg-card py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
