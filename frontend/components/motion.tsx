"use client";

import { MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";

/** Restrained motion: short fades and small lifts. Honours the OS setting and the in-app "reduce motion" preference. */
export function MotionProvider({ children, reduce }: { children: ReactNode; reduce?: boolean }) {
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </MotionConfig>
  );
}

export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
      {children}
    </motion.div>
  );
}
