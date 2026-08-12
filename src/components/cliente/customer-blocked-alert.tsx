import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function CustomerBlockedAlert({
  status,
  className,
}: {
  status?: string | null;
  className?: string;
}) {
  if (status !== "INATIVO") return null;

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
