"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { TabsContent } from "@/components/ui/tabs";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { OSDetalhesDialog } from "../../../ordens/components/dialogs/detalhes-os-dialog";
import { VendaDetailsDialog } from "../../../(vendas)/historicovendas/components/venda-detail-dialog";
import type { Customer, SaldoMovimentoCliente } from "../../types";

import { CreditBalanceCard } from "./credito/creditBalanceCard";
import { COLUNAS_EXTRATO, CreditMovementItem } from "./credito/creditMovementItem";
import { CreditAdjustmentDialog } from "./credito/creditAdjustmentDialog";
import {
  CreditDeleteDialog,
  CreditEmptyState,
  CreditErrorState,
  CreditLoadingState,
} from "./credito/creditStates";
import { agruparPorDia, type ModoLancamento, type Sentido } from "./credito/types";

type CustomerCreditoTabProps = {
  customer: Customer;
};

type SaldoResponse = {
  data: {
    saldo: number;
    movimentos: SaldoMovimentoCliente[];
    total: number;
  };
};

export default function CustomerCreditoTab({ customer }: CustomerCreditoTabProps) {
  const { data: session } = useSession();
  const podeAjustar = permissionSetHas(
    (session?.user as { permissoes?: string[] } | undefined)?.permissoes,
    PERMS.FINANCEIRO_EDITAR,
  );

  const [dados, setDados] = useState<SaldoResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [lancamento, setLancamento] = useState<ModoLancamento | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [paraExcluir, setParaExcluir] = useState<SaldoMovimentoCliente | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [osAberta, setOsAberta] = useState<number | null>(null);
  const [vendaAberta, setVendaAberta] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    if (!customer.id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);

    try {
      const response = await fetch(`/api/customers/${customer.id}/saldo?limit=50`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Falha ao carregar o crédito do cliente.");
      setDados((body as SaldoResponse).data);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [customer.id]);

  useEffect(() => {
    setDados(null);
    setError(false);
    abortRef.current?.abort();
  }, [customer.id]);

  useEffect(() => {
    if (customer.id && !dados && !loading && !error) {
      void carregar();
    }
  }, [carregar, customer.id, dados, error, loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function confirmarLancamento({
    sentido,
    valor,
    motivo,
  }: {
    sentido: Sentido;
    valor: number;
    motivo: string;
  }) {
    if (!lancamento || salvando) return;
    const editando = lancamento.tipo === "editar";
    setSalvando(true);
    try {
      const response = await fetch(
        editando
          ? `/api/customers/${customer.id}/saldo/${lancamento.movimento.id}`
          : `/api/customers/${customer.id}/saldo`,
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sentido, valor, motivo: motivo.trim() || undefined }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Não foi possível salvar o lançamento.");

      toast.success(
        editando
          ? "Lançamento atualizado com sucesso."
          : sentido === "CREDITO"
            ? "Crédito adicionado à carteira."
            : "Crédito removido da carteira.",
      );
      setLancamento(null);
      await carregar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar o lançamento.");
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    if (!paraExcluir || excluindo) return;
    setExcluindo(true);
    try {
      const response = await fetch(`/api/customers/${customer.id}/saldo/${paraExcluir.id}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Não foi possível excluir o lançamento.");

      toast.success("Lançamento excluído e saldo recalculado.");
      setParaExcluir(null);
      await carregar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível excluir o lançamento.");
    } finally {
      setExcluindo(false);
    }
  }

  const saldo = dados?.saldo ?? 0;
  const movimentos = dados?.movimentos ?? [];
  const grupos = agruparPorDia(movimentos);

  return (
    <TabsContent value="Credito" className="h-full min-h-0 overflow-hidden p-0">
      <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 sm:px-6">
        {loading ? (
          <CreditLoadingState />
        ) : error ? (
          <CreditErrorState retry={() => void carregar()} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <CreditBalanceCard
              customer={customer}
              saldo={saldo}
              podeAjustar={podeAjustar}
              onAdicionar={() => setLancamento({ tipo: "criar", sentido: "CREDITO" })}
              onRemover={() => setLancamento({ tipo: "criar", sentido: "DEBITO" })}
            />

            <div className="border-t">
              {movimentos.length === 0 ? (
                <CreditEmptyState
                  podeAjustar={podeAjustar}
                  onAdicionar={() => setLancamento({ tipo: "criar", sentido: "CREDITO" })}
                />
              ) : (
                <>
                  <div
                    aria-hidden="true"
                    className={cn(
                      "hidden gap-x-3 border-b bg-muted/30 px-6 py-2 text-xs text-muted-foreground sm:grid",
                      COLUNAS_EXTRATO,
                    )}
                  >
                    <span>Hora</span>
                    <span>Histórico</span>
                    <span className="text-right">Valor (R$)</span>
                    <span className="text-right">Saldo (R$)</span>
                  </div>

                  <ul aria-label="Extrato de crédito">
                    {grupos.map((grupo) => (
                      <li key={grupo.chave}>
                        <p className="flex items-center gap-3 px-4 pb-1 pt-4 text-xs font-medium text-muted-foreground sm:px-6">
                          {grupo.rotulo}
                          <span className="h-px flex-1 bg-border" aria-hidden="true" />
                        </p>
                        <ul>
                          {grupo.itens.map((movimento) => (
                            <CreditMovementItem
                              key={movimento.id}
                              movimento={movimento}
                              podeAjustar={podeAjustar}
                              onEditar={() => setLancamento({ tipo: "editar", movimento })}
                              onExcluir={() => setParaExcluir(movimento)}
                              onAbrirDocumento={(doc) =>
                                doc.tipo === "venda" ? setVendaAberta(doc.id) : setOsAberta(doc.id)
                              }
                            />
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>

                  {dados && dados.total > movimentos.length && (
                    <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
                      Mostrando os {movimentos.length} lançamentos mais recentes de {dados.total}.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Diálogo de Adicionar / Remover / Editar Crédito */}
      <CreditAdjustmentDialog
        key={
          lancamento === null
            ? "fechado"
            : lancamento.tipo === "editar"
              ? `editar-${lancamento.movimento.id}`
              : `criar-${lancamento.sentido}`
        }
        modo={lancamento}
        saldoAtual={saldo}
        salvando={salvando}
        onFechar={() => setLancamento(null)}
        onConfirmar={confirmarLancamento}
      />

      {/* Diálogo de Confirmação de Exclusão */}
      <CreditDeleteDialog
        movimento={paraExcluir}
        excluindo={excluindo}
        onFechar={() => setParaExcluir(null)}
        onConfirmar={() => void confirmarExclusao()}
      />

      {/* Diálogos de detalhes de Venda e Ordem de Serviço */}
      <OSDetalhesDialog
        open={osAberta !== null}
        osId={osAberta}
        onOpenChange={(aberto) => {
          if (!aberto) setOsAberta(null);
        }}
      />
      <VendaDetailsDialog
        vendaId={vendaAberta}
        open={vendaAberta !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setVendaAberta(null);
        }}
      />
    </TabsContent>
  );
}
