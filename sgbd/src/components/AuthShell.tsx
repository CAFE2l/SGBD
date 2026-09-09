"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BackgroundGlow } from "./PageShell";
import { FadeIn } from "./FadeIn";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0e1a] text-foreground">
      <BackgroundGlow />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-10">
        <FadeIn y={-10}>
          <Link
            href="/"
            className="mb-8 flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <span className="flex h-3 w-3 rounded-full bg-sky-400 shadow-glow" />
            SGBD
          </Link>
        </FadeIn>
        <FadeIn className="w-full" delay={0.08}>
          {children}
        </FadeIn>
      </div>
    </main>
  );
}