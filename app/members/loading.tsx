import {
  CardGridSkeleton,
  LoadingRegion,
  Skeleton,
} from "@/app/_components/skeleton";

export default function MembersLoading() {
  return (
    <LoadingRegion label="Loading members">
      <div className="space-y-8">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Members</h1>
        <Skeleton className="h-11 w-full max-w-sm rounded-full" />
        <CardGridSkeleton count={6} />
      </div>
    </LoadingRegion>
  );
}
