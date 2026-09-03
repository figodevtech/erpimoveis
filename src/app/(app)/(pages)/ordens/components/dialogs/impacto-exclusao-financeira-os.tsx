"use client";

import { AlertTriangle, Clock3, Loader2, PackageMinus, RefreshCw, Undo2, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPaymentMethodLabel } from "@/lib/payment-methods";
import formatarEmReal from "@/utils/formatarEmReal";
import type { ConsumosDaOs } from "@/lib/ordens/consumo-estoque";

export type TransacaoExcluidaComOs = {
  id: string;
  descricao?: string | null;
  descricao_pagamento?: string | null;
  valor: number;
  valorFace: number;
  valor_acrescimos?: number | null;
  valor_descontos?: number | null;
  valorLiquido?: number | null;
  data?: string | null;
  vencimento_em?: string | null;
  pago_em?: string | null;
  metodopagamento?: string | null;
  pendente: boolean;
  adiantamento_id?: string | null;
  eh_adiantamento?: boolean | null;
  banco?: { id: number; titulo: string } | null;
};

type ImpactoExclusao = {
  osId: number | null;
  versao: number;
  loading: boolean;
  error: string | null;
  transacoes: TransacaoExcluidaComOs[];
  /** O que o cancelamento devolve ao estoque, e o que fica retido. */
  consumos: ConsumosDaOs;
  resumo: {
    quantidade: number;
    valorRecebido: number;
    valorPendente: number;
    valorTotal: number;
  };
};

const estadoVazio: ImpactoExclusao = {
  osId: null,
  versao: -1,
  loading: false,
  error: null,
  transacoes: [],
  consumos: { estornaveis: [], retidos: [] },
  resumo: {
    quantidade: 0,
    valorRecebido: 0,
    valorPendente: 0,
    valorTotal: 0,
  },
};

function formatarData(valor?: string | null) {
  if (!valor) return "Data não informada";
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? "Data não informada"
    : data.toLocaleDateString("pt-BR");
}

export function useImpactoExclusaoFinanceiraOs(osId?: number | null) {
  const [estado, setEstado] = useState<ImpactoExclusao>(estadoVazio);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!osId) return;

    const controller = new AbortController();
    void fetch(`/api/ordens/${osId}/impacto-exclusao-financeira`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Falha ao verificar pagamentos e títulos da OS.");
        }
        setEstado({
          osId,
          versao,
          loading: false,
          error: null,
          transacoes: payload?.transacoes ?? [],
          consumos: payload?.consumos ?? estadoVazio.consumos,
          resumo: payload?.resumo ?? estadoVazio.resumo,
        });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setEstado({
          ...estadoVazio,
          osId,
          versao,
          error: error instanceof Error ? error.message : "Falha ao verificar os lançamentos.",
        });
      });

    return () => controller.abort();
  }, [osId, versao]);

  const recarregar = useCallback(() => setVersao((atual) => atual + 1), []);
  const estadoAtual: ImpactoExclusao = !osId
    ? estadoVazio
    : estado.osId === osId && estado.versao === versao
      ? estado
      : { ...estadoVazio, osId, versao, loading: true };
  const pronto = Boolean(
    osId && !estadoAtual.loading && !estadoAtual.error,
  );
  const ids = useMemo(
    () => (pronto ? estadoAtual.transacoes.map((transacao) => transacao.id) : []),
    [estadoAtual.transacoes, pronto],
  );

  return { ...estadoAtual, pronto, ids, recarregar };
}

export function ImpactoExclusaoFinanceiraOs({
  impacto,
  estornaConsumos = false,
}: {
  impacto: ReturnType<typeof useImpactoExclusaoFinanceiraOs>;
  /**
   * Se esta operacao devolve consumo de estoque ao inventario.
   *
   * So o cancelamento e a recusa do orcamento devolvem — e o gatilho
   * `trg_os_status_estornar` que faz isso. Reiniciar a OS e finalizar sem
   * cobranca deixam o consumo de pe: o material foi usado de verdade, e
   * SEM_COBRANCA existe justamente para manter os custos e zerar a receita.
   */
  estornaConsumos?: boolean;
}) {
  if (impacto.loading || impacto.osId == null) {
    return (
      <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Verificando pagamentos e títulos vinculados...
      </div>
    );
  }

  if (impacto.error) {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="text-destructive">{impacto.error}</p>
        <Button type="button" size="sm" variant="outline" onClick={impacto.recarregar}>
          <RefreshCw className="size-4" /> Tentar novamente
        </Button>
      </div>
    );
  }

  const todosOsConsumos = [...impacto.consumos.estornaveis, ...impacto.consumos.retidos];
  const estornaveis = estornaConsumos ? impacto.consumos.estornaveis : [];
  const retidos = estornaConsumos
    ? impacto.consumos.retidos
    : todosOsConsumos.map((consumo) => ({
        ...consumo,
        motivoRetencao: "Esta operação não devolve o material ao estoque.",
      }));
  const temConsumo = todosOsConsumos.length > 0;
  if (impacto.transacoes.length === 0 && !temConsumo) return null;

  return (
    <div className="space-y-3">
      {impacto.transacoes.length > 0 ? (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
        <p className="flex items-start gap-2 font-semibold">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Esta operação vai contra as diretrizes financeiras do sistema.
        </p>
        <p className="mt-2 leading-relaxed">
          Pagamentos recebidos representam movimentações reais de caixa e títulos pendentes representam compromissos de cobrança. Excluí-los remove a rastreabilidade financeira da OS e pode causar divergência de caixa, conciliação ou cobrança. Se houve recebimento, confirme antes se a devolução ou o ajuste correspondente já foi tratado.
        </p>
      </div>
      ) : null}

      {impacto.transacoes.length > 0 ? (
      <div className="overflow-hidden rounded-lg border">
          <div className="border-b bg-muted/40 p-3 text-sm">
            <p className="font-semibold">
              Exclusão definitiva: {impacto.resumo.quantidade} lançamento(s) · {formatarEmReal(impacto.resumo.valorTotal)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Recebido: {formatarEmReal(impacto.resumo.valorRecebido)} · Títulos pendentes: {formatarEmReal(impacto.resumo.valorPendente)}
            </p>
          </div>
          <div className="max-h-56 divide-y overflow-y-auto">
            {impacto.transacoes.map((transacao) => (
              <div key={transacao.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={transacao.pendente ? "outline" : "default"} className="gap-1">
                      {transacao.pendente ? <Clock3 className="size-3" /> : <WalletCards className="size-3" />}
                      {transacao.pendente ? "Título pendente" : "Pagamento recebido"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">#{transacao.id}</span>
                  </div>
                  <p className="mt-1 truncate font-medium">
                    {transacao.descricao || `Transação #${transacao.id}`}
                  </p>
                  {transacao.descricao_pagamento ? (
                    <p className="truncate text-xs text-muted-foreground">{transacao.descricao_pagamento}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {transacao.pendente ? "Vencimento" : "Pagamento"}: {formatarData(
                      transacao.pendente
                        ? transacao.vencimento_em ?? transacao.data
                        : transacao.pago_em ?? transacao.data,
                    )}
                    {transacao.metodopagamento
                      ? ` · ${formatPaymentMethodLabel(transacao.metodopagamento)}`
                      : ""}
                    {transacao.banco?.titulo ? ` · ${transacao.banco.titulo}` : ""}
                  </p>
                  {transacao.adiantamento_id ? (
                    <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                      Liquidado pela antecipação #{transacao.adiantamento_id}; a movimentação da antecipação não pertence exclusivamente a esta OS e não será apagada.
                    </p>
                  ) : null}
                </div>
                <p className="font-semibold tabular-nums sm:text-right">
                  {formatarEmReal(transacao.valorFace)}
                  {(Number(transacao.valor_acrescimos ?? 0) > 0 ||
                    Number(transacao.valor_descontos ?? 0) > 0) ? (
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      Cobrado {formatarEmReal(transacao.valor)} · Líquido {formatarEmReal(
                        Number(transacao.valorLiquido ?? transacao.valor),
                      )}
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
      </div>
      ) : null}

      {/* O cancelamento tambem mexe no inventario. Sem isto, o item so
          reaparece no estoque depois — e o que NAO volta nunca apareceria. */}
      {temConsumo ? (
        <div className="overflow-hidden rounded-lg border">
          <div className="border-b bg-muted/40 p-3 text-sm">
            <p className="font-semibold">Consumos de estoque desta OS</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {estornaveis.length} volta(m) ao estoque · {retidos.length} permanece(m) fora
            </p>
          </div>
          <div className="max-h-56 divide-y overflow-y-auto">
            {estornaveis.map((consumo) => (
              <div key={consumo.eventoId} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <Badge variant="outline" className="gap-1">
                    <Undo2 className="size-3" /> Volta ao estoque
                  </Badge>
                  <p className="mt-1 truncate font-medium">{consumo.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {consumo.quantidade} {consumo.unidade ?? "UN"}
                    {consumo.itemTitulo ? ` · ${consumo.itemTitulo}` : ""}
                  </p>
                </div>
                <p className="font-semibold tabular-nums sm:text-right">
                  {formatarEmReal(consumo.valor)}
                </p>
              </div>
            ))}
            {retidos.map((consumo) => (
              <div key={consumo.eventoId} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <Badge variant="default" className="gap-1">
                    <PackageMinus className="size-3" /> Permanece fora do estoque
                  </Badge>
                  <p className="mt-1 truncate font-medium">{consumo.descricao}</p>
                  <p className="text-xs text-muted-foreground">{consumo.motivoRetencao}</p>
                </div>
                <p className="font-semibold tabular-nums sm:text-right">
                  {formatarEmReal(consumo.valor)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
