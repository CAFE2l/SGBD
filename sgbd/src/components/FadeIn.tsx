"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Entrada suave (fade + deslize para cima) usada no carregamento da página.
 * Respeita a preferência de movimento reduzido do sistema.
 */
export function FadeIn({
  children,
  delay = 0,
  y = 18,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Orb decorativa de vidro (blur + gradiente) com flutuação lenta,
 * dando profundidade 3D ao fundo escuro sem mudar a paleta.
 */
export function FloatingOrb({
  className,
  duration = 12,
  delay = 0,
}: {
  className?: string;
  duration?: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      aria-hidden
      className={`pointer-events-none absolute rounded-full ${className ?? ""}`}
      animate={reduce ? undefined : { y: [0, -18, 0], x: [0, 10, 0] }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}