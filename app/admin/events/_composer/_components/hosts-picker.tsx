"use client";

import { Pencil, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { Popover } from "./popover";

export type HostRow = { display_name: string; profile_id: string };

export function HostsPicker({
  hosts,
  onChange,
  disabled,
}: {
  hosts: HostRow[];
  onChange: (next: HostRow[]) => void;
  disabled?: boolean;
}) {
  const named = hosts.filter((h) => h.display_name.trim() !== "");
  const summary =
    named.length === 0
      ? "None"
      : named.length <= 2
        ? named.map((h) => h.display_name.trim()).join(", ")
        : `${named.length} hosts`;

  return (
    <Popover
      align="end"
      panelClassName="w-[22rem]"
      trigger={({ ref, props }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          {...props}
          className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-[15px] text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <span className="max-w-40 truncate">{summary}</span>
          <Pencil size={14} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    >
      {() => (
        <div className="p-3">
          {hosts.length === 0 ? (
            <p className="px-1 pb-3 text-sm text-white/50">
              Hosts appear on the event page. Add the people running it.
            </p>
          ) : (
            <div className="space-y-2 pb-3">
              {hosts.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      value={h.display_name}
                      onChange={(e) =>
                        onChange(
                          hosts.map((row, idx) =>
                            idx === i
                              ? { ...row, display_name: e.target.value }
                              : row
                          )
                        )
                      }
                      placeholder="Host name"
                      aria-label={`Host ${i + 1} name`}
                      className="w-full rounded-lg bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-white/50"
                    />
                    <input
                      value={h.profile_id}
                      onChange={(e) =>
                        onChange(
                          hosts.map((row, idx) =>
                            idx === i
                              ? { ...row, profile_id: e.target.value }
                              : row
                          )
                        )
                      }
                      placeholder="Member profile id (optional)"
                      aria-label={`Host ${i + 1} profile id`}
                      className="w-full rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-white/80 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(hosts.filter((_, idx) => idx !== i))}
                    aria-label={`Remove host ${i + 1}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <X size={15} strokeWidth={2} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() =>
              onChange([...hosts, { display_name: "", profile_id: "" }])
            }
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white",
              "transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            )}
          >
            <Plus size={15} strokeWidth={2} aria-hidden />
            Add host
          </button>
        </div>
      )}
    </Popover>
  );
}
