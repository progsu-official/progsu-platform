"use client";

import { useEffect, useRef, useState } from "react";
import { AlignLeft, X } from "lucide-react";

import { cn } from "@/lib/utils";

const MAX = 20000;

export function DescriptionField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const summary = value.trim().split("\n")[0] ?? "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl bg-white/[0.08] px-4 py-3.5 text-left transition-colors",
          "hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        )}
      >
        <AlignLeft
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className="mt-0.5 shrink-0 text-white/60"
        />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium text-white">
            {summary || "Add description"}
          </span>
          {summary ? (
            <span className="block text-sm text-white/55">
              {value.trim().length} characters · Markdown
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <DescriptionModal
          value={value}
          onChange={onChange}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function DescriptionModal({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    areaRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Event description"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141014] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Event description</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close description editor"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <textarea
          ref={areaRef}
          value={value}
          maxLength={MAX}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Who should come? What's the event about?"
          className="min-h-64 flex-1 resize-none border-y border-white/10 bg-black/30 px-5 py-4 text-[15px] leading-relaxed text-white placeholder:text-white/35 focus:outline-none"
        />

        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <p className="text-xs text-white/45">
            Markdown supported. {value.length.toLocaleString()} /{" "}
            {MAX.toLocaleString()}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white px-6 py-2 text-sm font-semibold text-[#1B0E2B] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141014]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
