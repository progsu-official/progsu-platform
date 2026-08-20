"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { MAX_NOTE_LENGTH } from "@/lib/actions/banner-schemas";
import { setProfileNote } from "@/lib/actions/banner";

/**
 * A short status line in a speech bubble above the avatar. Editable in place —
 * a modal for eighty characters would be a heavier interruption than the task
 * deserves.
 */
export function NoteBubble({ note }: { note: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (next === (note ?? "")) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setProfileNote({ note: next });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className={cn(BUBBLE_BASE, "px-2 py-1.5")}>
        <label htmlFor="profile-note" className="sr-only">
          Your note
        </label>
        <input
          id="profile-note"
          ref={inputRef}
          value={draft}
          maxLength={MAX_NOTE_LENGTH}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setDraft(note ?? "");
              setEditing(false);
            }
          }}
          placeholder="What are you up to?"
          className="w-40 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {error ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <BubbleTail />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(note ?? "");
        setEditing(true);
      }}
      aria-label={note ? `Edit your note: ${note}` : "Add a note"}
      className={cn(
        BUBBLE_BASE,
        "max-w-44 px-3 py-1.5 text-left transition-colors hover:bg-secondary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        !note && "opacity-0 group-hover/avatar:opacity-100 focus:opacity-100"
      )}
    >
      <span
        className={cn(
          "block truncate text-sm",
          note ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {note || "Note…"}
      </span>
      <BubbleTail />
    </button>
  );
}

/** Read-only variant for peer-visible member cards. */
export function StaticNote({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <div className={cn(BUBBLE_BASE, "max-w-44 px-3 py-1.5")}>
      <span className="block truncate text-sm text-foreground">{note}</span>
      <BubbleTail />
    </div>
  );
}

const BUBBLE_BASE =
  "relative inline-block rounded-2xl bg-muted shadow-sm ring-1 ring-inset ring-border/60";

// Drawn rather than a rotated square: a rotated element inherits the parent
// ring and shows its own edges through the bubble.
function BubbleTail() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 10"
      className="absolute -bottom-[9px] left-5 h-2.5 w-4 text-muted"
    >
      <path d="M0 0 H16 L7 9 Q5.5 10 4.5 8.6 Z" fill="currentColor" />
    </svg>
  );
}
