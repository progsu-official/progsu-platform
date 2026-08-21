"use client";

import { useRouter } from "next/navigation";

export function StatusFilterSelect({
  tabs,
  active,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
}) {
  const router = useRouter();

  return (
    <select
      aria-label="Event status"
      value={active}
      onChange={(e) => router.push(`/admin/events?tab=${e.target.value}`)}
      className="rounded-lg border border-border/70 bg-card px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {tabs.map((t) => (
        <option key={t.key} value={t.key}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
