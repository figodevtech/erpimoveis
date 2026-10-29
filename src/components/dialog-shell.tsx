"use client";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function DialogShell({
  open,
  onOpenChange,
  title,
  titleSuffix,
  description,
  children,
  footer,
  loading = false,
  maxW = "lg:max-w-5xl xl:max-w-6xl",
  mobileFull = false,
  fixedHeight = false,
  variant = "default",
  eyebrow,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  titleSuffix?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  loading?: boolean;
  maxW?: string;
  mobileFull?: boolean;
  fixedHeight?: boolean;
  variant?: "default" | "workbench";
  eyebrow?: ReactNode;
}) {
  const isWorkbench = variant === "workbench";
  const fixedHeightClass = fixedHeight
    ? "h-[100dvh] max-h-[100dvh]"
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          mobileFull
            ? "h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] min-w-0 overflow-hidden rounded-none p-0 sm:w-[95vw] sm:max-w-[95vw] sm:rounded-lg md:max-w-3xl"
            : `w-[96vw] p-0 sm:max-w-[95vw] md:max-w-3xl ${fixedHeightClass}`,
          maxW,
          isWorkbench && !loading &&
            "border-foreground/20 shadow-2xl [&>[data-slot=dialog-close]]:text-foreground [&>[data-slot=dialog-close]]:ring-offset-card",
        )}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div
          className={`grid min-h-0 w-full overflow-hidden ${
            mobileFull || fixedHeight
              ? "h-full max-h-full"
              : "max-h-[85vh]"
          } ${loading ? "grid-rows-[1fr]" : "grid-rows-[auto_1fr_auto]"}`}
        >
          {loading ? (
            <div className="sr-only">
              <DialogTitle>
                {title}
                {titleSuffix ? ` | ${String(titleSuffix)}` : ""}
              </DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </div>
          ) : null}
          {!loading ? (
            <header
              className={cn(
                "flex items-start justify-between gap-4 border-b px-4 py-3 pr-12 sm:px-6 sm:pr-14",
                isWorkbench &&
                  "relative overflow-hidden border-background/10 bg-card py-4 text-foreground before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary",
              )}
            >
              <div className="space-y-1">
                {isWorkbench && eyebrow ? (
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/55">
                    {eyebrow}
                  </p>
                ) : null}
                <DialogTitle
                  className={cn(
                    "text-base font-semibold tracking-tight sm:text-lg",
                    isWorkbench && "uppercase tracking-[0.06em]",
                  )}
                >
                  {title}
                  {titleSuffix ? (
                    <span
                      className={cn(
                        "ml-1 text-sm font-normal text-muted-foreground",
                        isWorkbench && "text-foreground/55",
                      )}
                    >
                      | {titleSuffix}
                    </span>
                  ) : null}
                </DialogTitle>
                {description ? (
                  <DialogDescription
                    className={cn("text-sm", isWorkbench && "text-foreground/65")}
                  >
                    {description}
                  </DialogDescription>
                ) : null}
              </div>
            </header>
          ) : null}
          <div
            className={cn(
              loading
                ? "min-h-0 overflow-y-auto overscroll-contain"
                : "min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6",
              isWorkbench && !loading && "bg-muted/25",
            )}
          >
            {children}
          </div>
          {!loading ? (
            <div
              className={cn(
                "z-10 flex shrink-0 items-center justify-end gap-2 overflow-x-auto border-t bg-background px-4 py-3 sm:px-6",
                isWorkbench && "border-foreground/15",
              )}
            >
              {footer}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
