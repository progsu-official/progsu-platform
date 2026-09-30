import {
  LoadingRegion,
  Skeleton,
} from "@/app/_components/skeleton";

export default function EventsLoading() {
  return (
    <LoadingRegion label="Loading events">
      <div className="mx-auto max-w-3xl space-y-12 pb-8 pt-10 sm:pt-14">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-5xl font-extrabold leading-none tracking-[-0.035em] sm:text-6xl">Events</h1>
          <Skeleton className="h-10 w-64 rounded-full" />
        </header>
        <Skeleton className="h-[19rem] w-full rounded-2xl sm:h-[23rem]" />
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex gap-4 rounded-2xl glass p-4">
              <Skeleton className="h-24 w-40 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}
