import { cn } from "@/lib/utils";

/**
 * Plain rectangular skeleton placeholder. Used inside `loading.tsx` files so
 * the user sees layout-shaped feedback instantly on navigation instead of a
 * blank pause while the server-rendered page is being built.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted/60", className)}
      {...props}
    />
  );
}
