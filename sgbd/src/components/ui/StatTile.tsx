"use client";

import { useEffect } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { TiltCard } from "./TiltCard";

export function StatTile({
  label,
  value,
  title,
}: {
  label: string;
  value: number;
  title?: string;
}) {
  const reduce = useReducedMotion();
  const counter = useMotionValue(0);
  const display = useTransform(counter, (current) =>
    Math.round(current).toLocaleString("pt-BR")
  );

  useEffect(() => {
    const controls = animate(counter, value, {
      duration: reduce ? 0 : 0.7,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [counter, reduce, value]);

  return (
    <TiltCard className="rounded-2xl">
      <div className="px-3 py-3 text-center sm:px-4" title={title}>
        <p className="text-xl font-bold tabular-nums text-white sm:text-2xl">
          <motion.span>{display}</motion.span>
        </p>
        <p className="mt-1 text-[9px] uppercase tracking-[0.16em] text-slate-400 sm:text-[10px]">
          {label}
        </p>
      </div>
    </TiltCard>
  );
}
