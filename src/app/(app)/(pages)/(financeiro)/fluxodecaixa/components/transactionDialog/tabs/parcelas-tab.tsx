"use client";

import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import formatarEmReal from "@/utils/formatarEmReal";

import { EstadoVazio, fmtDate, fmtDateTime } from "./shared";
import type { LancamentoRelacionado, ResumoRelacionadas, OrigemRelacionadas } from "./types";

function Indicador({
  label,
  valor,
  destaque = false,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${destaque ? "border-primary bg-primary/5" : "bg-card"}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-bold ${destaque ? "text-base text-primary" : "text-sm"}`}
      >
        {valor}
      </p>
    </div>
  );
}

export function ParcelasTab({
  origem,
  itens,
  resumo,
  transacaoAtualId,
}: {
  origem: OrigemRelacionadas;
  itens: LancamentoRelacionado[];
  resumo: ResumoRelacionadas;
  transacaoAtualId: number;
}) {
  if (origem === "NENHUM" || itens.length === 0) {
    return (
      <EstadoVazio>
        Esta transação é avulsa e não faz parte de um parcelamento nem está
        vinculada a uma ordem de serviço ou venda.
      </EstadoVazio>
    );
  }

  const temTotalDevido = resumo.totalDevido != null && resumo.totalDevido > 0;
  const percentualPago = temTotalDevido
    ? Math.min(100, (resumo.pago / (resumo.totalDevido as number)) * 100)
    : resumo.lancado > 0
      ? (resumo.pago / resumo.lancado) * 100
      : 0;
  const quitado = temTotalDevido && (resumo.restante ?? 0) <= 0;

  const rotuloOrigem =
    origem === "OS"
      ? "Pagamentos desta ordem de serviço"
      : origem === "VENDA"
        ? "Pagamentos desta venda"
        : "Parcelas deste lançamento";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">{rotuloOrigem}</p>
        <p className="text-xs text-muted-foreground">
          {itens.length} lançamento{itens.length === 1 ? "" : "s"} encontrado
          {itens.length === 1 ? "" : "s"}.
        </p>
      </div>

      {origem === "PARCELAMENTO" && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Parcelamento avulso: as parcelas não têm vínculo formal no banco, então
            foram agrupadas pelo momento do registro e pela descrição. Se alguma
            descrição tiver sido editada, o grupo pode ficar incompleto.
          </span>
        </div>
      )}

      <div
        className={`grid gap-2 ${temTotalDevido ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
      >
        {temTotalDevido && (
          <Indicador
            label={origem === "OS" ? "Total da OS" : "Total da venda"}
            valor={formatarEmReal(resumo.totalDevido as number)}
          />
        )}
        <Indicador label="Pago" valor={formatarEmReal(resumo.pago)} />
        <Indicador label="Pendente" valor={formatarEmReal(resumo.pendente)} />
        <Indicador
          label={temTotalDevido ? "Falta para quitar" : "Total lançado"}
          valor={formatarEmReal(
            temTotalDevido ? (resumo.restante as number) : resumo.lancado,
          )}
          destaque
        />
      </div>

      <div className="space-y-1">
        <Progress value={percentualPago} className="h-2" />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{percentualPago.toFixed(0)}% pago</span>
          {quitado ? (
            <span className="flex items-center gap-1 font-medium text-emerald-600">
              <CheckCircle2 className="h-3 w-3" />
              Quitado
            </span>
          ) : temTotalDevido ? (
            <span>
              Restam {formatarEmReal(resumo.restante as number)} para finalizar
            </span>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Descrição</th>
                <th className="px-3 py-2 font-semibold">Data</th>
                <th className="px-3 py-2 font-semibold">Situação</th>
                <th className="px-3 py-2 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => {
                const atual = item.id === transacaoAtualId;
                const bruto = Number(item.valor ?? 0);
                const liquido = Number(item.valorLiquido ?? item.valor ?? 0);
                // Taxa de recebimento (cartao, por exemplo): o cliente pagou o
                // bruto, o caixa recebeu o liquido. Os indicadores acima somam o
                // bruto, que e o que abate o total da OS/venda.
                const possuiTaxa = Math.round(bruto * 100) !== Math.round(liquido * 100);

                return (
                  <tr
                    key={item.id}
                    className={`border-t ${atual ? "bg-primary/5" : ""}`}
                  >
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {item.id}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col">
                        <span className={atual ? "font-semibold" : ""}>
                          {item.descricao}
                        </span>
                        {item.descricao_pagamento && (
                          <span className="text-xs italic text-muted-foreground">
                            {item.descricao_pagamento}
                          </span>
                        )}
                        <span className="flex flex-wrap items-center gap-1 pt-1">
                          {atual && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              Esta transação
                            </Badge>
                          )}
                          {!item.contaParaTotal && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              Não abate o total
                            </Badge>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      <div>{fmtDate(item.data)}</div>
                      {item.pago_em && (
                        <div className="text-muted-foreground">
                          Baixa: {fmtDateTime(item.pago_em)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {item.pendente ? (
                        <span className="flex items-center gap-1 text-xs text-amber-600">
                          <Clock className="h-3 w-3" />
                          Pendente
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="h-3 w-3" />
                          Realizada
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right align-top font-medium">
                      <div className="flex flex-col items-end">
                        <span>{formatarEmReal(bruto)}</span>
                        {possuiTaxa && (
                          <span className="text-xs font-normal text-muted-foreground">
                            Líquido: {formatarEmReal(liquido)}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
