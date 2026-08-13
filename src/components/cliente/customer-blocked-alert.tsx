import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function CustomerBlockedAlert({
  status,
  className,
  compact = false,
}: {
  status?: string | null;
  className?: string;
  compact?: boolean;
}) {
  if (status !== "INATIVO") return null;

  if (compact) {
    return (
      <div
        role="alert"
        className={cn(
          "flex w-full items-start gap-2 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300",
          className,
        )}
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>
          <span className="font-semibold">Cliente bloqueado.</span>{" "}
          O aviso é informativo e não impede a continuação da operação.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("w-full shrink-0 px-4 pt-3 sm:px-6", className)}>
      <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-200">
        <AlertTriangle className="text-amber-600 dark:text-amber-400" />
        <AlertTitle>Cliente bloqueado</AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-300">
          Este cliente está inativo. O aviso é informativo e não impede a continuação da operação.
        </AlertDescription>
      </Alert>
    </div>
  );
}
