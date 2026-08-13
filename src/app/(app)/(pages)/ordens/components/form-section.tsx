import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function OrdemFormSection({
  icon: Icon,
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="min-w-0">
          <header className="flex items-start gap-3 border-b border-border bg-muted/25 px-3 py-3 sm:px-4">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center border border-border bg-background text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-foreground">
                {title}
              </h2>
              {description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
          </header>

          <div className={cn("p-3 sm:p-4", contentClassName)}>{children}</div>
      </div>
    </section>
  );
}
