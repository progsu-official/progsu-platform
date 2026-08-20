"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronsUpDown, Shuffle } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  THEME_PALETTES,
  THEME_PALETTE_LABELS,
  THEME_STYLES,
  THEME_STYLE_LABELS,
  type ThemeSpec,
  themeStyle,
} from "../event-theme";

export function ThemePicker({
  theme,
  onChange,
  disabled,
}: {
  theme: ThemeSpec;
  onChange: (next: ThemeSpec) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-white/[0.08] p-2 pr-3 text-left transition-colors",
            "hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            "disabled:cursor-not-allowed disabled:opacity-40"
          )}
        >
          <span
            aria-hidden
            className="h-11 w-11 shrink-0 rounded-lg ring-1 ring-white/15"
            style={themeStyle(theme)}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-white/55">Theme</span>
            <span className="block truncate text-[15px] font-medium text-white">
              {THEME_STYLE_LABELS[theme.style]}
            </span>
          </span>
          <ChevronsUpDown
            size={16}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0 text-white/50"
          />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...theme, seed: theme.seed + 1 })}
          aria-label="Shuffle this theme"
          className={cn(
            "flex w-14 items-center justify-center rounded-xl bg-white/[0.08] text-white/80 transition-colors",
            "hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            "disabled:cursor-not-allowed disabled:opacity-40"
          )}
        >
          <Shuffle size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {open ? (
        <ThemeSheet
          theme={theme}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ThemeSheet({
  theme,
  onChange,
  onClose,
}: {
  theme: ThemeSpec;
  onChange: (next: ThemeSpec) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portalled to the body on purpose. The cover column is `position: sticky`,
  // which opens a stacking context — a fixed overlay rendered inside it gets
  // trapped there and the form column paints straight over the top of it.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end bg-black/50"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Event theme"
        className="w-full rounded-t-2xl border-t border-white/10 bg-[#171018] px-6 pb-6 pt-3 shadow-[0_-24px_60px_-20px_rgba(0,0,0,0.8)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close theme picker"
          className="mx-auto mb-5 block h-1.5 w-10 rounded-full bg-white/25 transition-colors hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        />

        <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-4">
          {THEME_STYLES.map((style) => {
            const selected = style === theme.style;
            return (
              <button
                key={style}
                type="button"
                onClick={() => onChange({ ...theme, style })}
                aria-pressed={selected}
                className="group flex flex-col items-center gap-2 focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  style={themeStyle({ ...theme, style })}
                  className={cn(
                    "h-24 w-32 rounded-xl transition-shadow",
                    selected
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[#171018]"
                      : "ring-1 ring-white/15 group-hover:ring-white/40 group-focus-visible:ring-2 group-focus-visible:ring-white/70"
                  )}
                />
                <span
                  className={cn(
                    "text-sm",
                    selected ? "font-semibold text-white" : "text-white/60"
                  )}
                >
                  {THEME_STYLE_LABELS[style]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-3 border-t border-white/10 pt-5">
          <span className="text-sm text-white/50">Color</span>
          {THEME_PALETTES.map((palette) => {
            const selected = palette === theme.palette;
            return (
              <button
                key={palette}
                type="button"
                onClick={() => onChange({ ...theme, palette })}
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-3 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                  selected
                    ? "bg-white/15 text-white"
                    : "text-white/60 hover:bg-white/10"
                )}
              >
                <span
                  aria-hidden
                  className="h-6 w-6 rounded-full ring-1 ring-white/20"
                  style={themeStyle({ ...theme, palette, style: "mesh" })}
                />
                {THEME_PALETTE_LABELS[palette]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onChange({ ...theme, seed: theme.seed + 1 })}
            className="ml-2 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/85 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Shuffle size={15} strokeWidth={1.75} aria-hidden />
            Shuffle
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
