"use client";

import { motion, useReducedMotion } from "motion/react";
import { Activity } from "lucide-react";

import type { OperationalModule, OperationalPriority } from "@/lib/central-operacional/contracts";

export function OperationalCore({
  activeModule,
  activePriority,
  paused,
}: {
  activeModule: OperationalModule | null;
  activePriority: OperationalPriority;
  paused: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const animate = !paused && !reducedMotion;

  return (
    <div
      className="operational-core-wrap"
      data-module={activeModule ?? undefined}
      data-priority={activePriority}
      data-active={Boolean(activeModule)}
      data-paused={paused}
      aria-label="Núcleo Operacional orquestrando"
    >
      <motion.div
        className="operational-core-ring ring-outer"
        animate={animate ? { rotate: 360 } : { rotate: 0 }}
        transition={{ duration: 34, ease: "linear", repeat: Infinity }}
      />
      <motion.div
        className="operational-core-ring ring-inner"
        animate={animate ? { rotate: -360 } : { rotate: 0 }}
        transition={{ duration: 22, ease: "linear", repeat: Infinity }}
      />
      <motion.div
        className="operational-core"
        animate={animate ? { scale: [1, 1.018, 1] } : { scale: 1 }}
        transition={{ duration: 4.8, ease: "easeInOut", repeat: Infinity }}
      >
        <Activity aria-hidden="true" />
        <span>ERP OFICINA</span>
        <strong>NÚCLEO OPERACIONAL</strong>
        <small><i aria-hidden="true" /> ORQUESTRANDO</small>
      </motion.div>
    </div>
  );
}
