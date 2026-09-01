import React from "react";

import { Badge } from "@/components/ui/badge";
import type { ItemHistoricoDetalhado } from "@/lib/ordens/itens-historicos";

function formatarMoeda(valor: number) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarQuantidade(valor: number) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    maximumFractionDigits: 4,
  });
}

export function ItemHistoricoResumo({ item }: { item: ItemHistoricoDetalhado }) {
  return (
    <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-2.5 py-2 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-words font-medium" title={item.descricao}>
              {item.descricao}
            </span>
            <Badge
              variant="outline"
              className="h-5 border-sky-500/40 bg-sky-500/10 px-1.5 text-[10px] text-sky-700 dark:text-sky-300"
            >
              Histórico migrado
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {item.codigoLegado ? `Código legado ${item.codigoLegado} · ` : ""}
            {formatarQuantidade(item.quantidade)} {item.unidade ? `${item.unidade} ` : ""}×{" "}
            {formatarMoeda(item.precoUnitario)}
          </p>
        </div>
        <span className="shrink-0 font-medium tabular-nums">
          {formatarMoeda(item.subtotal)}
        </span>
      </div>
    </div>
  );
}
