"use client";

import { money, percent, type TotaisOrcamento } from "./tipos";

/**
 * Fechamento do orçamento. O desconto geral incide sobre a soma dos itens (que já
 * vêm líquidos do desconto de cada um), então precisa aparecer como linha própria
 * para o total bater com o detalhamento acima.
 */
export function ResumoTotais({ totais }: { totais: TotaisOrcamento }) {
  const temDescontoGeral = (totais.descontoGeral ?? 0) > 0;

  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <dl className="ml-auto w-full space-y-2 text-sm sm:max-w-xs">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Produtos</dt>
          <dd className="tabular-nums">{money(totais.totalProdutos)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Serviços</dt>
          <dd className="tabular-nums">{money(totais.totalServicos)}</dd>
        </div>

        {temDescontoGeral ? (
          <>
            <div className="flex items-center justify-between gap-4 border-t pt-2">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{money(totais.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">
                Desconto geral
                {totais.descontoGeralTipo === "PORCENTAGEM"
                  ? ` (${percent(totais.descontoGeralInformado)}%)`
                  : ""}
              </dt>
              <dd className="tabular-nums text-emerald-600 dark:text-emerald-400">
                - {money(totais.descontoGeral)}
              </dd>
            </div>
          </>
        ) : null}

        {(totais.valorFrete ?? 0) > 0 ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Frete</dt>
            <dd className="tabular-nums">+ {money(totais.valorFrete)}</dd>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4 border-t pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(totais.totalGeral)}</dd>
        </div>
      </dl>
    </div>
  );
}
