import { ChevronDown } from "lucide-react";

/** Native disclosure: collapsed to just the summary row until clicked, no
 * JS state needed. `[&::-webkit-details-marker]:hidden` drops the default
 * triangle so the chevron (rotated via `group-open:`) is the only marker. */
export function FoldSection({
  summary,
  children,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-border/70 bg-card [&::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
        {summary}
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-4 px-5 pb-5">{children}</div>
    </details>
  );
}
