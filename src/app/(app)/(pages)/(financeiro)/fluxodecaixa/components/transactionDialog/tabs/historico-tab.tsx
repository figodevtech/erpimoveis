"use client";

import { History, ReceiptText } from "lucide-react";

import { Campo, Cartao, fmtDateTime, fmtText } from "./shared";
import type { TransacaoContexto } from "./types";

export function HistoricoTab({
  baixa,
  auditoria,
}: {
  baixa: TransacaoContexto["baixa"];
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
