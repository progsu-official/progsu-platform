"use client";

import { useMemo, useState } from "react";
import { Globe } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  POPULAR_TIME_ZONES,
  allTimeZones,
  gmtLabel,
  zoneCity,
} from "../datetime";
import { Popover } from "./popover";

export function TimezonePicker({
  value,
  onChange,
  instantMs,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  instantMs: number;
  disabled?: boolean;
}) {
  return (
    <Popover
      align="end"
      panelClassName="w-[22rem]"
      trigger={({ ref, props, open }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          {...props}
          className={cn(
            "h-full w-full rounded-xl px-4 py-3 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            open ? "bg-white/[0.16]" : "bg-white/[0.08] hover:bg-white/[0.12]"
          )}
        >
          <span className="sr-only">Event time zone: </span>
          <Globe
            size={16}
            strokeWidth={1.75}
            aria-hidden
            className="mb-2 text-white/60"
          />
          <span className="block text-[15px] font-medium text-white">
            {gmtLabel(value, instantMs)}
          </span>
          <span className="block text-sm text-white/60">{zoneCity(value)}</span>
        </button>
      )}
    >
      {(close) => (
        <ZoneList
          value={value}
          instantMs={instantMs}
          onSelect={(next) => {
            onChange(next);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function ZoneList({
  value,
  instantMs,
  onSelect,
}: {
  value: string;
  instantMs: number;
  onSelect: (next: string) => void;
}) {
  const [query, setQuery] = useState("");
  const zones = useMemo(() => allTimeZones(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return POPULAR_TIME_ZONES.map((z) => ({ id: z.id, label: z.label }));
    }
    return zones
      .filter((z) => z.toLowerCase().replace(/_/g, " ").includes(q))
      .slice(0, 60)
      .map((z) => ({ id: z, label: z.replace(/_/g, " ") }));
  }, [query, zones]);

  return (
    <div>
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a timezone"
        aria-label="Search for a timezone"
        className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
      />
      <div className="max-h-72 overflow-y-auto overscroll-contain py-1">
        {!query.trim() ? (
          <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-white/40">
            Popular
          </p>
        ) : null}
        {results.length === 0 ? (
          <p className="px-4 py-6 text-sm text-white/50">
            No timezone matches “{query.trim()}”.
          </p>
        ) : null}
        {results.map((z) => (
          <button
            key={z.id}
            type="button"
            onClick={() => onSelect(z.id)}
            className={cn(
              "flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60",
              z.id === value ? "bg-white/10" : "hover:bg-white/[0.07]"
            )}
          >
            <span className="text-[15px] text-white/90">{z.label}</span>
            <span className="shrink-0 text-sm tabular-nums text-white/45">
              {gmtLabel(z.id, instantMs)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
