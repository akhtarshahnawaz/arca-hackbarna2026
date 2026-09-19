import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-[100dvh] flex-col gap-4 px-6 py-8">
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="min-h-[50dvh] flex-1" />
    </div>
  );
}
