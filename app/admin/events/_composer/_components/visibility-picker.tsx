"use client";

import { Check, ChevronDown, Globe, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { EventVisibility } from "@/lib/actions/event-schemas";

import { Popover } from "./popover";

const OPTIONS: Array<{
  value: EventVisibility;
  label: string;
  description: string;
  Icon: typeof Globe;
}> = [
  {
    value: "members",
    label: "All members",
    description: "Listed on the member events page for everyone signed in.",
    Icon: Globe,
  },
  {
    value: "private_invite",
    label: "Private invite",
    description: "Hidden from the events page. Only invited members can RSVP.",
    Icon: Lock,
  },
];

export function VisibilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: EventVisibility;
  onChange: (next: EventVisibility) => void;
  disabled?: boolean;
}) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  const CurrentIcon = current.Icon;

  return (
    <Popover
      align="end"
      panelClassName="w-80"
      trigger={({ ref, props, open }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          {...props}
          className={cn(
            "flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-medium text-white transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            open ? "bg-white/[0.2]" : "bg-white/[0.12] hover:bg-white/[0.17]"
          )}
        >
          <span className="sr-only">Who can see this event: </span>
          <CurrentIcon size={16} strokeWidth={1.75} aria-hidden />
          {current.label}
          <ChevronDown
            size={15}
            strokeWidth={2}
            aria-hidden
            className={cn(
              "text-white/70 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      )}
    >
      {(close) => (
        <div className="py-1">
          {OPTIONS.map(({ value: v, label, description, Icon }) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                onChange(v);
                close();
              }}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
            >
              <Icon
                size={17}
                strokeWidth={1.75}
                aria-hidden
                className="mt-0.5 shrink-0 text-white/60"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-white">
                  {label}
                </span>
                <span className="block text-sm leading-snug text-white/55">
                  {description}
                </span>
              </span>
              {v === value ? (
                <Check
                  size={17}
                  strokeWidth={2.25}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-white"
                />
              ) : null}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
