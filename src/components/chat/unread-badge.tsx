"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { unreadBadgeLabel } from "./chat-utils";

export function UnreadBadge({
  count,
  compact = false,
  singular = "mensagem não lida",
  plural = "mensagens não lidas",
}: {
  count: number;
  compact?: boolean;
  singular?: string;
  plural?: string;
}) {
  const reduceMotion = useReducedMotion();
  if (count <= 0) return null;

  return (
    <motion.span
      key={count}
      aria-label={`${count} ${count === 1 ? singular : plural}`}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduceMotion ? { duration: 0.08 } : { type: "spring", stiffness: 520, damping: 27 }}
      className={
        compact
          ? "absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-background"
          : "inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground shadow-sm shadow-primary/15"
      }
    >
      {unreadBadgeLabel(count)}
    </motion.span>
  );
}
