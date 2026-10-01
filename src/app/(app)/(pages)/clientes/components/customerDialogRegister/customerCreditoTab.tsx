"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { CircleDollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { toast } from "@/lib/toast";

import { OSDetalhesDialog } from "../../../ordens/components/dialogs/detalhes-os-dialog";
import { VendaDetailsDialog } from "../../../(vendas)/historicovendas/components/venda-detail-dialog";
import type { Customer, SaldoMovimentoCliente } from "../../types";
import { formatCpfCnpj } from "./utils";

import { CreditBalanceCard } from "./credito/creditBalanceCard";
import { CreditMovementItem } from "./credito/creditMovementItem";
import { CreditAdjustmentDialog } from "./credito/creditAdjustmentDialog";
import {
  CreditDeleteDialog,
  CreditEmptyState,
  CreditErrorState,
  CreditLoadingState,
} from "./credito/creditStates";
import type { ModoLancamento, Sentido } from "./credito/types";

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

function CustomerContext({ customer }: { customer: Customer }) {
  return (
    <div className="mb-4 flex min-w-0 items-center gap-3 rounded-xl border bg-muted/35 px-4 py-3">
      <span className="rounded-full bg-background p-2 shadow-xs">
        <CircleDollarSign className="size-5 text-primary" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" title={customer.nomerazaosocial}>
          {customer.nomerazaosocial}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatCpfCnpj(customer.cpfcnpj, customer.tipopessoa)}
        </p>
      </div>
    </div>
  );
}

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

  return (
    <TabsContent value="Credito" className="h-full min-h-0 overflow-hidden p-0">
      <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 sm:px-6">
        {/* Identificação de contexto do cliente (consistente com Vendas e Financeiro) */}
        <CustomerContext customer={customer} />

        {loading ? (
          <CreditLoadingState />
        ) : error ? (
          <CreditErrorState retry={() => void carregar()} />
        ) : (
          <div className="space-y-5">
            {/* Card Principal da Carteira Financeira */}
            <CreditBalanceCard
              saldo={saldo}
              podeAjustar={podeAjustar}
              onAdicionar={() => setLancamento({ tipo: "criar", sentido: "CREDITO" })}
              onRemover={() => setLancamento({ tipo: "criar", sentido: "DEBITO" })}
            />

            {/* Cabeçalho do Extrato Financeiro */}
            <div className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-base tracking-tight text-foreground">
                    Movimentações
                  </h3>
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    Histórico completo da carteira e conciliação de créditos do cliente
                  </p>
                </div>
                {dados && (
                  <Badge variant="outline" className="w-fit text-xs font-medium tabular-nums text-muted-foreground">
                    {dados.total} {dados.total === 1 ? "movimentação" : "movimentações"}
                  </Badge>
                )}
              </div>

              {/* Lista / Razão Financeiro */}
              {movimentos.length === 0 ? (
                <CreditEmptyState
                  podeAjustar={podeAjustar}
                  onAdicionar={() => setLancamento({ tipo: "criar", sentido: "CREDITO" })}
                />
              ) : (
                <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
                  <ul className="divide-y divide-border/60">
                    {movimentos.map((movimento) => (
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
                </div>
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
