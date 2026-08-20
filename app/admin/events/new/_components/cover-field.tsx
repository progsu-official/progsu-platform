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
  theme,
  disabled,
}: {
  file: File | null;
  onFileChange: (next: File | null) => void;
  theme: ThemeSpec;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        style={preview ? undefined : themeStyle(theme)}
      >
        {preview ? (
          // Raw img: the file stays in the browser until the event row exists,
          // so there's no URL for next/image to optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Selected event cover"
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

        {preview ? (
          <div className="absolute bottom-3 right-3 flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
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
