"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// Replaces native <select> on themed surfaces. A native select renders as an
// OS widget — it ignores the token system, the radius scale, and the dark
// theme, and it was the single loudest thing on the onboarding form.
//
// Listbox semantics, not a menu: arrow keys move a highlight without
// committing, Enter/Space commits, Escape reverts and closes, and typing
// jumps to the first option starting with what you typed. Long lists (majors
// runs to a few dozen) scroll the highlighted option into view.

export type SelectOption = { value: string; label: string };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  disabled,
  id,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const listId = `${buttonId}-listbox`;

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const typeahead = useRef<{ query: string; at: number }>({ query: "", at: 0 });

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  function openList() {
    if (disabled) return;
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function commit(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  // Close on outside pointerdown. pointerdown rather than click so a press
  // that starts outside doesn't first land on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !listRef.current?.contains(target)
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

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(highlight);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
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
      setHighlight(options.length - 1);
      return;
    }

    // Type-ahead. Successive keystrokes within a second extend the query.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.query = now - state.at < 1000 ? state.query + e.key : e.key;
      state.at = now;
      const match = options.findIndex((o) =>
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
        onKeyDown={onKeyDown}
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
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={buttonId}
          tabIndex={-1}
          className="absolute z-50 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          {options.map((option, i) => {
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
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
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
          })}
        </ul>
      ) : null}
    </div>
  );
}
