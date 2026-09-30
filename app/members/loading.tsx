import {
  CardGridSkeleton,
  LoadingRegion,
  Skeleton,
} from "@/app/_components/skeleton";

export default function MembersLoading() {
  return (
    <LoadingRegion label="Loading members">
      <div className="space-y-10 pt-2 sm:pt-6">
        <h1 className="text-5xl font-extrabold leading-none tracking-[-0.035em] sm:text-6xl">Members</h1>
        <Skeleton className="h-11 w-full max-w-sm rounded-full" />
        <CardGridSkeleton count={6} />
      </div>
    </LoadingRegion>
  );
}
