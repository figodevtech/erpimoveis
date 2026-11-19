import { Loader2 } from "lucide-react";

/** Ocupa a área útil da página enquanto seus dados estão carregando. */
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando página" className="flex min-h-[calc(100dvh-8rem)] w-full items-center justify-center">
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Carregando página…</span>
    </div>
  );
}
