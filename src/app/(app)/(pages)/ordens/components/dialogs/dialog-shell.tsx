"use client";
import { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

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
}) {
  const fixedHeightClass = fixedHeight
    ? "h-[100dvh] max-h-[100dvh]"
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          mobileFull
            ? `h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] min-w-0 overflow-hidden rounded-none p-0 sm:w-[95vw] sm:max-w-[95vw] sm:rounded-lg md:max-w-3xl ${maxW}`
            : `p-0 w-[96vw] sm:max-w-[95vw] md:max-w-3xl ${fixedHeightClass} ${maxW}`
        }
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
            <div className="flex items-start justify-between gap-4 border-b px-4 py-3 sm:px-6">
              <div className="space-y-1">
                <DialogTitle className="text-base font-semibold tracking-tight sm:text-lg">
                  {title}
                  {titleSuffix ? (
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      | {titleSuffix}
                    </span>
                  ) : null}
                </DialogTitle>
                {description ? (
                  <DialogDescription className="text-sm">{description}</DialogDescription>
                ) : null}
              </div>
            </div>
          ) : null}
          <div
            className={
              loading
                ? "min-h-0 overflow-y-auto overscroll-contain"
                : "min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6"
            }
          >
            {children}
          </div>
          {!loading ? (
            <div className="z-10 flex shrink-0 items-center justify-end gap-2 overflow-x-auto border-t bg-background px-4 py-3 sm:px-6">
              {footer}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
