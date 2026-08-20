import { LoadingRegion, Skeleton } from "@/app/_components/skeleton";

export default function ProfileLoading() {
  return (
    <LoadingRegion label="Loading your profile">
      <div className="space-y-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
          <Skeleton className="h-24 w-24 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-3.5 w-72" />
            <Skeleton className="h-3.5 w-48" />
          </div>
        </header>

        <Skeleton className="h-20 w-full rounded-2xl" />

        <div className="space-y-4">
          <Skeleton className="h-4 w-36" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-56 rounded-2xl" />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      </div>
    </LoadingRegion>
  );
}
