"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { Search, WifiOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ChatSearchField({
  value,
  onChange,
  label,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="group relative block">
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors duration-200 group-focus-within:text-primary"
      />
      <Input
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl border-border/70 bg-card/70 pl-10 shadow-xs transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted-foreground/75 focus-visible:border-primary/45 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-primary/15"
      />
    </label>
  );
}

export function ChatEmptyState({
  icon: Icon,
  title,
  description,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-8 text-center", compact ? "min-h-40" : "h-full")}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/10">
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-64 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function ChatStatusBanner({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : -3 }}
          transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: "easeOut" }}
          className="flex items-start gap-2 border-y border-amber-500/15 bg-amber-500/[0.08] px-4 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200"
        >
          <WifiOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{children}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
