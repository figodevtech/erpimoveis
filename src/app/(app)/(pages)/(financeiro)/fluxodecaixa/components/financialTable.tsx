"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader,
  Loader2,
  MoreHorizontal,
  Eye,
  Plus,
  Pencil,
  Trash2Icon,
  Undo2,
} from "lucide-react";
import formatarEmReal from "@/utils/formatarEmReal";
import TransactionDialog from "./transactionDialog/transactionDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { BaixaMultiplaFooter } from "./baixa-multipla-footer";
import { BaixaMultiplaDialog } from "./baixa-multipla-dialog";
import { AdiantamentoDialog } from "./adiantamento-dialog";
import { TransactionDeleteAlert } from "../../components/transaction-delete-alert";
import {
  TransactionEstornoAlert,
  estornarBaixa,
} from "../../components/transaction-estorno-alert";
import { excluirPagamentoMultiplo } from "../../components/pagamento-multiplo";
import { toast } from "@/lib/toast";
import axios, { isAxiosError } from "axios";
import {
  type CampoOrdenacao,
  type FluxoViewMode,
  VIEW_MODE_TABS,
  type Ordenacao,
  Pagination,
  Tipo_transacao,
  Transaction,
  type TransactionRelationFilters,
} from "../types";
import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import { getCategoryIcon, getTypeColor } from "../utils";
import { ExportTransactionsButton } from "./ExportTransactionsButton";
import ConcluidoAlert from "./concluidoAlert";
import SearchFilter from "./searchFilter";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { useConfig } from "@/app/(app)/(pages)/config-context";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Texto de uma linha só, cortado com reticências. O tooltip com o conteúdo
 * completo só aparece quando o texto realmente foi cortado — medido no hover,
 * porque a largura disponível muda conforme a janela.
 */
function TextoTruncado({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [truncado, setTruncado] = React.useState(false);

  const verificarCorte = () => {
    const el = ref.current;
    if (el) setTruncado(el.scrollWidth > el.clientWidth);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          ref={ref}
          onMouseEnter={verificarCorte}
          onFocus={verificarCorte}
          className={`block w-full cursor-default truncate text-left ${className ?? ""}`}
        >
          {children}
        </span>
      </TooltipTrigger>
      {truncado ? (
        <TooltipContent side="top" align="start" className="max-w-[320px] text-pretty">
          {children}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

/** Data curta no fuso da oficina — o mesmo critério usado na coluna de caixa. */
function formatarData(valor: string | Date) {
  return Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    dateStyle: "short",
  }).format(new Date(valor));
}

/**
 * Cabeçalho que ordena a listagem pela sua coluna. A ordenação é do servidor —
 * reordenar só a página visível mentiria sobre o resto do resultado.
 */
function CabecalhoOrdenavel({
  campo,
  rotulo,
  ordenacao,
  onOrdenar,
  className,
  alinharADireita = false,
}: {
  campo: CampoOrdenacao;
  rotulo: string;
  ordenacao: Ordenacao;
  onOrdenar: (campo: CampoOrdenacao) => void;
  className?: string;
  alinharADireita?: boolean;
}) {
  const ativo = ordenacao.campo === campo;
  const Icone = !ativo
    ? ChevronsUpDown
    : ordenacao.direcao === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <TableCell
      className={className}
      role="columnheader"
      aria-sort={
        ativo
          ? ordenacao.direcao === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        onClick={() => onOrdenar(campo)}
        title={`Ordenar por ${rotulo.toLowerCase()}`}
        className={`group inline-flex items-center gap-1 font-bold hover:cursor-pointer hover:text-primary ${alinharADireita ? "flex-row-reverse" : ""
          }`}
      >
        {rotulo}
        {/* Seta apagada nas colunas inativas: mostra que dá para clicar sem
            competir com a coluna que está ordenando de fato. */}
        <Icone
          className={`h-3 w-3 shrink-0 ${ativo ? "" : "opacity-30 group-hover:opacity-70"}`}
        />
      </button>
    </TableCell>
  );
}

const LIMIT_OPTIONS = [50, 100, 200];

interface FinancialTableProps {
  dateTo: string;
  dateFrom: string;
  transactions: Transaction[];
  pagination: Pagination;
  /**
   * Recarrega a lista. Só a página e o tamanho vêm daqui — busca, período,
   * tipo, pendente e a exigência de conta bancária são estado da página, e
   * repassá-los era como esta tela perdia o filtro do Fluxo ao recarregar.
   */
  handleGetTransactions: (pageNumber?: number, limit?: number) => void;
  /** Troca o tamanho da página; quem refaz a busca é a página. */
  setLimit: (limit: number) => void;
  ordenacao: Ordenacao;
  onOrdenar: (campo: CampoOrdenacao) => void;
  search: string;
  dateSearch: string;
  tipo: Tipo_transacao | "";
  /** Lista separada por vírgula quando a aba agrupa dois tipos. */
  tiposParam: string;
  rawTipo: Tipo_transacao | "";
  pendenteFilter?: boolean | "";
  viewMode?: FluxoViewMode;
  isLoading: boolean;
  setSearch: (value: string) => void;
  setTipo: (value: Tipo_transacao | "") => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setViewMode: (value: FluxoViewMode) => void;
  relationFilters: TransactionRelationFilters;
  setRelationFilters: (value: TransactionRelationFilters) => void;
  handleGetStatusCounter: () => void;
}

export default function FinancialTable({
  transactions,
  pagination,
  handleGetTransactions,
  setLimit,
  ordenacao,
  onOrdenar,
  search,
  dateSearch,
  tipo,
  tiposParam,
  rawTipo,
  pendenteFilter = "",
  viewMode = "FLUXO",
  isLoading,
  setSearch,
  setTipo,
  setDateFrom,
  setDateTo,
  setViewMode,
  relationFilters,
  setRelationFilters,
  handleGetStatusCounter,
  dateTo,
  dateFrom,
}: FinancialTableProps) {
  const { data: session } = useSession();
  const config = useConfig();
  const [selectedTransactionId, setSelectedTransactionId] = useState<
    number | undefined
  >(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTransactionForPago, setSelectedTransactionForPago] =
    useState<Transaction | null>(null);

  /**
   * Baixa múltipla.
   *
   * Só faz sentido quando a lista está mostrando exclusivamente pendentes: dar
   * baixa é operação sobre o que ainda não foi pago, e uma lista mista levaria o
   * usuário a marcar linhas que a operação vai recusar. As abas "A pagar" e
   * "A receber" já garantem isso; o filtro de situação também.
   */
  const [modoBaixaMultipla, setModoBaixaMultipla] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [baixaEmLoteAberta, setBaixaEmLoteAberta] = useState(false);
  const [baixandoEmLote, setBaixandoEmLote] = useState(false);
  const [adiantamentoAberto, setAdiantamentoAberto] = useState(false);

  const podeBaixaMultipla =
    viewMode === "A_PAGAR" || viewMode === "A_RECEBER" || pendenteFilter === true;

  // Trocar de aba ou de filtro pode trazer linhas liquidadas para a tela; sair
  // do modo evita seleção sobre um conjunto que mudou debaixo do usuário.
  useEffect(() => {
    if (!podeBaixaMultipla && modoBaixaMultipla) {
      setModoBaixaMultipla(false);
      setSelecionadas(new Set());
    }
  }, [podeBaixaMultipla, modoBaixaMultipla]);

  const alternarSelecao = useCallback((id: number) => {
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }, []);

  const sairDaBaixaMultipla = useCallback(() => {
    setModoBaixaMultipla(false);
    setSelecionadas(new Set());
  }, []);

  const transacoesSelecionadas = useMemo(
    () => transactions.filter((t) => selecionadas.has(t.id)),
    [transactions, selecionadas],
  );
  const [isPagoDialogOpen, setIsPagoDialogOpen] = useState(false);
  const [, setIsDeleting] = useState(false);
  const canCreate = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_CRIAR,
  );
  const canEdit = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_EDITAR,
  );
  const canDelete = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_EXCLUIR,
  );

  useEffect(() => {
    if (selectedTransactionId) setIsOpen(true);
  }, [selectedTransactionId]);

  const handleDeleteGrupo = async (grupoId: number) => {
    if (!canDelete) return;
    setIsDeleting(true);
    try {
      await excluirPagamentoMultiplo(grupoId);
      handleGetTransactions(pagination.page);
      toast.success("Pagamento múltiplo desfeito.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível excluir o pagamento.");
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * Tira a transação do fluxo de caixa: desfaz a baixa e devolve o título para
   * em aberto. É o passo obrigatório antes de excluir um título liquidado —
   * excluir direto apagaria a dívida junto com o pagamento.
   */
  const handleEstornarBaixa = async (id: number) => {
    if (!canEdit) return;
    setIsDeleting(true);
    try {
      const { acrescimos_removidos } = await estornarBaixa(id);
      const removidos = Number(acrescimos_removidos ?? 0);
      handleGetTransactions(pagination.page, pagination.limit);
      handleGetStatusCounter();
      toast.success(
        removidos > 0
          ? `Título reaberto. Os ${formatarEmReal(removidos)} de acréscimo saíram junto com a baixa.`
          : "Título reaberto: voltou a ficar em aberto.",
      );
    } catch (erro) {
      toast.error(
        erro instanceof Error ? erro.message : "Não foi possível tirar do fluxo de caixa.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteTransaction = async (id: number) => {
    if (!canDelete) return;
    setIsDeleting(true);
    toast(
      <div className="flex gap-2 items-center flex-nowrap">
        <Loader className="animate-spin w-4" />
        <span className="text-nowrap">Deletando transação...</span>
      </div>,
    );
    try {
      const response = await axios.delete(`/api/transaction/${id}`, {});
      if (response.status === 204) {
        toast("Transação deletada!");
        handleGetTransactions(pagination.page, pagination.limit);
        handleGetStatusCounter();
      } else {
        toast.warning(`Status inesperado: ${response.status}`);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Error", {
          description: error.response?.data.error,
        });
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // ID estável para o Select de "itens por página"
  const limitUid = React.useId();
  const limitListboxId = `${limitUid}-limit-listbox`;

  const title =
    viewMode === "A_RECEBER"
      ? "Contas a Receber"
      : viewMode === "A_PAGAR"
        ? "Contas a Pagar"
        : viewMode === "LIQUIDADAS"
          ? "Transações Liquidadas"
          : "Lista de Transações";

  return (
    <Card className="bg-card">
      <CardHeader className="border-b-2 pb-4">
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 shrink-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  handleGetTransactions(pagination.page, pagination.limit);
                  handleGetStatusCounter();
                }}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2
                  width={12}
                  className={isLoading ? "animate-spin" : ""}
                />
              </button>
            </CardDescription>
          </div>

          {/* Fica no fluxo: centralizar com position:absolute fazia as abas
              passarem por cima dos botões da direita quando a largura apertava. */}
          <div className="flex min-w-0 flex-1 items-center justify-start md:justify-center">
            <div
              role="tablist"
              aria-label="Visualização do fluxo de caixa"
              className="inline-flex h-auto max-w-full items-center gap-1.5 overflow-x-auto rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {VIEW_MODE_TABS.map((tab) => {
                const ativo = viewMode === tab.value;

                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={ativo}
                    onClick={() => setViewMode(tab.value)}
                    className={`inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-transparent px-3 text-xs font-medium transition-all hover:cursor-pointer ${ativo
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                      }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-2 md:w-auto md:items-end">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <SearchFilter
                renderOnlyTrigger
                tipo={rawTipo}
                viewMode={viewMode}
                setViewMode={setViewMode}
                relationFilters={relationFilters}
                setRelationFilters={setRelationFilters}
                setSearch={setSearch}
                search={dateSearch}
                setTipo={setTipo}
                dateFrom={dateFrom}
                dateTo={dateTo}
                setDateFrom={setDateFrom}
                setDateTo={setDateTo}
                lockedTipoLabel={
                  viewMode === "A_RECEBER"
                    ? "Somente receitas pendentes"
                    : viewMode === "A_PAGAR"
                      ? "Somente despesas pendentes"
                      : undefined
                }
              />
              {/*
                Exportar, nova transação e baixa múltipla vivem sob um menu só.
                São ações sobre a lista, não filtros — separá-las do bloco de
                filtros deixa claro o que altera a consulta e o que age sobre ela.
              */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 w-full whitespace-nowrap hover:cursor-pointer sm:w-auto"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    Ações
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem
                    onSelect={(evento) => {
                      // O menu fecha sozinho no clique e levaria o gatilho de
                      // exportação junto; o próprio componente cuida do resto.
                      evento.preventDefault();
                    }}
                    asChild
                  >
                    <ExportTransactionsButton
                      search={search}
                      tipo={tipo}
                      tipos={tiposParam}
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      categoriaId={relationFilters.categoriaId ? Number(relationFilters.categoriaId) : null}
                      bancoId={relationFilters.bancoId ? Number(relationFilters.bancoId) : null}
                      planoContaId={relationFilters.planoContaId ? Number(relationFilters.planoContaId) : null}
                      centroCustoId={relationFilters.centroCustoId ? Number(relationFilters.centroCustoId) : null}
                      metodopagamento={relationFilters.metodoPagamento || null}
                      variant="ghost"
                      className="h-8 w-full justify-start px-2 font-normal hover:cursor-pointer"
                    />
                  </DropdownMenuItem>

                  {canCreate ? (
                    <DropdownMenuItem
                      className="hover:cursor-pointer"
                      onSelect={() => {
                        setSelectedTransactionId(undefined);
                        setIsOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      Nova transação
                    </DropdownMenuItem>
                  ) : null}

                  {canEdit ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="hover:cursor-pointer"
                        disabled={!podeBaixaMultipla}
                        onSelect={() => setModoBaixaMultipla(true)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Baixa múltipla
                      </DropdownMenuItem>
                      {!podeBaixaMultipla ? (
                        <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                          Disponível ao filtrar somente pendentes: use as abas
                          A pagar, A receber ou o filtro de situação.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>

              {canCreate ? (
                <TransactionDialog
                  open={isOpen}
                  setOpen={setIsOpen}
                  selectedTransactionId={selectedTransactionId}
                  setSelectedTransactionId={setSelectedTransactionId}
                  editable={canEdit && config?.habilitar_edicao_transacoes === true}
                  handleGetTransactions={() => {
                    handleGetTransactions(pagination.page, pagination.limit);
                    handleGetStatusCounter();
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        {/* barra superior de loading */}
        <div
          className={`${isLoading && "opacity-100"
            } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${isLoading && "animate-slideIn"
              }`}
          />
        </div>

        <Table className="text-xs mt-6">
          <TableHeader>
            <TableRow className="font-bold">
              <CabecalhoOrdenavel
                campo="descricao"
                rotulo="Descrição"
                ordenacao={ordenacao}
                onOrdenar={onOrdenar}
                className="w-[380px] max-w-[380px]"
              />
              {/*
                Competência é regime econômico — a que mês o fato pertence. No
                Fluxo isso não tem lugar: ali só interessa quando o dinheiro
                andou. Manter as duas datas lado a lado num extrato só convida a
                somar a coluna errada.
              */}
              {viewMode !== "FLUXO" ? (
                <CabecalhoOrdenavel
                  campo="competencia_em"
                  rotulo="Competência"
                  ordenacao={ordenacao}
                  onOrdenar={onOrdenar}
                  className="hidden md:table-cell"
                />
              ) : null}
              {/*
                A coluna é sempre `data`, mas o que ela significa muda com a
                situação: num título em aberto é quando vence; num liquidado, a
                baixa sobrescreve `data` com o dia do pagamento. Manter o rótulo
                "Vencimento" na aba Liquidadas mostraria uma data que não é
                vencimento nenhum.
              */}
              <CabecalhoOrdenavel
                campo="data"
                rotulo={
                  viewMode === "FLUXO"
                    ? "Movimentado em"
                    : viewMode === "LIQUIDADAS"
                      ? "Liquidado em"
                      : "Vencimento"
                }
                ordenacao={ordenacao}
                onOrdenar={onOrdenar}
                className="hidden md:table-cell"
              />
              <CabecalhoOrdenavel
                campo="tipo"
                rotulo="Tipo"
                ordenacao={ordenacao}
                onOrdenar={onOrdenar}
                className="hidden md:table-cell"
              />
              <CabecalhoOrdenavel
                campo="categoria"
                rotulo="Categoria"
                ordenacao={ordenacao}
                onOrdenar={onOrdenar}
                className="hidden md:table-cell"
              />
              {/* Banco fica de fora: o título vem de join e o Postgrest não
                  ordena a tabela de cima por coluna embutida — sobraria
                  ordenar por banco_id, que não é a ordem que se lê. */}
              <TableCell className="hidden md:table-cell">Banco</TableCell>
              <CabecalhoOrdenavel
                campo="metodopagamento"
                rotulo="Método"
                ordenacao={ordenacao}
                onOrdenar={onOrdenar}
                className="hidden md:table-cell"
              />
              <CabecalhoOrdenavel
                campo="valor"
                rotulo="Valor"
                ordenacao={ordenacao}
                onOrdenar={onOrdenar}
                className="text-right"
                alinharADireita
              />
              <TableCell className="text-right">Ações</TableCell>
            </TableRow>
          </TableHeader>

          <TableBody>
            {transactions.map((t) => {
              // IDs estáveis para o menu da linha
              const triggerId = `row-${t.id}-menu-btn`;
              const menuId = `row-${t.id}-menu`;

              return (
                <TableRow
                  key={t.id}
                  // Abrir não depende só da troca de id: reabrir a mesma linha
                  // que acabou de ser fechada não muda estado nenhum, e o efeito
                  // que reage ao id não dispararia.
                  onDoubleClick={() => {
                    setSelectedTransactionId(t.id);
                    setIsOpen(true);
                  }}
                  className="hover:cursor-pointer"
                >
                  <TableCell className="flex w-[380px] max-w-[380px] flex-row items-center gap-2">
                    {/*
                      Na baixa múltipla o ícone de categoria dá lugar à caixa de
                      seleção: ocupam o mesmo espaço, então a lista não se
                      reorganiza ao entrar no modo — nada pula sob o cursor.
                    */}
                    {modoBaixaMultipla ? (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                        <Checkbox
                          checked={selecionadas.has(t.id)}
                          onCheckedChange={() => alternarSelecao(t.id)}
                          aria-label={`Selecionar transação ${t.id} — ${t.descricao}`}
                          className="hover:cursor-pointer"
                        />
                      </div>
                    ) : (
                      <div className="shrink-0 rounded-full p-2 bg-primary/50">
                        {getCategoryIcon(t.categoria, t.categoria_dados?.icone)}
                      </div>
                    )}
                    {/* min-w-0: sem isso o item flex nunca encolhe abaixo do
                        conteúdo e o truncate não corta nada. */}
                    <div className="flex min-w-0 flex-1 flex-col items-start">
                      <TextoTruncado>{t.descricao}</TextoTruncado>
                      {t.descricao_pagamento && (
                        <TextoTruncado className="text-xs text-muted-foreground italic">
                          {t.descricao_pagamento}
                        </TextoTruncado>
                      )}
                      {t.nomepagador && (
                        <TextoTruncado className="text-xs text-muted-foreground">
                          {t.nomepagador}
                        </TextoTruncado>
                      )}
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        ID: {t.id}
                        {/*
                          Os dois lados da antecipação se identificam na lista, em
                          cores diferentes: o lançamento que trouxe o dinheiro
                          (azul) e os títulos que ele quitou (verde). Sem isso, os
                          títulos parecem pagamentos que sumiram do caixa — eles
                          aparecem como pagos e sem banco.
                        */}
                        {t.eh_adiantamento ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded-sm border border-sky-600/40 bg-sky-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">
                                Antecipação
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start">
                              Liquidou vários títulos de uma vez. Veja quais na aba
                              Adiantamento.
                            </TooltipContent>
                          </Tooltip>
                        ) : t.adiantamento_id != null ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded-sm border border-emerald-600/40 bg-emerald-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                                Antecipado
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start">
                              Liquidado pela antecipação #{t.adiantamento_id}. O dinheiro
                              entrou por ela, não por este título.
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </span>
                      <span className="w-full truncate text-xs text-muted-foreground md:hidden">
                        {t.banco?.titulo ?? "Sem banco"} - {t.metodopagamento ?? "Método não definido"}
                      </span>
                      <span className="text-muted-foreground text-nowrap flex-nowrap flex justify-center items-center gap-2 md:hidden">
                        <Calendar className="w-[10px] h-[10px]" />
                        {formatarData(t.data)}
                        {/* Mesmo critério da coluna: no Fluxo só a data do
                            movimento, sem a competência ao lado. */}
                        {viewMode !== "FLUXO" && t.competencia_em ? (
                          <span className="text-muted-foreground">
                            (comp. {formatarData(t.competencia_em)})
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </TableCell>

                  {/* Competência (regime econômico) — distinta da data de caixa
                      ao lado. Registro sem competência mostra travessão. */}
                  {viewMode !== "FLUXO" ? (
                    <TableCell className="hidden md:table-cell">
                      {t.competencia_em
                        ? formatarData(t.competencia_em)
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  ) : null}
                  <TableCell className="hidden md:table-cell">
                    {formatarData(t.data)}
                  </TableCell>
                  <TableCell
                    className={`hidden md:table-cell ${t.pendente && "text-primary font-semibold"}`}
                  >
                    {t.pendente && t.tipo === Tipo_transacao.DESPESA ? (
                      <span className=" flex flex-nowrap gap-1 items-center">
                        A PAGAR
                      </span>
                    ) : t.pendente && t.tipo === Tipo_transacao.RECEITA ? (
                      <span className=" flex flex-nowrap gap-1 items-center">
                        A RECEBER
                      </span>
                    ) : (
                      t.tipo
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.categoria}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.banco?.titulo ?? "Sem banco"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {t.metodopagamento ?? "Não definido"}
                  </TableCell>

                  {/*
                    Título antecipado sai da cor do tipo e vai para amarelo: o
                    valor está lá, mas não entrou no caixa por esta linha — quem
                    trouxe o dinheiro foi a antecipação. Somar esta coluna de
                    olho, nas abas que os listam, daria o dobro.

                    No Fluxo o amarelo não tem função: aquela aba só mostra o que
                    passou por conta, então tudo ali moveu caixa de verdade e a
                    cor volta a significar apenas entrada ou saída.
                  */}
                  <TableCell
                    className={`text-right ${
                      viewMode !== "FLUXO" && t.adiantamento_id != null
                        ? "text-amber-600 dark:text-amber-400"
                        : getTypeColor(t.tipo)
                    }`}
                  >
                    <div className="flex flex-col items-end">
                      {(t.tipo === "RECEITA" || t.tipo === "DEPOSITO") && "+ "}
                      {(t.tipo === "DESPESA" || t.tipo === "SAQUE") && "- "}
                      {/* Linha sem líquido (despesa, ou registro antigo) vale o
                          bruto — antes exibia R$ 0,00 com o bruto embaixo. */}
                      {formatarEmReal(valorLiquidoEfetivo(t))}
                      {Math.round(valorLiquidoEfetivo(t) * 100) !==
                        Math.round(Number(t.valor ?? 0) * 100) && (
                        <span className="text-xs text-muted-foreground">
                          Bruto: {formatarEmReal(t.valor)}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          id={triggerId}
                          aria-controls={menuId}
                          variant="ghost"
                          className="h-8 w-8 p-0 cursor-pointer"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent
                        id={menuId}
                        aria-labelledby={triggerId}
                        align="center"
                      >
                        {canEdit && config?.habilitar_edicao_transacoes ? (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedTransactionId(t.id);
                              setIsOpen(true);
                            }}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedTransactionId(t.id);
                              setIsOpen(true);
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Visualizar
                          </DropdownMenuItem>
                        )}

                        {canEdit && t.pendente && (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedTransactionForPago(t);
                              setIsPagoDialogOpen(true);
                            }}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Pago
                          </DropdownMenuItem>
                        )}

                        {/*
                          Fica ao lado de "Pago" e é o seu inverso: um dá baixa,
                          o outro a desfaz. A antecipação não aparece aqui —
                          liquidada ela é, mas quem a desfaz é a exclusão, que
                          devolve os títulos que ela pagou.
                        */}
                        {canEdit &&
                          !t.pendente &&
                          !t.eh_adiantamento &&
                          t.adiantamento_id == null &&
                          t.pagamento_multiplo_id == null && (
                          <TransactionEstornoAlert
                            transactionId={t.id}
                            sentido={t.tipo === Tipo_transacao.RECEITA ? "RECEBER" : "PAGAR"}
                            valorReaberto={Number(t.valor_base ?? t.valor ?? 0)}
                            acrescimos={Number(t.valor_acrescimos ?? 0)}
                            onEstornar={handleEstornarBaixa}
                          >
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <Undo2 className="mr-2 h-4 w-4" />
                              Excluir do fluxo de caixa
                            </DropdownMenuItem>
                          </TransactionEstornoAlert>
                        )}

                        {canDelete ? (
                          <TransactionDeleteAlert
                            transactionId={t.id}
                            onDelete={handleDeleteTransaction}
                            onDeleteGrupo={handleDeleteGrupo}
                            onEstornar={canEdit ? handleEstornarBaixa : undefined}
                          >
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              variant="destructive"
                            >
                              <Trash2Icon className="mr-2 h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </TransactionDeleteAlert>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
            <span>{pagination.limit * (pagination.page - 1) + 1}</span>
            {" - "}
            <span>
              {pagination.limit * (pagination.page - 1) + transactions.length}
            </span>
          </div>

          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() =>
                handleGetTransactions(1, pagination.limit)
              }
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
              onClick={() =>
                handleGetTransactions(pagination.page - 1, pagination.limit)
              }
              disabled={pagination.page === 1}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>

            <span className="text-xs font-medium text-nowrap">
              Pg. {pagination.page} de {pagination.totalPages || 1}
            </span>

            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() =>
                handleGetTransactions(pagination.page + 1, pagination.limit)
              }
              disabled={
                pagination.page === pagination.totalPages ||
                pagination.totalPages === 0
              }
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>

            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="icon"
              onClick={() =>
                handleGetTransactions(pagination.totalPages, pagination.limit)
              }
              disabled={
                pagination.page === pagination.totalPages ||
                pagination.totalPages === 0
              }
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Select de itens por página com IDs estáveis */}
          <div>
            <Select
              value={String(pagination.limit)}
              onValueChange={(value) => setLimit(Number(value))}
            >
              <SelectTrigger
                className="hover:cursor-pointer ml-2"
                aria-label="Itens por página"
                aria-controls={limitListboxId}
              >
                <SelectValue placeholder={`${pagination.limit} / pág.`} />
              </SelectTrigger>
              <SelectContent id={limitListboxId}>
                {LIMIT_OPTIONS.map((opcao) => (
                  <SelectItem
                    key={opcao}
                    className="hover:cursor-pointer"
                    value={String(opcao)}
                  >
                    {opcao} / pág.
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>

      {selectedTransactionForPago && (
        <ConcluidoAlert
          isAlertOpen={isPagoDialogOpen}
          setIsAlertOpen={setIsPagoDialogOpen}
          transaction={selectedTransactionForPago}
          onSuccess={() => {
            handleGetTransactions(pagination.page, pagination.limit);
            handleGetStatusCounter();
          }}
        />
      )}

      {modoBaixaMultipla ? (
        <>
          <BaixaMultiplaFooter
            selecionadas={selecionadas}
            transacoes={transactions}
            processando={baixandoEmLote}
            onCancelar={sairDaBaixaMultipla}
            onConfirmar={() => setBaixaEmLoteAberta(true)}
            onAdiantamento={() => setAdiantamentoAberto(true)}
          />
          <AdiantamentoDialog
            aberto={adiantamentoAberto}
            setAberto={setAdiantamentoAberto}
            transacoes={transacoesSelecionadas}
            processando={baixandoEmLote}
            setProcessando={setBaixandoEmLote}
            onConcluido={() => {
              // Adiantamento é tudo ou nada: se chegou aqui, todas foram
              // liquidadas e o modo não tem mais o que selecionar.
              sairDaBaixaMultipla();
              handleGetTransactions(pagination.page, pagination.limit);
              handleGetStatusCounter();
            }}
          />
          <BaixaMultiplaDialog
            aberto={baixaEmLoteAberta}
            setAberto={setBaixaEmLoteAberta}
            transacoes={transacoesSelecionadas}
            processando={baixandoEmLote}
            setProcessando={setBaixandoEmLote}
            onConcluido={(idsBaixados) => {
              // As que passaram saem da seleção; as que falharam ficam marcadas
              // para o usuário poder tentar de novo sem remarcar tudo.
              setSelecionadas((atual) => {
                const proximo = new Set(atual);
                idsBaixados.forEach((id) => proximo.delete(id));
                return proximo;
              });
              handleGetTransactions(pagination.page, pagination.limit);
              handleGetStatusCounter();
            }}
          />
        </>
      ) : null}
    </Card>
  );
}
