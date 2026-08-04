"use client";

import { ArrowRight, History, PencilRuler, ReceiptText } from "lucide-react";

import formatarEmReal from "@/utils/formatarEmReal";

import { Campo, Cartao, fmtDateTime, fmtText } from "./shared";
import type { TransacaoContexto } from "./types";

export function HistoricoTab({
  baixa,
  ajustes,
  auditoria,
}: {
  baixa: TransacaoContexto["baixa"];
  ajustes: TransacaoContexto["ajustes"];
  auditoria: TransacaoContexto["auditoria"];
}) {
  return (
    <div className="space-y-3">
      <Cartao titulo="Baixa do pagamento" icone={<ReceiptText className="h-3.5 w-3.5" />}>
        {baixa ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Vencimento">{fmtDateTime(baixa.vencimento_em)}</Campo>
            <Campo label="Pago em">{fmtDateTime(baixa.pago_em)}</Campo>
            <Campo label="Baixado por">{fmtText(baixa.baixadoPor?.nome)}</Campo>
            <Campo label="Método na baixa">{fmtText(baixa.metodopagamento)}</Campo>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma baixa registrada. O histórico é gravado quando um lançamento
            pendente é baixado — transações já registradas como realizadas não
            passam por essa etapa.
          </p>
        )}
      </Cartao>

      <Cartao
        titulo="Ajustes de valor"
        icone={<PencilRuler className="h-3.5 w-3.5" />}
      >
        {ajustes.length ? (
          <ul className="space-y-2">
            {ajustes.map((ajuste) => {
              const bruto = Number(ajuste.valor_anterior) !== Number(ajuste.valor_novo);
              const liquido =
                Number(ajuste.valor_liquido_anterior ?? 0) !==
                Number(ajuste.valor_liquido_novo ?? 0);

              return (
                <li key={ajuste.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {bruto ? (
                      <span className="flex items-center gap-1.5 font-medium tabular-nums">
                        Bruto {formatarEmReal(Number(ajuste.valor_anterior))}
                        <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                        {formatarEmReal(Number(ajuste.valor_novo))}
                      </span>
                    ) : null}
                    {liquido ? (
                      <span className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                        Líquido {formatarEmReal(Number(ajuste.valor_liquido_anterior ?? 0))}
                        <ArrowRight className="h-3 w-3" aria-hidden />
                        {formatarEmReal(Number(ajuste.valor_liquido_novo ?? 0))}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fmtDateTime(ajuste.created_at)} · {fmtText(ajuste.alteradoPor?.nome)}
                  </p>
                  {ajuste.motivo ? (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      “{ajuste.motivo}”
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Os valores nunca foram ajustados depois do registro.
          </p>
        )}
      </Cartao>

      <Cartao titulo="Auditoria" icone={<History className="h-3.5 w-3.5" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Criada em">{fmtDateTime(auditoria.created_at)}</Campo>
          <Campo label="Criada por">{fmtText(auditoria.criadoPor?.nome)}</Campo>
          <Campo label="Última alteração">{fmtDateTime(auditoria.updated_at)}</Campo>
          <Campo label="Alterada por">{fmtText(auditoria.alteradoPor?.nome)}</Campo>
          <Campo label="Registrada/baixada por">
            {fmtText(auditoria.baixadoPor?.nome)}
          </Campo>
        </div>
      </Cartao>
    </div>
  );
}
