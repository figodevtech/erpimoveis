import { PageLoading } from "@/components/page-loading";
// src/app/(app)/(pages)/meu-perfil/page.tsx
import { Suspense } from "react";
import { MeuPerfilClient } from "./meu-perfil-client";

export const metadata = {
  title: "Meu Perfil",
};

/**
 * Sem geracao estatica: a tela e autenticada e 100% client-side, entao o
 * prerender nao entregaria nada util — e a arvore de `motion/react` nao
 * sobrevive a ele neste setup de webpack (mesma falha que ja atinge /ordens).
 */
export const dynamic = "force-dynamic";

function CarregandoCentral() { return <PageLoading />; }

export default function Page() {
  // `useSearchParams` no client exige um limite de Suspense no servidor.
  return (
    <Suspense fallback={<CarregandoCentral />}>
      <MeuPerfilClient />
    </Suspense>
  );
}
