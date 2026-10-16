"use client";

import { useMemo, useState, type PointerEvent, type ReactNode } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";

export function TiltCard({
  children,
  className = "",
  maxTilt = 8,
}: {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
}) {
  const reduce = useReducedMotion();
  const [tiltEnabled, setTiltEnabled] = useState(false);
  const rotateXValue = useMotionValue(0);
  const rotateYValue = useMotionValue(0);
  const lightX = useMotionValue(50);
  const lightY = useMotionValue(0);
  const rotateX = useSpring(rotateXValue, { stiffness: 260, damping: 24 });
  const rotateY = useSpring(rotateYValue, { stiffness: 260, damping: 24 });
  const glare = useMotionTemplate`radial-gradient(circle at ${lightX}% ${lightY}%, rgba(125, 226, 255, 0.12), transparent 48%)`;
  const style = useMemo(
    () => ({
      rotateX: reduce || !tiltEnabled ? 0 : rotateX,
      rotateY: reduce || !tiltEnabled ? 0 : rotateY,
      transformPerspective: 1000,
    }),
    [reduce, tiltEnabled, rotateX, rotateY]
  );

  function onMove(event: PointerEvent<HTMLDivElement>) {
    if (reduce || event.pointerType !== "mouse") return;
    if (!tiltEnabled) setTiltEnabled(true);
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    rotateXValue.set((0.5 - y) * maxTilt);
    rotateYValue.set((x - 0.5) * maxTilt);
    lightX.set(x * 100);
    lightY.set(y * 100);
  }

  function onLeave() {
    rotateXValue.set(0);
    rotateYValue.set(0);
    lightX.set(50);
    lightY.set(0);
  }

  return (
    <motion.div
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      whileHover={reduce ? undefined : { y: -3, scale: 1.008 }}
      transition={{ type: "spring", stiffness: 360, damping: 28 }}
      style={style}
      className={`glass-panel relative transform-gpu overflow-hidden rounded-2xl transition-[border-color,box-shadow] duration-300 hover:border-sky-300/30 hover:shadow-[0_20px_55px_rgba(2,8,23,0.5),0_0_28px_rgba(34,211,238,0.08)] ${className}`}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{ backgroundImage: reduce ? undefined : glare }}
      />
      <div className="relative z-[1]">{children}</div>
    </motion.div>
  );
}
