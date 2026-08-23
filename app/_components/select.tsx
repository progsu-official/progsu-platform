"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";

// Replaces native <select> on themed surfaces. A native select renders as an
// OS widget — it ignores the token system, the radius scale, and the dark
// theme, and it was the single loudest thing on the onboarding form.
//
// Listbox semantics, not a menu: arrow keys move a highlight without
// committing, Enter/Space commits, Escape reverts and closes, and typing
// jumps to the first option starting with what you typed. Long lists (majors
// runs to a few dozen) scroll the highlighted option into view.
//
// Past SEARCH_THRESHOLD options the popover grows a filter field and becomes a
// proper combobox: scanning two dozen majors for "Computer Information
// Systems" by eye is slower than typing "info", and first-letter type-ahead
// can't find a word in the middle of a label.

export type SelectOption = { value: string; label: string };

const SEARCH_THRESHOLD = 12;

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  disabled,
  id,
  invalid,
  describedBy,
  searchable,
  searchPlaceholder = "Type to filter",
}: {
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  // Defaults to on for long lists. Pass explicitly to force either way.
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const listId = `${buttonId}-listbox`;

  const withSearch = searchable ?? options.length >= SEARCH_THRESHOLD;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef<{ query: string; at: number }>({ query: "", at: 0 });

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  // Substring, not prefix: people search majors by the distinctive word, which
  // is rarely the first one ("info" for Computer Information Systems).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Every index below addresses `visible`, never `options` — with a filter
  // applied those two diverge and committing the wrong one picks a random
  // major.
  function openList() {
    if (disabled) return;
    setQuery("");
    const at = options.findIndex((o) => o.value === value);
    setHighlight(at >= 0 ? at : 0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function commit(index: number) {
    const option = visible[index];
    if (option) onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (open && withSearch) inputRef.current?.focus();
  }, [open, withSearch]);

  // Close on outside pointerdown. pointerdown rather than click so a press
  // that starts outside doesn't first land on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  // Shared by the trigger and the filter field so both drive the same listbox.
  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit(highlight);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(visible.length - 1, h + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setHighlight(visible.length - 1);
    }
  }

  function onButtonKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }

    // Space commits only when there is no filter field to type a space into.
    if (e.key === " " && !withSearch) {
      e.preventDefault();
      commit(highlight);
      return;
    }

    onListKeyDown(e);
    if (e.defaultPrevented || withSearch) return;

    // First-letter type-ahead, for short lists with no filter field.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.query = now - state.at < 1000 ? state.query + e.key : e.key;
      state.at = now;
      const match = visible.findIndex((o) =>
        o.label.toLowerCase().startsWith(state.query.toLowerCase())
      );
      if (match >= 0) setHighlight(match);
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onButtonKeyDown}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-background px-3.5 text-left text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-40",
          invalid ? "border-destructive/60" : "border-input hover:border-primary/40"
        )}
      >
        <span
          className={cn(
            "truncate",
            selected ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          aria-hidden
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        >
          {withSearch ? (
            <div className="flex items-center gap-2 border-b border-border/70 px-3">
              <Search
                size={15}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-muted-foreground"
              />
              <input
                ref={inputRef}
                type="text"
                role="searchbox"
                aria-controls={listId}
                aria-label={searchPlaceholder}
                autoComplete="off"
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onListKeyDown}
                className="h-10 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </div>
          ) : null}

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={buttonId}
            tabIndex={-1}
            className="max-h-60 overflow-y-auto p-1"
          >
            {visible.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing matches “{query.trim()}”
              </li>
            ) : (
              visible.map((option, i) => {
                const isSelected = option.value === value;
                const isHighlighted = i === highlight;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-highlighted={isHighlighted}
                      tabIndex={-1}
                      onPointerEnter={() => setHighlight(i)}
                      onClick={() => commit(i)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        isHighlighted
                          ? "bg-primary/10 text-foreground"
                          : "text-foreground/90"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                      {isSelected ? (
                        <Check
                          size={15}
                          strokeWidth={2.25}
                          aria-hidden
                          className="shrink-0 text-primary"
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
