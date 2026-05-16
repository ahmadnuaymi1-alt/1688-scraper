import type { ReactNode } from "react";
import { Nav } from "@/components/nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="flex-1">
        {/* Subtle page-entry fade on route change — animate-in fires on every
            mount, including client-side navigations under the App Router. The
            motion-reduce variant skips it for users with prefers-reduced-motion. */}
        <div className="mx-auto w-full max-w-7xl px-4 py-6 animate-in fade-in-0 duration-300 motion-reduce:animate-none">
          {children}
        </div>
      </main>
    </div>
  );
}
