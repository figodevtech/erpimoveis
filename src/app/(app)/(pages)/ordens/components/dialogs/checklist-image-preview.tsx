"use client";

import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ChecklistImagePreviewProps = {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
};

export function ChecklistImagePreview({
  src,
  alt,
  className,
  imageClassName,
}: ChecklistImagePreviewProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "group/checklist-image relative block h-full w-full cursor-zoom-in overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
            className,
          )}
          aria-label={`Ampliar ${alt}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className={cn("h-full w-full object-cover", imageClassName)} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/checklist-image:bg-black/25 group-focus-visible/checklist-image:bg-black/25">
            <span className="rounded-full bg-background/90 p-2 text-foreground opacity-0 shadow-sm transition-opacity group-hover/checklist-image:opacity-100 group-focus-visible/checklist-image:opacity-100">
              <Maximize2 className="h-4 w-4" />
            </span>
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="flex h-[90vh] w-[95vw] max-w-6xl flex-col gap-3 border-border/40 bg-black/95 p-3 text-white sm:max-w-6xl">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle className="truncate text-sm font-medium text-white">{alt}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
