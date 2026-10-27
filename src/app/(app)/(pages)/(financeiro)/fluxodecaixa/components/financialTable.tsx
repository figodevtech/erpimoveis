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
  ArrowLeftRight,
  ArrowUp,
  Calendar,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  HandCoins,
  Landmark,
  Loader,
  Loader2,
  MoreHorizontal,
  Eye,
  Package,
  Plus,
  Pencil,
  ShoppingCart,
  User,
  Trash2Icon,
  Undo2,
} from "lucide-react";
import formatarEmReal from "@/utils/formatarEmReal";
import { formatDate } from "@/utils/formatDate";
import dynamic from "next/dynamic";
import { MountOnDemand } from "@/components/mount-on-demand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { SelecaoFooter } from "./selecao-footer";
import { ExclusaoMultiplaDialog } from "./exclusao-multipla-dialog";
import { BaixaMultiplaDialog } from "./baixa-multipla-dialog";
import { AdiantamentoDialog } from "./adiantamento-dialog";
import { TransactionDeleteAlert } from "../../components/transaction-delete-alert";
import {
  TransactionEstornoAlert,
  estornarBaixa,
} from "../../components/transaction-estorno-alert";
import {
  TransactionAbonoAlert,
  abonarTransacao,
} from "../../components/transaction-abono-alert";
import { excluirPagamentoMultiplo } from "../../components/pagamento-multiplo";
import { toast } from "@/lib/toast";
import axios, { isAxiosError } from "axios";
import {
  type CampoOrdenacao,
  type FluxoViewMode,
  VIEW_MODE_TABS,
  type Ordenacao,
  Metodo_pagamento,
  Pagination,
  Tipo_transacao,
  Transaction,
  type TransactionRelationFilters,
} from "../types";
import {
  antecipadoComLancamento,
  ehBaixaParcial,
  ehTransferencia,
  origemDaTransacao,
  saldoEmAberto,
  tipoEhEntradaDeCaixa,
  valorLiquidoEfetivo,
} from "@/lib/financeiro/transacao";
import { getCategoryIcon, getTypeColor } from "../utils";
import { ExportTransactionsButton } from "./ExportTransactionsButton";
function DialogLoading() {
  return <p role="status" className="fixed bottom-4 right-4 z-50 rounded-md border bg-background p-3 text-sm shadow">Carregando formulário...</p>;
}

const TransactionDialog = dynamic(() => import("./transactionDialog/transactionDialog"), { loading: DialogLoading });
const TransferenciaDialog = dynamic(() => import("./transferencia-dialog").then((module) => module.TransferenciaDialog), { loading: DialogLoading });
const ConciliacaoOfxDialog = dynamic(() => import("./conciliacao-ofx/conciliacao-ofx-dialog").then((module) => module.ConciliacaoOfxDialog), { loading: DialogLoading });
const VendaDetailsDialog = dynamic(() => import("../../../(vendas)/historicovendas/components/venda-detail-dialog").then((module) => module.VendaDetailsDialog), { loading: DialogLoading });
const OSDetalhesDialog = dynamic(() => import("../../../ordens/components/dialogs/detalhes-os-dialog").then((module) => module.OSDetalhesDialog), { loading: DialogLoading });
const DialogEntradaGeral = dynamic(() => import("../../../estoque/components/dialog-entrada-geral/dialog-entrada-geral").then((module) => module.DialogEntradaGeral), { loading: DialogLoading });
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
  viewMode?: FluxoViewMode;
  isLoading: boolean;
  setSearch: (value: string) => void;
  setTipo: (value: Tipo_transacao | "") => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setViewMode: (value: FluxoViewMode) => void;
  relationFilters: TransactionRelationFilters;
  setRelationFilters: (value: TransactionRelationFilters) => void;
  /**
   * Recorte por autoria. Para quem tem `financeiro:ver_todas_transacoes` e um
   * filtro opcional; para quem não tem, o servidor já recorta e este valor não
   * muda nada — o controle nem aparece.
   */
  apenasMinhas: boolean;
  setApenasMinhas: (value: boolean) => void;
  /** Avisa a página de que os números mudaram: baixa, estorno, exclusão. */
  revalidarIndicadores: () => void;
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
  viewMode = "FLUXO",
  isLoading,
  setSearch,
  setTipo,
  setDateFrom,
  setDateTo,
  setViewMode,
  relationFilters,
  setRelationFilters,
  apenasMinhas,
  setApenasMinhas,
  revalidarIndicadores,
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
   * Modo de seleção.
   *
   * Era "baixa múltipla" e só ligava em lista de pendentes, porque uma lista
   * mista levaria o usuário a marcar linhas que a baixa ia recusar. Agora a
   * seleção serve a mais de uma ação — dar baixa e excluir —, e travar o modo
   * inteiro pela regra de uma delas deixaria a outra inalcançável justamente
   * onde ela é mais usada: o extrato, cheio de linhas liquidadas.
   *
   * A proteção não sumiu, mudou de lugar: ela agora vive no BOTÃO de baixa, que
   * só habilita quando toda a seleção está em aberto. E ficou melhor — antes era
   * por filtro, uma aproximação; agora é pelo que de fato está marcado.
   */
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [baixaEmLoteAberta, setBaixaEmLoteAberta] = useState(false);
  const [baixandoEmLote, setBaixandoEmLote] = useState(false);
  const [adiantamentoAberto, setAdiantamentoAberto] = useState(false);
  const [exclusaoEmLoteAberta, setExclusaoEmLoteAberta] = useState(false);
  const [excluindoEmLote, setExcluindoEmLote] = useState(false);

  const alternarSelecao = useCallback((id: number) => {
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }, []);

  const sairDaSelecao = useCallback(() => {
    setModoSelecao(false);
    setSelecionadas(new Set());
  }, []);

  const transacoesSelecionadas = useMemo(
    () => transactions.filter((t) => selecionadas.has(t.id)),
    [transactions, selecionadas],
  );

  /*
   * A seleção vive dentro da página.
   *
   * `selecionadas` é um Set global, mas só as linhas da página atual viram
   * `transacoesSelecionadas`. Trocar de página escondia ids que continuavam
   * marcados: inofensivo na baixa, que só manda o que está na tela, e confuso na
   * exclusão. O rodapé promete "N de M na página" e a promessa precisa ser
   * verdade.
   */
  useEffect(() => {
    setSelecionadas(new Set());
  }, [pagination.page, viewMode]);

  /** Dar baixa é operação sobre o que ainda não foi pago. */
  const podeBaixarSelecionadas =
    transacoesSelecionadas.length > 0 &&
    transacoesSelecionadas.every((t) => t.pendente === true);

  const liquidadasSelecionadas = transacoesSelecionadas.filter(
    (t) => t.pendente !== true,
  ).length;
  const [isPagoDialogOpen, setIsPagoDialogOpen] = useState(false);
  const [transferenciaAberta, setTransferenciaAberta] = useState(false);
  const [conciliacaoAberta, setConciliacaoAberta] = useState(false);

  /**
   * Dialogs de detalhes do documento de origem (venda/OS/entrada de estoque),
   * abertos a partir do ícone de categoria ou do menu de ações de cada linha.
   * Um par id+open por tipo, renderizado uma única vez fora do .map.
   */
  const [vendaDetalhesId, setVendaDetalhesId] = useState<number | null>(null);
  const [vendaDetalhesAberta, setVendaDetalhesAberta] = useState(false);
  const [osDetalhesId, setOsDetalhesId] = useState<number | null>(null);
  const [osDetalhesAberta, setOsDetalhesAberta] = useState(false);
  const [entradaDetalhesId, setEntradaDetalhesId] = useState<number | null>(null);
  const [entradaDetalhesAberta, setEntradaDetalhesAberta] = useState(false);

  const abrirVenda = useCallback((id: number) => {
    setVendaDetalhesId(id);
    setVendaDetalhesAberta(true);
  }, []);
  const abrirOs = useCallback((id: number) => {
    setOsDetalhesId(id);
    setOsDetalhesAberta(true);
  }, []);
  const abrirEntrada = useCallback((id: number) => {
    setEntradaDetalhesId(id);
    setEntradaDetalhesAberta(true);
  }, []);
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
  /*
   * Sem Caixa administrativo, a lista compartilha lançamentos de usuários
   * comuns e registros sem autor. A decisão é do servidor;
   * aqui ela serve para dizer isso na tela e para esconder um controle que não
   * teria efeito nenhum.
   */
  const podeVerTodas = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_VER_TODAS_TRANSACOES,
  );
  const listaRecortada = !podeVerTodas || apenasMinhas;

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
      revalidarIndicadores();
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

  /**
   * Perdoa um título a receber sem lançar nada no banco. A OS/venda continua
   * quitada; só não passa pelo fluxo de caixa.
   */
  const handleAbonar = async (id: number, motivo?: string) => {
    if (!canEdit) return;
    setIsDeleting(true);
    try {
      await abonarTransacao(id, motivo);
      handleGetTransactions(pagination.page, pagination.limit);
      revalidarIndicadores();
      toast.success("Cobrança abonada.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível abonar a cobrança.");
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
        revalidarIndicadores();
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
                  revalidarIndicadores();
                }}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2
                  width={12}
                  className={isLoading ? "animate-spin" : ""}
                />
              </button>
              {/*
                Uma lista recortada sem aviso vira chamado de suporte: a pessoa
                procura um lançamento que existe e não acha. O ícone sozinho é o
                bastante para levantar a pergunta; quem a faz acha a resposta no
                tooltip, com o histórico sem dono incluído.
              */}
              {listaRecortada ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-default items-center text-muted-foreground">
                      <User className="h-3.5 w-3.5" />
                      <span className="sr-only">{podeVerTodas ? "Mostrando minhas transações e registros sem autor" : "Mostrando lançamentos compartilhados"}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-[320px] text-pretty">
                    {podeVerTodas
                      ? "Filtro ligado por você. A lista, os cartões e a exportação mostram o que você lançou, mais os registros sem autor."
                      : "Você vê os lançamentos compartilhados entre usuários comuns e os registros sem autor. Lançamentos de quem possui “Caixa administrativo” ficam ocultos."}
                  </TooltipContent>
                </Tooltip>
              ) : null}
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
                apenasMinhas={apenasMinhas}
                setApenasMinhas={setApenasMinhas}
                podeVerTodas={podeVerTodas}
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
                      apenasMinhas={apenasMinhas}
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

                  {/*
                    Fica ao lado de "Nova transação" porque é irmã dela: uma
                    operação que nasce aqui, e não algo que se faça a uma linha
                    existente. Por isso não está no menu de cada linha, que age
                    sempre sobre a transação daquela linha.
                  */}
                  {canCreate ? (
                    <DropdownMenuItem
                      className="hover:cursor-pointer"
                      onSelect={() => setTransferenciaAberta(true)}
                    >
                      <ArrowLeftRight className="h-4 w-4" />
                      Transferência entre contas
                    </DropdownMenuItem>
                  ) : null}

                  {/*
                    Conciliação bancária. Fica junto das outras operações que
                    nascem aqui, e não no menu de cada linha: o extrato é sobre
                    a conta inteira, e o que ele produz — vínculo, baixa ou
                    lançamento novo — decide-se depois, movimento a movimento.
                  */}
                  {canCreate ? (
                    <DropdownMenuItem
                      className="hover:cursor-pointer"
                      onSelect={() => setConciliacaoAberta(true)}
                    >
                      <Landmark className="h-4 w-4" />
                      Conciliação bancária (OFX)
                    </DropdownMenuItem>
                  ) : null}

                  {/* Quem só pode excluir também precisa entrar no modo. */}
                  {canEdit || canDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="hover:cursor-pointer"
                        onSelect={() => setModoSelecao(true)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Selecionar transações
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>

              {canCreate ? (
                <MountOnDemand active={isOpen}>
                <TransactionDialog
                  open={isOpen}
                  setOpen={setIsOpen}
                  selectedTransactionId={selectedTransactionId}
                  setSelectedTransactionId={setSelectedTransactionId}
                  editable={canEdit && config?.habilitar_edicao_transacoes === true}
                  handleGetTransactions={() => {
                    handleGetTransactions(pagination.page, pagination.limit);
                    revalidarIndicadores();
                  }}
                />
                </MountOnDemand>
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

              // Origem do documento que gerou esta transação. USOCONSUMO fica
              // de fora de propósito: não há dialog de detalhes conhecido
              // para essa origem — mesmo comportamento de hoje (sem ação).
              const origem = origemDaTransacao(t);
              const detalhesOrigem =
                origem === "VENDA"
                  ? { id: Number(t.vendaid), label: `Ver venda #${t.vendaid}`, Icon: ShoppingCart, abrir: abrirVenda }
                  : origem === "OS"
                    ? { id: Number(t.ordemservicoid), label: `Ver OS #${t.ordemservicoid}`, Icon: FileText, abrir: abrirOs }
                    : origem === "ENTRADA"
                      ? { id: Number(t.entrada_id), label: `Ver entrada #${t.entrada_id}`, Icon: Package, abrir: abrirEntrada }
                      : null;

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
                      No modo de seleção o ícone de categoria dá lugar à caixa de
                      seleção: ocupam o mesmo espaço, então a lista não se
                      reorganiza ao entrar no modo — nada pula sob o cursor.
                    */}
                    {modoSelecao ? (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                        <Checkbox
                          checked={selecionadas.has(t.id)}
                          onCheckedChange={() => alternarSelecao(t.id)}
                          aria-label={`Selecionar transação ${t.id} — ${t.descricao}`}
                          className="hover:cursor-pointer"
                        />
                      </div>
                    ) : detalhesOrigem ? (
                      // Atalho para o mesmo dialog que o item "Ver venda/OS/
                      // entrada" abre no menu de ações — o anel avisa que o
                      // círculo é clicável, sem mudar o fundo nem virar badge.
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          detalhesOrigem.abrir(detalhesOrigem.id);
                        }}
                        // dblclick nativo borbulha até a TableRow mesmo com
                        // stopPropagation no click (são eventos distintos) —
                        // sem isto, um duplo clique no ícone também abriria a
                        // edição da transação por baixo.
                        onDoubleClick={(e) => e.stopPropagation()}
                        title={detalhesOrigem.label}
                        aria-label={detalhesOrigem.label}
                        className="shrink-0 rounded-full p-2 bg-primary/50 ring-2 ring-primary/40 ring-offset-2 ring-offset-background transition-shadow hover:cursor-pointer hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {getCategoryIcon(t.categoria, t.categoria_dados?.icone)}
                      </button>
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
                      {/*
                        De quem é a linha. Só aparece para quem vê a lista
                        inteira — na lista recortada seria o mesmo nome em todas
                        elas, e o histórico sem dono não tem o que mostrar.
                      */}
                      {podeVerTodas && t.criador?.nome ? (
                        <TextoTruncado className="text-xs text-muted-foreground">
                          {`Lançado por ${t.criador.nome}`}
                        </TextoTruncado>
                      ) : null}
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        ID: {t.id}
                        {/*
                          Os dois lados da antecipação se identificam na lista, em
                          cores diferentes: o lançamento que trouxe o dinheiro
                          (azul) e os títulos que ele quitou (verde). Sem isso, os
                          títulos parecem pagamentos que sumiram do caixa — eles
                          aparecem como pagos e sem banco.

                          Do lado dos títulos os badges se compõem: "Antecipado" é
                          o fato de sempre, e "Sem baixa" avisa que aquele ainda
                          não foi baixado. É melhor do que um rótulo único por
                          estado porque a pessoa varre a coluna procurando a mesma
                          palavra, e só depois lê o qualificador.

                          Não há badge para a baixa que foi lançada na conta. Ela
                          se distingue sozinha: aparece no Fluxo e soma na cor do
                          tipo, enquanto as outras ficam de fora e em âmbar. E o
                          motivo dela — o banco ter devolvido o valor — não está
                          registrado em lugar nenhum, então a lista não teria como
                          afirmá-lo.
                        */}
                        {t.eh_adiantamento ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded-sm border border-sky-600/40 bg-sky-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">
                                Antecipação
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start">
                              Adiantou vários títulos de uma vez. Veja quais na aba
                              Adiantamento.
                            </TooltipContent>
                          </Tooltip>
                        ) : t.adiantamento_id != null ? (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex cursor-default items-center rounded-sm border border-emerald-600/40 bg-emerald-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                                  Antecipado
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="start">
                                {t.pendente
                                  ? `Antecipado pelo lançamento #${t.adiantamento_id}: o dinheiro já entrou por ele.`
                                  : `Liquidado pela antecipação #${t.adiantamento_id}. O dinheiro entrou por ela, não por este título.`}
                              </TooltipContent>
                            </Tooltip>

                            {/*
                              O título antecipado que segue em aberto. Ele fica
                              em "a receber"/"a pagar" junto com os títulos
                              comuns, e sem este aviso não há como distingui-lo
                              de um que ainda não teve dinheiro nenhum — o que
                              muda tudo na hora de cobrar: aqui o caixa já
                              recebeu, e o que se acompanha é se o pagador vai
                              honrar o boleto.
                            */}
                            {t.pendente ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex cursor-default items-center rounded-sm border border-amber-600/40 bg-amber-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                    Sem baixa
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start">
                                  Antecipado sem dar baixa, de propósito: segue em
                                  aberto para acompanhar o vencimento. A baixa vem
                                  quando o boleto for honrado.
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </>
                        ) : null}

                        {/*
                          O título pago em partes fica lado a lado com os que não
                          receberam nada, em "a receber"/"a pagar". Sem este aviso
                          não há como distinguir um do outro na varredura — e a
                          diferença muda a conversa da cobrança, porque parte da
                          dívida já foi honrada.
                        */}
                        {/*
                          A linha do dinheiro de uma baixa. No Fluxo ela aparece
                          ao lado das transações comuns e, sem isto, parece um
                          lançamento avulso qualquer — a descrição diz de onde
                          veio, mas descrição é texto solto e pode ser editada.
                        */}
                        {t.baixa_de_transacao_id != null ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded-sm border border-violet-600/40 bg-violet-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-400">
                                Baixa de #{t.baixa_de_transacao_id}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start">
                              É o dinheiro que entrou pela baixa daquele título. O
                              título em si não passa por conta nenhuma.
                            </TooltipContent>
                          </Tooltip>
                        ) : null}

                        {/*
                          Sem este badge o título abonado parece um liquidado
                          qualquer que "esqueceu" de gravar o banco — e é
                          justamente o contrário: nunca houve dinheiro para
                          gravar.
                        */}
                        {t.abonado ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded-sm border border-slate-500/40 bg-slate-500/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                                Abonado
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start">
                              Cobrança perdoada
                              {t.abonado_em ? `, em ${formatDate(t.abonado_em)}` : ""}. Não
                              passou pelo banco.
                              {t.abono_motivo ? ` Motivo: ${t.abono_motivo}` : ""}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}

                        {/*
                          Também fica liquidado e sem banco, como o abonado — e
                          pela mesma razão precisa se explicar: aqui quem pagou
                          foi a carteira do cliente.
                        */}
                        {t.metodopagamento === Metodo_pagamento.CREDITO_CLIENTE ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded-sm border border-teal-600/40 bg-teal-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-teal-700 dark:text-teal-400">
                                Crédito do cliente
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start">
                              {t.tipo === Tipo_transacao.RECEITA
                                ? "Quitado com o crédito do cliente. O saldo da carteira dele caiu; nenhuma conta se moveu."
                                : "Virou crédito na carteira do cliente em vez de sair dinheiro da conta."}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}

                        {/*
                          A perna de uma transferência. No Fluxo ela senta ao lado
                          de saques e depósitos comuns, mas o badge distingue o
                          movimento interno: a empresa não gastou nem faturou nada,
                          o dinheiro só mudou de conta.
                        */}
                        {ehTransferencia(t) ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded-sm border border-sky-600/40 bg-sky-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">
                                Transferência
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start">
                              {tipoEhEntradaDeCaixa(t.tipo)
                                ? "Entrada de uma transferência entre contas suas: o dinheiro veio de outra conta, não de fora."
                                : "Saída de uma transferência entre contas suas: o dinheiro foi para outra conta, não para fora."}{" "}
                              Não entra no DRE, e a outra perna sai junto se esta
                              for excluída.
                            </TooltipContent>
                          </Tooltip>
                        ) : null}

                        {ehBaixaParcial(t) ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded-sm border border-amber-600/40 bg-amber-600/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                                Parcial
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start">
                              Já foram pagos {formatarEmReal(Number(t.valor_baixado ?? 0))} de{" "}
                              {formatarEmReal(valorLiquidoEfetivo(t))}. Os pagamentos
                              aparecem no Fluxo, um a um.
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

    O antecipado cuja baixa foi lançada na conta é a exceção, e
                                    por isso volta à cor do tipo: essa linha moveu caixa e PRECISA
                    ser somada. Deixá-la amarela mandaria pular justamente o
                    dinheiro que entrou.

                    No Fluxo o amarelo não tem função: aquela aba só mostra o que
                    passou por conta, então tudo ali moveu caixa de verdade e a
                    cor volta a significar apenas entrada ou saída.
                  */}
                  <TableCell
                    className={`text-right ${
                      viewMode !== "FLUXO" &&
                      t.adiantamento_id != null &&
                      !antecipadoComLancamento(t)
                        ? "text-amber-600 dark:text-amber-400"
                        : getTypeColor(t.tipo)
                    }`}
                  >
                    <div className="flex flex-col items-end">
                      {(t.tipo === "RECEITA" || t.tipo === "DEPOSITO") && "+ "}
                      {(t.tipo === "DESPESA" || t.tipo === "SAQUE") && "- "}
                      {/* Linha sem líquido (despesa, ou registro antigo) vale o
                          bruto — antes exibia R$ 0,00 com o bruto embaixo. */}
                      {/* Em título parcial o número grande é o que falta: é o
                          que se cobra hoje. O cheio fica embaixo, como o bruto. */}
                      {formatarEmReal(
                        ehBaixaParcial(t) ? saldoEmAberto(t) : valorLiquidoEfetivo(t),
                      )}
                      {ehBaixaParcial(t) ? (
                        <span className="text-xs text-muted-foreground">
                          de {formatarEmReal(valorLiquidoEfetivo(t))} · pago{" "}
                          {formatarEmReal(Number(t.valor_baixado ?? 0))}
                        </span>
                      ) : (
                        Math.round(valorLiquidoEfetivo(t) * 100) !==
                          Math.round(Number(t.valor ?? 0) * 100) && (
                          <span className="text-xs text-muted-foreground">
                            Bruto: {formatarEmReal(t.valor)}
                          </span>
                        )
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

                        {detalhesOrigem && (
                          <DropdownMenuItem onClick={() => detalhesOrigem.abrir(detalhesOrigem.id)}>
                            <detalhesOrigem.Icon className="mr-2 h-4 w-4" />
                            {detalhesOrigem.label}
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
                          Perdoar a cobrança em vez de cobrá-la. Só faz sentido
                          numa receita ligada a OS/venda: é o saldo devedor do
                          documento que o abono fecha. Antecipação e pagamento
                          múltiplo ficam de fora pelo mesmo motivo da baixa —
                          são liquidados em conjunto, não linha a linha.
                        */}
                        {canEdit &&
                          t.pendente &&
                          t.tipo === Tipo_transacao.RECEITA &&
                          (t.ordemservicoid != null || t.vendaid != null) &&
                          !t.adiantamento_id &&
                          !t.eh_adiantamento &&
                          t.pagamento_multiplo_id == null &&
                          t.evento_financeiro_id == null && (
                          <TransactionAbonoAlert
                            transactionId={t.id}
                            valor={saldoEmAberto(t)}
                            onAbonar={handleAbonar}
                          >
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <HandCoins className="mr-2 h-4 w-4" />
                              Abonar cobrança
                            </DropdownMenuItem>
                          </TransactionAbonoAlert>
                        )}

                        {/*
                          Fica ao lado de "Pago" e é o seu inverso: um dá baixa,
                          o outro a desfaz. A antecipação não aparece aqui —
                          liquidada ela é, mas quem a desfaz é a exclusão, que
                          devolve os títulos que ela pagou.

                          O título antecipado também aparece, e por baixa própria
                          entenda-se qualquer uma: no modo que mantém os títulos em
                          aberto, quem acompanhou o vencimento é que deu a baixa, e
                          ela é dele sozinho — tenha trazido dinheiro ou não.

                          Condicionar isto ao repasse escondia o item justamente
                          nos títulos baixados como "boleto honrado", que são a
                          maioria; quem quisesse refazer a baixa não achava o
                          caminho e caía em Excluir, que fala de outra coisa.

                          Quando a antecipação liquidou tudo no ato, a baixa é do
                          conjunto e o servidor recusa — com a mensagem que aponta
                          a operação certa. A lista não tem como saber em qual dos
                          dois modos a antecipação foi feita: esse dado está na
                          linha dela, não na do título.
                        */}
                        {/*
                          A transferência fica de fora: as duas pernas nascem
                          liquidadas, mas não há baixa a desfazer nelas. Estornar
                          reabriria uma perna e deixaria a outra paga — meia
                          transferência, que é o estado que a operação inteira
                          existe para impedir. O caminho dela é excluir, que leva
                          as duas.
                        */}
                        {canEdit &&
                          !t.pendente &&
                          !t.eh_adiantamento &&
                          !ehTransferencia(t) &&
                          t.pagamento_multiplo_id == null && (
                          <TransactionEstornoAlert
                            transactionId={t.id}
                            sentido={t.tipo === Tipo_transacao.RECEITA ? "RECEBER" : "PAGAR"}
                            valorReaberto={Number(t.valor_base ?? t.valor ?? 0)}
                            acrescimos={Number(t.valor_acrescimos ?? 0)}
                            abonado={t.abonado === true}
                            creditoCliente={
                              t.metodopagamento === Metodo_pagamento.CREDITO_CLIENTE
                            }
                            onEstornar={handleEstornarBaixa}
                          >
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                              <Undo2 className="mr-2 h-4 w-4" />
                              {t.abonado
                                ? "Desfazer abono"
                                : t.metodopagamento === Metodo_pagamento.CREDITO_CLIENTE
                                  ? "Devolver o crédito"
                                  : "Excluir do fluxo de caixa"}
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
            revalidarIndicadores();
          }}
        />
      )}

      {canCreate ? (
        <MountOnDemand active={transferenciaAberta}>
        <TransferenciaDialog
          aberto={transferenciaAberta}
          setAberto={setTransferenciaAberta}
          onConcluido={() => {
            handleGetTransactions(pagination.page, pagination.limit);
            revalidarIndicadores();
          }}
        />
        </MountOnDemand>
      ) : null}

      {canCreate ? (
        <MountOnDemand active={conciliacaoAberta}>
        <ConciliacaoOfxDialog
          aberto={conciliacaoAberta}
          setAberto={setConciliacaoAberta}
          onConcluido={() => {
            handleGetTransactions(pagination.page, pagination.limit);
            revalidarIndicadores();
          }}
        />
        </MountOnDemand>
      ) : null}

      <MountOnDemand active={vendaDetalhesAberta}>
      <VendaDetailsDialog
        vendaId={vendaDetalhesId}
        open={vendaDetalhesAberta}
        onOpenChange={(open) => {
          setVendaDetalhesAberta(open);
          setVendaDetalhesId(open ? vendaDetalhesId : null);
          if (!open) {
            handleGetTransactions(pagination.page, pagination.limit);
            revalidarIndicadores();
          }
        }}
      />
      </MountOnDemand>

      <MountOnDemand active={osDetalhesAberta}>
      <OSDetalhesDialog
        open={osDetalhesAberta}
        osId={osDetalhesId}
        onOpenChange={(open) => {
          setOsDetalhesAberta(open);
          if (!open) {
            setOsDetalhesId(null);
            handleGetTransactions(pagination.page, pagination.limit);
            revalidarIndicadores();
          }
        }}
      />
      </MountOnDemand>

      <MountOnDemand active={entradaDetalhesAberta}>
      <DialogEntradaGeral
        selectedEntradaId={entradaDetalhesId ?? undefined}
        open={entradaDetalhesAberta}
        onOpenChange={(open) => {
          setEntradaDetalhesAberta(open);
          if (!open) {
            setEntradaDetalhesId(null);
            handleGetTransactions(pagination.page, pagination.limit);
            revalidarIndicadores();
          }
        }}
      />
      </MountOnDemand>

      {modoSelecao ? (
        <>
          <SelecaoFooter
            selecionadas={selecionadas}
            transacoes={transactions}
            processando={baixandoEmLote || excluindoEmLote}
            podeBaixar={podeBaixarSelecionadas}
            liquidadas={liquidadasSelecionadas}
            podeDarBaixa={canEdit}
            podeExcluir={canDelete}
            onCancelar={sairDaSelecao}
            onConfirmar={() => setBaixaEmLoteAberta(true)}
            onAdiantamento={() => setAdiantamentoAberto(true)}
            onExcluir={() => setExclusaoEmLoteAberta(true)}
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
              sairDaSelecao();
              handleGetTransactions(pagination.page, pagination.limit);
              revalidarIndicadores();
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
              revalidarIndicadores();
            }}
          />
          <ExclusaoMultiplaDialog
            aberto={exclusaoEmLoteAberta}
            setAberto={setExclusaoEmLoteAberta}
            transacoes={transacoesSelecionadas}
            processando={excluindoEmLote}
            setProcessando={setExcluindoEmLote}
            onConcluido={(idsExcluidos) => {
              // Mesma regra da baixa: as que saíram deixam a seleção, as que
              // ficaram continuam marcadas para uma segunda tentativa sem
              // remarcar tudo.
              setSelecionadas((atual) => {
                const proximo = new Set(atual);
                idsExcluidos.forEach((id) => proximo.delete(id));
                return proximo;
              });
              handleGetTransactions(pagination.page, pagination.limit);
              revalidarIndicadores();
            }}
          />
        </>
      ) : null}
    </Card>
  );
}
