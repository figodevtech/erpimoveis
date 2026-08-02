// src/app/(app)/(pages)/meu-perfil/page.tsx
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MeuPerfilClient } from "./meu-perfil-client";

export const metadata = {
  title: "Meu perfil",
};

/**
 * Sem geracao estatica: a tela e autenticada e 100% client-side, entao o
 * prerender nao entregaria nada util — e a arvore de `motion/react` nao
 * sobrevive a ele neste setup de webpack (mesma falha que ja atinge /ordens).
 */
export const dynamic = "force-dynamic";

function CarregandoCentral() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, indice) => (
          <Skeleton key={indice} className="h-28 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-lg" />
    </div>
  );
}

export default function Page() {
  // `useSearchParams` no client exige um limite de Suspense no servidor.
  return (
    <Suspense fallback={<CarregandoCentral />}>
      <MeuPerfilClient />
    </Suspense>
  );
}
