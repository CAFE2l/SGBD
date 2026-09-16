"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Toast, ToastType } from "@/hooks/useToast";

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {toasts.map((t) => (
        <motion.div
          key={t.id}
          layoutId={t.id}
          initial={reduce ? undefined : { opacity: 0, y: 16, scale: 0.92 }}
          animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: -12, scale: 0.92 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className={toastClass(t.type)}
        >
          <span className="flex-1 text-sm leading-tight">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="ml-2 shrink-0 rounded p-0.5 text-base opacity-60 hover:opacity-100"
            aria-label="Dispensar"
          >
            ✕
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

function toastClass(type: ToastType): string {
  const base =
    "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium shadow-lg backdrop-blur";
  switch (type) {
    case "success":
      return `${base} border-emerald-400/30 bg-emerald-500/90 text-emerald-50`;
    case "error":
      return `${base} border-red-400/30 bg-red-500/90 text-red-50`;
    case "warning":
      return `${base} border-amber-400/30 bg-amber-500/90 text-amber-50`;
    case "info":
    default:
      return `${base} border-sky-400/30 bg-sky-500/90 text-sky-50`;
  }
}
