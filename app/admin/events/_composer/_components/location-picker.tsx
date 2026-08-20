"use client";

import { useState } from "react";
import { Link2, MapPin, Video } from "lucide-react";

import { cn } from "@/lib/utils";

import { Popover } from "./popover";

export type LocationValue = {
  text: string;
  url: string;
};

const isUrl = (v: string) => /^https?:\/\//i.test(v.trim());

/**
 * One field for both kinds of location, the way an organiser thinks about it:
 * type a room, or paste a meeting link. Which column it lands in
 * (location_text vs location_url) is inferred, not asked.
 */
export function LocationPicker({
  value,
  onChange,
  recent,
  disabled,
  error,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  recent: string[];
  disabled?: boolean;
  error?: string | null;
}) {
  const filled = value.text.trim() !== "" || value.url.trim() !== "";

  return (
    <Popover
      className="w-full"
      panelClassName="w-full"
      trigger={({ ref, props, open }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          {...props}
          className={cn(
            "flex w-full items-start gap-3 rounded-xl px-4 py-3.5 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            open ? "bg-white/[0.16]" : "bg-white/[0.08] hover:bg-white/[0.12]"
          )}
        >
          <MapPin
            size={18}
            strokeWidth={1.75}
            aria-hidden
            className="mt-0.5 shrink-0 text-white/60"
          />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium text-white">
              {filled ? value.text || value.url : "Add event location"}
            </span>
            <span className="block truncate text-sm text-white/55">
              {filled
                ? value.url && value.text
                  ? value.url
                  : value.url
                    ? "Virtual link"
                    : "In person"
                : "Room, address, or meeting link"}
            </span>
          </span>
        </button>
      )}
    >
      {(close) => (
        <LocationPanel
          value={value}
          onChange={onChange}
          recent={recent}
          onDone={close}
          error={error}
        />
      )}
    </Popover>
  );
}

function LocationPanel({
  value,
  onChange,
  recent,
  onDone,
  error,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  recent: string[];
  onDone: () => void;
  error?: string | null;
}) {
  // One visible input; whether it's a place or a link is decided on commit.
  const [draft, setDraft] = useState(value.url && !value.text ? value.url : value.text);
  const [mapUrl, setMapUrl] = useState(value.text ? value.url : "");

  function commit(next: string, nextMapUrl = mapUrl) {
    if (isUrl(next)) {
      onChange({ text: "", url: next.trim() });
    } else {
      onChange({ text: next.trim(), url: nextMapUrl.trim() });
    }
  }

  const draftIsLink = isUrl(draft);

  return (
    <div>
      <input
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onDone();
          }
        }}
        placeholder="Enter location or meeting link"
        aria-label="Event location"
        className="w-full border-b border-white/10 bg-transparent px-4 py-3.5 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
      />

      {draft.trim() && !draftIsLink ? (
        <label className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Link2 size={15} strokeWidth={1.75} aria-hidden className="text-white/45" />
          <span className="sr-only">Map link</span>
          <input
            value={mapUrl}
            onChange={(e) => {
              setMapUrl(e.target.value);
              commit(draft, e.target.value);
            }}
            placeholder="Map link (optional)"
            className="w-full bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
          />
        </label>
      ) : null}

      {recent.length > 0 && !draft.trim() ? (
        <>
          <p className="px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-white/40">
            Recent locations
          </p>
          {recent.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setDraft(r);
                commit(r);
                onDone();
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
            >
              <MapPin size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-white/45" />
              <span className="truncate text-[15px] text-white/90">{r}</span>
            </button>
          ))}
        </>
      ) : null}

      <p className="flex items-start gap-2 border-t border-white/10 px-4 py-3 text-xs text-white/45">
        <Video size={14} strokeWidth={1.75} aria-hidden className="mt-px shrink-0" />
        Paste a Zoom, Meet, or Discord link and it&apos;s saved as a virtual
        event.
      </p>
      {error ? (
        <p role="alert" className="px-4 pb-3 text-xs text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
