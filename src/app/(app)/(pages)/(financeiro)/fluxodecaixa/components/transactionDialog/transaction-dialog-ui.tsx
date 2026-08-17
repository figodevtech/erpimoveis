import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const transactionFormSurfaceClass =
  "[&_input]:h-10 [&_input]:rounded-none [&_input]:shadow-none " +
  "[&_label]:text-[11px] [&_label]:font-semibold " +
  "[&_button[role=combobox]]:h-10 [&_button[role=combobox]]:rounded-none " +
  "[&_button[role=combobox]]:shadow-none [&_[data-slot=select-trigger]]:h-10 " +
  "[&_[data-slot=select-trigger]]:rounded-none [&_[data-slot=select-trigger]]:shadow-none";

export function TransactionSection({
  eyebrow,
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden border border-border bg-card shadow-sm",
        transactionFormSurfaceClass,
        className,
      )}
    >
      <header className="flex flex-col gap-3 border-b border-border bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center border border-border bg-background text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              {eyebrow}
            </p>
            <h2 className="mt-0.5 text-sm font-bold uppercase tracking-[0.06em] text-foreground">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </section>
  );
}

type SummaryTone = "default" | "primary" | "positive" | "warning" | "danger";

export function TransactionBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: SummaryTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em]",
        tone === "default" && "border-border bg-background text-muted-foreground",
        tone === "primary" && "border-primary/40 bg-primary/10 text-primary",
        tone === "positive" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warning" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "danger" && "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}
