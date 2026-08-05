"use client";

import formatarEmReal from "@/utils/formatarEmReal";
import type { ResumoDePagamentos } from "./payment-totals";

/**
 * Total pago de uma linha das listas de pagamento.
 *
 * Sem taxa de recebimento e um numero so. Havendo taxa, segue a convencao do
 * fluxo de caixa: o liquido em destaque (foi o que entrou no banco) e o bruto
 * embaixo — que e o valor que quita a OS/venda e sustenta o badge de situacao.
 */
export function TotalPago({ resumo }: { resumo: ResumoDePagamentos }) {
  if (!resumo.temTaxa) return <>{formatarEmReal(resumo.bruto)}</>;

  return (
    <div
      className="flex flex-col leading-tight"
      title={`Taxa de recebimento: ${formatarEmReal(resumo.taxa)}`}
    >
      <span>{formatarEmReal(resumo.liquido)}</span>
      <span className="text-[10px] font-normal text-muted-foreground">
        Bruto: {formatarEmReal(resumo.bruto)}
      </span>
    </div>
  );
}
