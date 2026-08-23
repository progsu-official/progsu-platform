"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Search } from "lucide-react";

// Debounced title search. Pushes a new URL (server component re-fetches),
// same pattern as StatusFilterSelect's router.push — no client-side
// filtering, so search stays correct across pagination instead of only
// searching the current page's 25 rows.
export function EventSearchInput({
  tab,
  initialQuery,
}: {
  tab: string;
  initialQuery: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function push(q: string) {
    const params = new URLSearchParams({ tab });
    if (q) params.set("q", q);
    router.push(`/admin/events?${params.toString()}`);
  }

  return (
    <div className="relative">
      <Search
        size={15}
        strokeWidth={1.75}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        placeholder="Search events…"
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => push(next.trim()), 300);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") push(value.trim());
        }}
        className="w-56 rounded-lg border border-border/70 bg-card py-1.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
