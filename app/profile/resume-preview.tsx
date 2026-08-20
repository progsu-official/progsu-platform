"use client";

import { ExternalLink, FileText, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createResumePreviewUrl } from "@/lib/actions/resume";

// "Preview" opens the member's current resume in a modal.
//
// The URL is minted on click rather than at page render: signing on every
// dashboard load would cost a storage round-trip for a link most visits never
// use, and would start the 5-minute clock the moment the page painted.
//
// No dialog primitive in the tree (@radix-ui/react-slot only), so the modal is
// hand-rolled: Escape and backdrop dismiss, focus moves in on open and returns
// to the trigger on close, background scroll is locked, and Tab is trapped.

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "open"; url: string; fileName: string }
  | { kind: "error"; message: string };

export function ResumePreview({
  fileName,
  variant = "outline",
}: {
  fileName: string;
  variant?: "outline" | "ghost";
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const isOpen = state.kind === "open";

  function open() {
    setState({ kind: "loading" });
    startTransition(async () => {
      const result = await createResumePreviewUrl();
      if (!result.ok) {
        setState({ kind: "error", message: result.error.message });
        return;
      }
      setState({
        kind: "open",
        url: result.data.url,
        fileName: result.data.fileName,
      });
    });
  }

  function close() {
    setState({ kind: "idle" });
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!isOpen) return;

    closeRef.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setState({ kind: "idle" });
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;

      // Keep focus inside the dialog while it's up.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [isOpen]);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size="sm"
        className="rounded-full"
        onClick={open}
        disabled={pending || state.kind === "loading"}
        // The visible label is just "Preview"; name the file for screen readers
        // so the control isn't ambiguous out of context.
        aria-label={`Preview ${fileName}`}
      >
        {state.kind === "loading" ? "Opening…" : "Preview"}
      </Button>

      {state.kind === "error" ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            // Only a click on the backdrop itself — not a drag that ends there.
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${state.fileName}`}
            className="glass-blur flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <FileText
                  size={16}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="truncate">{state.fileName}</span>
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={state.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
                  Open in new tab
                </a>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={close}
                  aria-label="Close preview"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={16} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </div>

            {/* iOS Safari and some mobile browsers won't render a PDF in an
                iframe, so the "Open in new tab" link above is the real fallback
                rather than a convenience. */}
            <iframe
              src={state.url}
              title={`Preview of ${state.fileName}`}
              className="min-h-0 w-full flex-1 bg-muted"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
