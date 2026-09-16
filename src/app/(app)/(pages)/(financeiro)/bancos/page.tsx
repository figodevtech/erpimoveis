"use client";

import * as React from "react";
import axios from "axios";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Landmark,
  Loader2,
  Wallet,
} from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";
import { formatDate } from "@/utils/formatDate";
import { cn } from "@/lib/utils";
import { SheetFinanceiroFiltros } from "../../dashboard/components/dashboard-financeiro/components/sheet-financeiro-filtros";
import {
  formatarDataCompleta,
  formatarDataYYYYMMDD,
} from "../../dashboard/components/dashboard-financeiro/lib/datas";

type BancoTransacao = {
  id: number;
  descricao: string;
  nomepagador: string | null;
  tipo: string;
  categoria: string | null;
  metodopagamento: string | null;
  valor: number;
  valorAssinado: number;
  /** Saldo da conta logo depois desta transação; null se ela chegou entre as leituras. */
  saldoApos: number | null;
  data: string;
};

type BancoResumo = {
  id: number;
  titulo: string;
  valorinicial: number;
  agencia: string | null;
  contanumero: string | null;
  tipo: string;
  proprietario: string | null;
  ativo: boolean;
  entradas: number;
  saidas: number;
  pendenteEntrada: number;
  pendenteSaida: number;
  saldoAtual: number;
  totalTransacoes: number;
  ultimaMovimentacao: string | null;
};

type TotaisResumo = {
  valorinicial: number;
  entradas: number;
  saidas: number;
  pendenteEntrada: number;
  pendenteSaida: number;
  saldoAtual: number;
};

const totaisVazios: TotaisResumo = {
  valorinicial: 0,
  entradas: 0,
  saidas: 0,
  pendenteEntrada: 0,
  pendenteSaida: 0,
  saldoAtual: 0,
};

type TransacoesPaginadas = {
  bancoId: number | null;
  items: BancoTransacao[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const transacoesVazias: TransacoesPaginadas = {
  bancoId: null,
  items: [],
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 1,
};

function ResumoCard({
  titulo,
  valor,
  Icone,
  detalhe,
}: {
  titulo: string;
  valor: number;
  Icone: React.ComponentType<{ className?: string }>;
  detalhe?: string;
}) {
  return (
    <Card className="gap-1">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{titulo}</CardTitle>
        <Icone className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold tracking-normal">{formatarEmReal(valor)}</div>
        {detalhe ? <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function BancosFinanceiroPage() {
  const [items, setItems] = React.useState<BancoResumo[]>([]);
  const [totals, setTotals] = React.useState<TotaisResumo>(totaisVazios);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingTransacoes, setIsLoadingTransacoes] = React.useState(false);
  const [transacoesPageData, setTransacoesPageData] = React.useState<TransacoesPaginadas>(transacoesVazias);
  const [selectedBancoId, setSelectedBancoId] = React.useState<number | null>(null);
  const [filtroAberto, setFiltroAberto] = React.useState(false);
  const [dataInicio, setDataInicio] = React.useState<Date | null>(null);
  const [dataFim, setDataFim] = React.useState<Date | null>(null);
  const [transacaoPage, setTransacaoPage] = React.useState(1);
  const [transacaoLimit, setTransacaoLimit] = React.useState(10);

  const carregarResumo = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await axios.get<{ items: BancoResumo[]; totals: TotaisResumo }>("/api/bancos/resumo", {
        params: {
          dateFrom: dataInicio ? formatarDataYYYYMMDD(dataInicio) : undefined,
          dateTo: dataFim ? formatarDataYYYYMMDD(dataFim) : undefined,
        },
      });
      const bancos = response.data.items ?? [];
      setItems(bancos);
      setTotals(response.data.totals ?? totaisVazios);
      setSelectedBancoId((current) => {
        if (current && bancos.some((banco) => banco.id === current)) return current;
        return bancos[0]?.id ?? null;
      });
    } catch (error: any) {
      toast.error("Erro ao carregar bancos", {
        description: error?.response?.data?.error ?? error?.message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [dataFim, dataInicio]);

  const carregarTransacoes = React.useCallback(async () => {
    if (!selectedBancoId) {
      setTransacoesPageData(transacoesVazias);
      return;
    }

    setIsLoadingTransacoes(true);
    try {
      const response = await axios.get<{ transacoes: TransacoesPaginadas }>("/api/bancos/resumo", {
        params: {
          onlyTransactions: true,
          bancoId: selectedBancoId,
          page: transacaoPage,
          limit: transacaoLimit,
          dateFrom: dataInicio ? formatarDataYYYYMMDD(dataInicio) : undefined,
          dateTo: dataFim ? formatarDataYYYYMMDD(dataFim) : undefined,
        },
      });

      setTransacoesPageData(response.data.transacoes ?? transacoesVazias);
    } catch (error: any) {
      setTransacoesPageData(transacoesVazias);
      toast.error("Erro ao carregar transações", {
        description: error?.response?.data?.error ?? error?.message,
      });
    } finally {
      setIsLoadingTransacoes(false);
    }
  }, [dataFim, dataInicio, selectedBancoId, transacaoLimit, transacaoPage]);

  React.useEffect(() => {
    void carregarResumo();
  }, [carregarResumo]);

  React.useEffect(() => {
    void carregarTransacoes();
  }, [carregarTransacoes]);

  function recarregarDados() {
    void Promise.all([carregarResumo(), carregarTransacoes()]);
  }

  function tratarDataInicio(date?: Date) {
    setTransacaoPage(1);
    if (!date) return setDataInicio(null);
    if (dataFim && date > dataFim) setDataFim(date);
    setDataInicio(date);
  }

  function tratarDataFim(date?: Date) {
    setTransacaoPage(1);
    if (!date) return setDataFim(null);
    if (dataInicio && date < dataInicio) setDataInicio(date);
    setDataFim(date);
  }

  function limparFiltros() {
    setTransacaoPage(1);
    setDataInicio(null);
    setDataFim(null);
  }

  const selectedBanco = React.useMemo(
    () => items.find((item) => item.id === selectedBancoId) ?? items[0] ?? null,
    [items, selectedBancoId]
  );

  const textoPeriodo =
    dataInicio && dataFim
      ? `${formatarDataCompleta(dataInicio)} até ${formatarDataCompleta(dataFim)}`
      : dataInicio
        ? `A partir de ${formatarDataCompleta(dataInicio)}`
        : dataFim
          ? `Até ${formatarDataCompleta(dataFim)}`
          : "Todo o período";

  const transacoesSelecionadas = transacoesPageData.items;
  const transacaoTotal = transacoesPageData.total;
  const transacaoTotalPages = transacoesPageData.totalPages;
  const transacaoCurrentPage = Math.min(transacaoPage, transacaoTotalPages);
  const transacaoStart = transacaoTotal === 0 ? 0 : (transacaoCurrentPage - 1) * transacaoLimit;
  const transacoesPaginadas = transacoesSelecionadas;
  const isPrimeiroCarregamentoTransacoes =
    isLoadingTransacoes && transacoesPageData.bancoId == null && transacoesSelecionadas.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ResumoCard titulo="Saldo em bancos" valor={totals.saldoAtual} Icone={Wallet} detalhe="Saldo inicial + movimentos" />
        <ResumoCard titulo="Entradas concluídas" valor={totals.entradas} Icone={ArrowUp} detalhe="Receitas e depósitos" />
        <ResumoCard titulo="Saídas concluídas" valor={totals.saidas} Icone={ArrowDown} detalhe="Despesas e saques" />
        <ResumoCard
          titulo="Pendências"
          valor={totals.pendenteEntrada - totals.pendenteSaida}
          Icone={Landmark}
          detalhe={`${formatarEmReal(totals.pendenteEntrada)} a receber / ${formatarEmReal(totals.pendenteSaida)} a pagar`}
        />
      </div>

      <Card>
        <CardHeader className="min-w-0 border-b-2 pb-4">
          <CardTitle>Contas bancárias</CardTitle>
          <CardDescription>Valores por banco, considerando movimentações vinculadas a cada conta.</CardDescription>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Banco</TableHead>
                <TableHead className="hidden lg:table-cell">Conta</TableHead>
                <TableHead className="hidden md:table-cell text-right">Entradas</TableHead>
                <TableHead className="hidden md:table-cell text-right">Saídas</TableHead>
                <TableHead className="hidden lg:table-cell">Última movimentação</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={6}>
                      <div className="h-10 animate-pulse rounded-md bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Nenhum banco cadastrado.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((banco) => {
                  const selecionado = selectedBanco?.id === banco.id;

                  return (
                  <TableRow
                    key={banco.id}
                    onClick={() => {
                      setTransacaoPage(1);
                      setSelectedBancoId(banco.id);
                    }}
                    className={cn("cursor-pointer", selecionado && "bg-muted/70")}
                    data-state={selecionado ? "selected" : undefined}
                  >
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Landmark className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{banco.titulo}</span>
                            {!banco.ativo ? <Badge variant="outline">Inativo</Badge> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {banco.tipo}
                            {banco.proprietario ? ` - ${banco.proprietario}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground md:hidden">
                            Entradas {formatarEmReal(banco.entradas)} / Saídas {formatarEmReal(banco.saidas)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {[banco.agencia, banco.contanumero].filter(Boolean).join(" / ") || "-"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right text-emerald-600">
                      {formatarEmReal(banco.entradas)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right text-red-600">
                      {formatarEmReal(banco.saidas)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {banco.ultimaMovimentacao ? formatDate(new Date(banco.ultimaMovimentacao)) : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-semibold">{formatarEmReal(banco.saldoAtual)}</div>
                      <div className="text-xs text-muted-foreground">{banco.totalTransacoes} mov.</div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="min-w-0 border-b-2 pb-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle>Transações de {selectedBanco?.titulo ?? "conta"}</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={recarregarDados}
                  className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70"
                >
                  <span>Recarregar</span>
                  <Loader2
                    width={12}
                    className={cn(isLoading || isLoadingTransacoes ? "animate-spin" : "")}
                  />
                </button>
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default" className="text-[10px] sm:text-xs">
                Período: {textoPeriodo}
              </Badge>
              <SheetFinanceiroFiltros
                aberto={filtroAberto}
                aoMudarAberto={setFiltroAberto}
                dataInicio={dataInicio}
                dataFim={dataFim}
                aoMudarDataInicio={tratarDataInicio}
                aoMudarDataFim={tratarDataFim}
                aoLimpar={limparFiltros}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead className="hidden md:table-cell">Data</TableHead>
                <TableHead className="hidden md:table-cell">Tipo</TableHead>
                <TableHead className="hidden lg:table-cell">Categoria</TableHead>
                <TableHead className="hidden lg:table-cell">Método</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPrimeiroCarregamentoTransacoes ? (
                Array.from({ length: Math.min(transacaoLimit, 5) }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7}>
                      <div className="h-10 animate-pulse rounded-md bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              ) : transacoesSelecionadas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {selectedBanco ? "Nenhuma movimentação encontrada para esta conta." : "Selecione uma conta com movimentações."}
                  </TableCell>
                </TableRow>
              ) : (
                transacoesPaginadas.map((transacao) => {
                  const entrada = transacao.valorAssinado >= 0;
                  const pagador = transacao.nomepagador?.trim();
                  const tituloLinha = pagador || transacao.descricao;
                  const detalheLinha = pagador ? transacao.descricao : transacao.categoria;
                  const saldoApos = transacao.saldoApos == null ? "-" : formatarEmReal(transacao.saldoApos);
                  const saldoNegativo = (transacao.saldoApos ?? 0) < 0;

                  return (
                    <TableRow key={transacao.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{tituloLinha}</span>
                          {detalheLinha ? (
                            <span className="text-xs text-muted-foreground">{detalheLinha}</span>
                          ) : null}
                          <span className="text-xs text-muted-foreground md:hidden">
                            {formatDate(new Date(transacao.data))} - {transacao.tipo}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{formatDate(new Date(transacao.data))}</TableCell>
                      <TableCell className="hidden md:table-cell">{transacao.tipo}</TableCell>
                      <TableCell className="hidden lg:table-cell">{transacao.categoria ?? "-"}</TableCell>
                      <TableCell className="hidden lg:table-cell">{transacao.metodopagamento ?? "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className={cn("font-medium", entrada ? "text-emerald-600" : "text-red-600")}>
                          {entrada ? "+ " : "- "}
                          {formatarEmReal(Math.abs(transacao.valorAssinado))}
                        </div>
                        <div className={cn("text-xs text-muted-foreground sm:hidden", saldoNegativo && "text-red-600")}>
                          Saldo {saldoApos}
                        </div>
                      </TableCell>
                      <TableCell className={cn("hidden sm:table-cell text-right tabular-nums", saldoNegativo && "text-red-600")}>
                        {saldoApos}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {transacaoTotal > 0 ? (
            <div className="mt-4 grid min-h-9 grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <div className="flex flex-nowrap justify-self-center text-xs text-muted-foreground sm:justify-self-start">
                <span>{transacaoStart + 1}</span> -{" "}
                <span>{Math.min(transacaoStart + transacoesPaginadas.length, transacaoTotal)}</span>
                <span className="ml-1 hidden sm:block">de {transacaoTotal}</span>
              </div>

              <div className="flex items-center justify-center space-x-1 sm:col-start-2 sm:row-start-1 sm:space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Primeira página"
                    onClick={() => setTransacaoPage(1)}
                    disabled={isLoadingTransacoes || transacaoCurrentPage === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setTransacaoPage((page) => Math.max(1, page - 1))}
                    disabled={isLoadingTransacoes || transacaoCurrentPage === 1}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                  <span className="min-w-20 text-center text-xs text-muted-foreground">
                    Pg. {transacaoCurrentPage} de {transacaoTotalPages || 1}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setTransacaoPage((page) => Math.min(transacaoTotalPages || 1, page + 1))}
                    disabled={isLoadingTransacoes || transacaoCurrentPage === transacaoTotalPages || transacaoTotalPages === 0}
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Última página"
                    onClick={() => setTransacaoPage(transacaoTotalPages || 1)}
                    disabled={isLoadingTransacoes || transacaoCurrentPage === transacaoTotalPages || transacaoTotalPages === 0}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
              </div>

              <Select
                value={String(transacaoLimit)}
                onValueChange={(value) => {
                  setTransacaoPage(1);
                  setTransacaoLimit(Number(value));
                }}
              >
                <SelectTrigger
                  className="w-auto justify-self-center hover:cursor-pointer sm:col-start-3 sm:row-start-1 sm:justify-self-end"
                  aria-label="Itens por página"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
