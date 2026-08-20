"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { TIME_OPTIONS, formatTimeChip } from "../datetime";
import { Popover } from "./popover";

export function TimePicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Popover
      align="end"
      trigger={({ ref, props, open }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          {...props}
          className={cn(
            "w-full rounded-lg px-4 py-2.5 text-center text-[15px] font-medium tabular-nums text-white transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            open ? "bg-white/[0.18]" : "bg-white/[0.09] hover:bg-white/[0.14]"
          )}
        >
          <span className="sr-only">{label}: </span>
          {formatTimeChip(value)}
        </button>
      )}
    >
      {(close) => (
        <TimeList
          value={value}
          onSelect={(next) => {
            onChange(next);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function TimeList({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (next: string) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Open on the current selection rather than on midnight.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div
      ref={listRef}
      className="max-h-72 w-40 overflow-y-auto overscroll-contain py-1"
    >
      {TIME_OPTIONS.map((t) => {
        const selected = t === value;
        return (
          <button
            key={t}
            type="button"
            data-selected={selected}
            onClick={() => onSelect(t)}
            className={cn(
              "block w-full px-4 py-2.5 text-center text-[15px] tabular-nums transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60",
              selected
                ? "bg-violet-500 font-semibold text-white"
                : "text-white/85 hover:bg-white/10"
            )}
          >
            {formatTimeChip(t)}
          </button>
        );
      })}
    </div>
  );
}
