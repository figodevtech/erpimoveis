"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  CreditCard,
  Eye,
  Info,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Sparkles,
  Split,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import ConcluidoAlert from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/concluidoAlert";
import TransactionDialog from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog";
import type { Transaction } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { valorDeFace, valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import {
  podeRegistrarPagamentoOs,
  type ResumoFinanceiroOs,
} from "@/lib/ordens/financeiro";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";

type PagamentoMultiploDaLinha = {
  id: number;
  descricao: string | null;
  modo: "AVISTA" | "PARCELADO";
  valor_total: number;
  documentos: number;
};

type TransacaoOs = Transaction & {
  data: Date;
  vencimento_em?: string | null;
  pago_em?: string | null;
  banco?: { id: number; titulo: string } | null;
  pagamento_multiplo?: PagamentoMultiploDaLinha | null;
};

/**
 * Selo do rateio.
 *
 * Uma linha de R$ 333,33 sem contexto parece valor arbitrário. O selo responde de
 * onde ela veio: um pagamento maior, dividido entre vários documentos.
 */
function SeloPagamentoMultiplo({ grupo }: { grupo: PagamentoMultiploDaLinha }) {
  return (
    <span className="mt-1 inline-flex flex-wrap items-center gap-1.5">
      <Badge
        variant="outline"
        className="gap-1 border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      >
        <Split className="size-3 shrink-0" aria-hidden />
        Pagamento múltiplo #{grupo.id}
      </Badge>
      <span className="text-[11px] text-muted-foreground">
        Parte de {formatarEmReal(grupo.valor_total)} rateado entre {grupo.documentos}{" "}
        documento{grupo.documentos === 1 ? "" : "s"}
        {grupo.modo === "PARCELADO" ? " · parcelado" : ""}
      </span>
    </span>
  );
}

type PayloadFinanceiro = {
  ordem: { id: number; status: string };
  resumo: ResumoFinanceiroOs;
  transacoes: TransacaoOs[];
};

function formatarData(valor?: string | Date | null) {
  if (!valor) return "—";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "—" : data.toLocaleDateString("pt-BR");
}

type ColorScheme = "blue" | "emerald" | "amber" | "indigo" | "sky";

function CartaoResumo({
  titulo,
  valor,
  detalhe,
  icon: Icon,
  scheme = "blue",
}: {
  titulo: string;
  valor: number;
  detalhe?: string;
  icon: React.ElementType;
  scheme?: ColorScheme;
}) {
  const schemeStyles: Record<ColorScheme, { iconBg: string; borderHover: string }> = {
    blue: {
      iconBg: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
      borderHover: "hover:border-blue-500/30",
    },
    emerald: {
      iconBg: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
      borderHover: "hover:border-emerald-500/30",
    },
    amber: {
      iconBg: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
      borderHover: "hover:border-amber-500/30",
    },
    indigo: {
      iconBg: "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400",
      borderHover: "hover:border-indigo-500/30",
    },
    sky: {
      iconBg: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400",
      borderHover: "hover:border-sky-500/30",
    },
  };

  const currentScheme = schemeStyles[scheme];

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-card/95 p-4 shadow-sm transition-all duration-200 hover:shadow-md ${currentScheme.borderHover}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {titulo}
        </span>
        <div className={`rounded-lg p-2 transition-transform duration-200 group-hover:scale-105 ${currentScheme.iconBg}`}>
          <Icon className="size-4" />
        </div>
      </div>

      <div className="mt-2">
        <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
          {formatarEmReal(valor)}
        </p>
        {detalhe ? (
          <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
        ) : null}
      </div>
    </div>
  );
}

function ProgressoQuitacao({
  resumo,
}: {
  resumo: ResumoFinanceiroOs;
}) {
  const total = Number(resumo.totalDevido ?? 0);
  const recebido = Number(resumo.valorRecebido ?? 0);
  const pendente = Number(resumo.valorPendente ?? 0);

  const pctRecebido = total > 0 ? Math.min(100, Math.max(0, Math.round((recebido / total) * 100))) : 0;
  const pctPendente = total > 0 ? Math.min(100 - pctRecebido, Math.max(0, Math.round((pendente / total) * 100))) : 0;
  const pctEmAberto = Math.max(0, 100 - pctRecebido - pctPendente);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
            <TrendingUp className="size-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">Progresso de Quitação</h4>
            <p className="text-xs text-muted-foreground">
              {pctRecebido}% recebido de {formatarEmReal(total)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-500" />
            Recebido ({pctRecebido}%)
          </span>
          <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
            <span className="size-2 rounded-full bg-amber-500" />
            Pendente ({pctPendente}%)
          </span>
          {pctEmAberto > 0 ? (
            <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <span className="size-2 rounded-full bg-slate-300 dark:bg-slate-600" />
              A receber ({pctEmAberto}%)
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          style={{ width: `${pctRecebido}%` }}
          className="bg-emerald-500 transition-all duration-500 ease-out"
          title={`Recebido: ${formatarEmReal(recebido)} (${pctRecebido}%)`}
        />
        <div
          style={{ width: `${pctPendente}%` }}
          className="bg-amber-500 transition-all duration-500 ease-out"
          title={`Pendente: ${formatarEmReal(pendente)} (${pctPendente}%)`}
        />
      </div>
    </div>
  );
}

export function FinanceiroOsTab({
  osId,
  status,
  podeCriar,
  podeEditar,
  podeExcluir,
  onChanged,
}: {
  osId: number;
  status: string;
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<PayloadFinanceiro | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTransactionId, setSelectedTransactionId] = useState<number>();
  const [baixaOpen, setBaixaOpen] = useState(false);
  const [transacaoParaBaixa, setTransacaoParaBaixa] = useState<TransacaoOs | null>(null);
  const [transacaoParaExcluir, setTransacaoParaExcluir] = useState<TransacaoOs | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/ordens/${osId}/financeiro`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Erro ao carregar o financeiro da OS");
      setPayload({
        ...data,
        transacoes: (data.transacoes ?? []).map((transacao: any) => ({
          ...transacao,
          data: new Date(transacao.data),
        })),
      });
    } catch (error) {
      setPayload(null);
      toast.error(error instanceof Error ? error.message : "Erro ao carregar o financeiro da OS");
    } finally {
      setLoading(false);
    }
  }, [osId]);

  const recarregarTudo = useCallback(async () => {
    await carregar();
    await onChanged?.();
  }, [carregar, onChanged]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const statusAtual = String(payload?.ordem?.status ?? status).toUpperCase();
  const podeAdicionar =
    podeCriar &&
    podeRegistrarPagamentoOs(statusAtual) &&
    Number(payload?.resumo?.saldoDisponivelParaLancamento ?? 0) > 0;
  const transacoes = payload?.transacoes ?? [];
  const resumo = payload?.resumo;
  const valorInicial = Number(resumo?.saldoDisponivelParaLancamento ?? 0);
  const initialTransaction = useMemo(
    () => ({
      valor: valorInicial,
      valorLiquido: valorInicial,
      pendente: false,
      parcelas: 1,
      data: new Date(),
    }),
    [valorInicial],
  );

  async function excluirTransacao() {
    if (!transacaoParaExcluir || excluindo) return;
    setExcluindo(true);
    try {
      const response = await fetch(`/api/transaction/${transacaoParaExcluir.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Erro ao excluir a transação");
      toast.success("Transação excluída.");
      setTransacaoParaExcluir(null);
      await recarregarTudo();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao excluir a transação");
    } finally {
      setExcluindo(false);
    }
  }

  if (loading && !payload) {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-card/60 p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <Loader2 className="size-6 animate-spin" />
          </div>
          <div>
            <p className="text-sm font-medium">Carregando financeiro da OS...</p>
            <p className="text-xs text-muted-foreground">Buscando transações e balanço atualizado</p>
          </div>
        </div>
      </div>
    );
  }

  if (!payload || !resumo) {
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-card/60 p-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <AlertCircle className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Não foi possível carregar o financeiro da OS.</p>
          <Button variant="outline" size="sm" onClick={() => void carregar()} className="mt-2 gap-1.5">
            <RefreshCw className="size-3.5" /> Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Visual Progress Bar */}
      <ProgressoQuitacao resumo={resumo} />

      {/* Metric Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <CartaoResumo
          titulo="Total devido"
          valor={resumo.totalDevido}
          icon={Receipt}
          scheme="blue"
        />
        <CartaoResumo
          titulo="Recebido"
          valor={resumo.valorRecebido}
          icon={CheckCircle2}
          scheme="emerald"
        />
        <CartaoResumo
          titulo="Títulos pendentes"
          valor={resumo.valorPendente}
          icon={Clock3}
          scheme="amber"
        />
        <CartaoResumo
          titulo="Saldo a receber"
          valor={resumo.saldoAReceber}
          icon={CreditCard}
          scheme="indigo"
        />
        <CartaoResumo
          titulo="Disponível p/ lançar"
          valor={resumo.saldoDisponivelParaLancamento}
          icon={Sparkles}
          scheme="sky"
        />
      </div>

      {/* Main Section Card */}
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Header toolbar */}
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <WalletCards className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold tracking-tight text-foreground">Transações da OS</h3>
                <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs font-semibold">
                  {transacoes.length}
                </Badge>
              </div>
              <button
                type="button"
                onClick={() => void carregar()}
                className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
                Atualizar dados
              </button>
            </div>
          </div>

          <TransactionDialog
            osId={osId}
            open={dialogOpen}
            setOpen={setDialogOpen}
            selectedTransactionId={selectedTransactionId}
            setSelectedTransactionId={setSelectedTransactionId}
            handleGetTransactions={() => void recarregarTudo()}
            initialTransaction={initialTransaction}
            editable={podeEditar}
          >
            {podeCriar ? (
              <Button
                disabled={!podeAdicionar}
                className="w-full gap-2 sm:w-auto"
                title={
                  !podeRegistrarPagamentoOs(statusAtual)
                    ? "Disponível somente após a aprovação e antes da conclusão da OS."
                    : undefined
                }
              >
                <Plus className="size-4" /> Registrar pagamento/adiantamento
              </Button>
            ) : undefined}
          </TransactionDialog>
        </div>

        {/* Informational Alerts */}
        {!podeRegistrarPagamentoOs(statusAtual) ? (
          <div className="flex items-center gap-2 border-b bg-blue-500/10 px-4 py-2.5 text-xs font-medium text-blue-800 dark:text-blue-300">
            <Info className="size-4 shrink-0" />
            <span>
              Novos lançamentos ficam disponíveis quando a OS está em <strong>Orçamento aprovado</strong>, <strong>Em andamento</strong> ou <strong>Pagamento</strong>.
            </span>
          </div>
        ) : resumo.saldoDisponivelParaLancamento <= 0 ? (
          <div className="flex items-center gap-2 border-b bg-emerald-500/10 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>
              A OS está quitada: todo o valor já foi recebido ou está coberto por títulos pendentes.
            </span>
          </div>
        ) : null}

        {/* Transactions Content */}
        {transacoes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="rounded-full bg-muted p-4 text-muted-foreground">
              <WalletCards className="size-8" />
            </div>
            <h4 className="mt-4 font-semibold">Nenhuma transação vinculada</h4>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Esta ordem de serviço ainda não possui pagamentos ou adiantamentos lançados.
            </p>
            {podeAdicionar ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-1.5"
                onClick={() => {
                  setSelectedTransactionId(undefined);
                  setDialogOpen(true);
                }}
              >
                <Plus className="size-4" /> Registrar primeiro pagamento
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Vencimento / Pagamento</TableHead>
                    <TableHead>Conta e Método</TableHead>
                    <TableHead className="text-right">Valor de Face</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transacoes.map((transacao) => (
                    <TableRow key={transacao.id} className="group transition-colors hover:bg-muted/40">
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            transacao.pendente
                              ? "gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          }
                        >
                          {transacao.pendente ? (
                            <Clock3 className="size-3 shrink-0" />
                          ) : (
                            <CheckCircle2 className="size-3 shrink-0" />
                          )}
                          {transacao.pendente ? "Pendente" : "Recebido"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {transacao.descricao || `Transação #${transacao.id}`}
                        </p>
                        {transacao.descricao_pagamento ? (
                          <p className="text-xs text-muted-foreground">{transacao.descricao_pagamento}</p>
                        ) : null}
                        <p className="text-[11px] text-muted-foreground/80">#{transacao.id}</p>
                        {transacao.pagamento_multiplo ? (
                          <SeloPagamentoMultiplo grupo={transacao.pagamento_multiplo} />
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {transacao.pendente
                            ? formatarData(transacao.vencimento_em ?? transacao.data)
                            : formatarData(transacao.pago_em ?? transacao.data)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {transacao.pendente ? "Vencimento" : "Pagamento"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {transacao.banco?.titulo || "Conta não informada"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {transacao.metodopagamento || "Método não informado"}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-semibold tabular-nums text-foreground">
                          {formatarEmReal(valorDeFace(transacao))}
                        </p>
                        {Number(transacao.valor_acrescimos ?? 0) > 0 || Number(transacao.valor_descontos ?? 0) > 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            Cobrado {formatarEmReal(transacao.valor)} · Líquido {formatarEmReal(valorLiquidoEfetivo(transacao))}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 opacity-80 group-hover:opacity-100"
                              aria-label={`Ações da transação ${transacao.id}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onSelect={() => {
                                setSelectedTransactionId(transacao.id);
                                setDialogOpen(true);
                              }}
                            >
                              {podeEditar ? <Pencil className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
                              {podeEditar ? "Editar" : "Visualizar"}
                            </DropdownMenuItem>
                            {transacao.pendente && podeEditar ? (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setTransacaoParaBaixa(transacao);
                                  setBaixaOpen(true);
                                }}
                              >
                                <CheckCircle2 className="mr-2 size-4 text-emerald-600 dark:text-emerald-400" />
                                Dar baixa
                              </DropdownMenuItem>
                            ) : null}
                            {podeExcluir ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                  onSelect={() => setTransacaoParaExcluir(transacao)}
                                >
                                  <Trash2 className="mr-2 size-4" /> Excluir
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card List View */}
            <div className="divide-y border-t sm:hidden">
              {transacoes.map((transacao) => (
                <div key={transacao.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            transacao.pendente
                              ? "gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          }
                        >
                          {transacao.pendente ? (
                            <Clock3 className="size-3 shrink-0" />
                          ) : (
                            <CheckCircle2 className="size-3 shrink-0" />
                          )}
                          {transacao.pendente ? "Pendente" : "Recebido"}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono">#{transacao.id}</span>
                      </div>
                      <h4 className="font-semibold text-sm leading-snug text-foreground">
                        {transacao.descricao || `Transação #${transacao.id}`}
                      </h4>
                      {transacao.descricao_pagamento ? (
                        <p className="text-xs text-muted-foreground">{transacao.descricao_pagamento}</p>
                      ) : null}
                      {transacao.pagamento_multiplo ? (
                        <SeloPagamentoMultiplo grupo={transacao.pagamento_multiplo} />
                      ) : null}
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 shrink-0"
                          aria-label={`Ações da transação ${transacao.id}`}
                        >
                          <MoreHorizontal className="size-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onSelect={() => {
                            setSelectedTransactionId(transacao.id);
                            setDialogOpen(true);
                          }}
                        >
                          {podeEditar ? <Pencil className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
                          {podeEditar ? "Editar" : "Visualizar"}
                        </DropdownMenuItem>
                        {transacao.pendente && podeEditar ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setTransacaoParaBaixa(transacao);
                              setBaixaOpen(true);
                            }}
                          >
                            <CheckCircle2 className="mr-2 size-4 text-emerald-600 dark:text-emerald-400" />
                            Dar baixa
                          </DropdownMenuItem>
                        ) : null}
                        {podeExcluir ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                              onSelect={() => setTransacaoParaExcluir(transacao)}
                            >
                              <Trash2 className="mr-2 size-4" /> Excluir
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-muted/30 p-2.5 rounded-lg">
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                        {transacao.pendente ? "Vencimento" : "Pagamento"}
                      </span>
                      <span className="font-medium">
                        {transacao.pendente
                          ? formatarData(transacao.vencimento_em ?? transacao.data)
                          : formatarData(transacao.pago_em ?? transacao.data)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                        Conta / Método
                      </span>
                      <span className="font-medium truncate block">
                        {transacao.banco?.titulo || "Conta N/I"} · {transacao.metodopagamento || "Método N/I"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border/50">
                    <div>
                      <span className="text-xs text-muted-foreground">Valor de face</span>
                      <p className="text-base font-bold tabular-nums text-foreground">
                        {formatarEmReal(valorDeFace(transacao))}
                      </p>
                      {Number(transacao.valor_acrescimos ?? 0) > 0 || Number(transacao.valor_descontos ?? 0) > 0 ? (
                        <p className="text-[10px] text-muted-foreground">
                          Líquido: {formatarEmReal(valorLiquidoEfetivo(transacao))}
                        </p>
                      ) : null}
                    </div>

                    {transacao.pendente && podeEditar ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                        onClick={() => {
                          setTransacaoParaBaixa(transacao);
                          setBaixaOpen(true);
                        }}
                      >
                        <CheckCircle2 className="size-3.5" /> Dar baixa
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Modals & Dialogs */}
      <ConcluidoAlert
        isAlertOpen={baixaOpen}
        setIsAlertOpen={setBaixaOpen}
        transaction={transacaoParaBaixa}
        onSuccess={() => void recarregarTudo()}
      />

      <AlertDialog
        open={Boolean(transacaoParaExcluir)}
        onOpenChange={(open) => {
          if (!open && !excluindo) setTransacaoParaExcluir(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir transação?</AlertDialogTitle>
            <AlertDialogDescription>
              A transação #{transacaoParaExcluir?.id} será excluída diretamente. Os saldos serão recalculados e, se a OS estiver concluída, ela poderá voltar para Pagamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={excluindo}
              onClick={(event) => {
                event.preventDefault();
                void excluirTransacao();
              }}
            >
              {excluindo ? <Loader2 className="mr-2 size-4 animate-spin" /> : null} Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
