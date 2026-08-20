"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  EVENT_COVER_MIME_TYPES,
  MAX_EVENT_COVER_BYTES,
} from "@/lib/actions/event-schemas";

import { type ThemeSpec, themeStyle } from "../event-theme";

const ACCEPT = EVENT_COVER_MIME_TYPES.join(",");
const MAX_MB = Math.round(MAX_EVENT_COVER_BYTES / (1024 * 1024));

export function CoverField({
  file,
  onFileChange,
  existingUrl = null,
  onRemoveExisting,
  theme,
  disabled,
}: {
  file: File | null;
  onFileChange: (next: File | null) => void;
  /** Already-persisted cover to fall back to when no new file is staged
   * (edit mode). Ignored in create mode, where there's nothing to persist yet. */
  existingUrl?: string | null;
  /** Called when the admin removes the persisted cover (as opposed to just
   * clearing a staged replacement, which needs no server call). */
  onRemoveExisting?: () => void;
  theme: ThemeSpec;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayUrl = preview ?? existingUrl;

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(next: File | undefined) {
    if (!next) return;
    if (!(EVENT_COVER_MIME_TYPES as readonly string[]).includes(next.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (next.size > MAX_EVENT_COVER_BYTES) {
      setError(`Image must be ${MAX_MB} MB or less.`);
      return;
    }
    setError(null);
    onFileChange(next);
  }

  return (
    <div className="space-y-3">
      <div
        className="relative overflow-hidden rounded-2xl ring-1 ring-white/10"
        style={displayUrl ? undefined : themeStyle(theme)}
      >
        {displayUrl ? (
          // Raw img: a staged file stays in the browser until the event row
          // exists (no URL for next/image to optimise); a persisted cover
          // comes in as a signed URL that expires, same reasoning.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt="Event cover"
            className="aspect-square w-full object-cover"
          />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex aspect-square w-full flex-col items-center justify-center gap-3 p-6 text-center transition-colors",
              "hover:bg-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full bg-black/35 text-white ring-1 ring-white/20 backdrop-blur-sm"
            >
              <ImagePlus size={20} strokeWidth={1.75} />
            </span>
            <span className="text-[15px] font-medium text-white">
              Add a cover image
            </span>
            <span className="text-xs text-white/60">
              JPEG, PNG, or WebP. Up to {MAX_MB} MB.
            </span>
          </button>
        )}

        {displayUrl ? (
          <div className="absolute bottom-3 right-3 flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                // No staged file showing means the persisted cover is what's
                // on screen, so removing it needs the parent to know it should
                // clear the cover on save, not just drop a local pick.
                if (!file) onRemoveExisting?.();
                onFileChange(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              aria-label="Remove cover image"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Trash2 size={18} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              aria-label="Replace cover image"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#1B0E2B] shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
            >
              <ImagePlus size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
