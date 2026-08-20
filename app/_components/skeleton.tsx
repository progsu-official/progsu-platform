// Loading placeholders for the member surfaces.
//
// These exist because /profile, /events, and /members are all force-dynamic
// and each runs several Supabase round-trips per load. Without a Suspense
// boundary the browser sits on the previous page for the whole wait, which
// reads as a broken link. With one, the shell paints immediately and only the
// data-dependent region is pending.

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-muted ${className}`}
    />
  );
}

/** Wraps a whole loading screen so screen readers announce the wait once. */
export function LoadingRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-2xl glass p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
