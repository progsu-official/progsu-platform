"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  formatDateChip,
  parseDateValue,
  toDateValue,
} from "../datetime";
import { Popover } from "./popover";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Six rows of seven, so the grid height never jumps between months. */
function monthGrid(cursor: Date): Date[] {
  const first = startOfMonth(cursor);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function DatePicker({
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
      trigger={({ ref, props, open }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          {...props}
          className={cn(
            "w-full rounded-lg px-4 py-2.5 text-left text-[15px] font-medium text-white transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            open ? "bg-white/[0.18]" : "bg-white/[0.09] hover:bg-white/[0.14]"
          )}
        >
          <span className="sr-only">{label}: </span>
          {formatDateChip(value)}
        </button>
      )}
    >
      {(close) => (
        <Calendar
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

function Calendar({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (next: string) => void;
}) {
  const [cursor, setCursor] = useState<Date>(() =>
    value ? startOfMonth(parseDateValue(value)) : startOfMonth(new Date())
  );
  // Today is resolved after mount: the server renders in UTC and the browser
  // may be a day off, which would mismatch on hydration.
  const [todayValue, setTodayValue] = useState<string | null>(null);
  useEffect(() => setTodayValue(toDateValue(new Date())), []);

  const days = monthGrid(cursor);

  return (
    <div className="w-[19rem] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          {MONTH_YEAR.format(cursor)}
        </h2>
        <div className="flex items-center gap-1">
          <NavButton
            label="Previous month"
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </NavButton>
          <button
            type="button"
            onClick={() => setCursor(startOfMonth(new Date()))}
            aria-label="Jump to this month"
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
          </button>
          <NavButton
            label="Next month"
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={16} strokeWidth={2} aria-hidden />
          </NavButton>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <div
            key={i}
            aria-hidden
            className="pb-1 text-xs font-medium text-white/40"
          >
            {d}
          </div>
        ))}
        {days.map((d) => {
          const dv = toDateValue(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const selected = dv === value;
          const isToday = dv === todayValue;
          return (
            <button
              key={dv}
              type="button"
              onClick={() => onSelect(dv)}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-[15px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                inMonth ? "text-white/85" : "text-white/25",
                !selected && "hover:bg-white/10",
                selected && "bg-violet-500 font-semibold text-white",
                !selected && isToday && "font-semibold text-violet-300"
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {children}
    </button>
  );
}
