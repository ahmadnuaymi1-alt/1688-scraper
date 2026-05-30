import type { ReactNode } from "react";
import { Nav } from "@/components/nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="flex-1">
        {/* Fast page-entry fade on route change. Kept short (120ms) so the
            animation doesn't pile on top of the SSR cost — at 300ms the
            navigation felt sluggish even when the actual server work was
            quick. Motion-reduce variant skips it entirely. */}
        <div className="mx-auto w-full max-w-7xl px-4 py-6 animate-in fade-in-0 duration-100 motion-reduce:animate-none">
          {children}
        </div>
      </main>
    </div>
  );
}
