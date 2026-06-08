import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-7 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
        <Skeleton className="h-80" />
      </div>
    </>
  );
}
