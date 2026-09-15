"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { PrintGroupingMenu, type PrintFilterOption } from "@/app/(app)/(full)/components/PrintFilterMenu";

type Agrupamento = "NENHUM" | "BANCO";

const OPCOES: PrintFilterOption<Agrupamento>[] = [
  { value: "NENHUM", label: "Sem agrupamento" },
  { value: "BANCO", label: "Por banco" },
];

/**
 * O agrupamento mora no endereço, e não em estado: a folha é montada no
 * servidor, que precisa ler a história das contas para calcular o saldo. Trocar
 * a opção recarrega a folha com o parâmetro novo — e o link copiado reabre igual.
 */
export function FluxoAgrupamentoMenu({ consulta, agrupamento }: { consulta: string; agrupamento: Agrupamento }) {
  const router = useRouter();
  const pathname = usePathname();
  const [carregando, iniciar] = useTransition();

  function trocar(proximo: Agrupamento) {
    if (proximo === agrupamento) return;
    const params = new URLSearchParams(consulta);
    if (proximo === "BANCO") params.set("agrupar", "banco");
    else params.delete("agrupar");
    iniciar(() => router.replace(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="flex items-center gap-2">
      <PrintGroupingMenu options={OPCOES} value={agrupamento} onChange={trocar} />
      {carregando && (
        <span className="flex items-center gap-1 text-xs text-neutral-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Montando a folha...
        </span>
      )}
    </div>
  );
}
