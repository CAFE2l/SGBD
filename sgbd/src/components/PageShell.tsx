"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Header } from "./Header";
import { ResetButton } from "./ResetButton";

export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  return (
    <main className="ambient-aurora relative min-h-screen overflow-x-hidden bg-[#0a0e1a] text-foreground">
      <BackgroundGlow />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-6">
        <Header />
        <div className="flex items-center justify-end pt-4">
          <ResetButton />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.1 : 0.2 }}
            className="flex-1 pt-4"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}

export function BackgroundGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="ambient-orb absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/15 blur-[120px]" />
      <div className="ambient-orb absolute bottom-0 left-0 h-96 w-96 rounded-full bg-cyan-500/10 blur-[110px]" />
      <div className="ambient-orb absolute right-0 top-1/3 h-80 w-80 rounded-full bg-indigo-500/10 blur-[110px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/40 to-transparent" />
    </div>
  );
}
