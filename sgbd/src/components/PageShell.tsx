"use client";

import type { ReactNode } from "react";
import { Header } from "./Header";
import { ResetButton } from "./ResetButton";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#0a0e1a] text-foreground">
      <BackgroundGlow />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-6">
        <Header />
        <div className="flex items-center justify-end pt-4">
          <ResetButton />
        </div>
        <div className="flex-1 pt-4">{children}</div>
      </div>
    </main>
  );
}

export function BackgroundGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
      <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-cyan-500/10 blur-[100px]" />
      <div className="absolute right-0 top-1/3 h-72 w-72 rounded-full bg-indigo-500/10 blur-[100px]" />
    </div>
  );
}
