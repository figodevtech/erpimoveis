"use client";

import axios, { isAxiosError } from "axios";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  Package,
  ReceiptText,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { useSessionReady } from "@/components/use-session-ready";
import { useCallback, useEffect, useRef, useState } from "react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/lib/toast";
import {
  rotuloDeEscopo,
  type EscopoDeEntrada,
  type UsoConsumoEscopo,
} from "@/lib/usoconsumo/escopo";
import { CancelMovementDialog, type CancelTarget } from "../components/cancel-movement-dialog";
import { CancelarEntradaDialog } from "@/components/entrada-fiscal/cancelar-entrada-dialog";
import { EntryDetailsDialog } from "../components/entry-details-dialog";
import { ExitDetailsDialog } from "../components/exit-details-dialog";
import { EmissaoNotaDialog } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog";
import { LancarFinanceiroEntradaDialog } from "@/components/entrada-fiscal/lancar-financeiro-entrada-dialog";

/**
 * Historico de estoque.
 *
 * Busca, filtro e paginacao rodam no servidor (`/api/estoque/movimentos` e
 * `/api/usoconsumo/movimentos`). A tela pede uma pagina por vez e mostra o
 * total real do resultado — antes ela baixava um lote grande e filtrava no
 * navegador, entao a busca so enxergava o que ja tinha vindo.
 *
 * A busca livre varre o texto achatado da linha, que inclui o motivo da entrada
 * e o da saida — codigo e nome cadastrado. Quem precisa de recorte exato usa o
 * painel de filtros, onde motivo, autor e lancamento viram igualdade no banco.
 */

type InventoryKind = "produtos" | "uso-consumo" | "geral";

/**
 * As duas abas nao-produto sao a MESMA fonte: `usoconsumo_movimento_*` filtrado
 * por escopo. Por isso o corte em toda a tela e "produtos ou nao", e o escopo
 * so entra como parametro da consulta.
 */
const INVENTORY_ESCOPO: Record<Exclude<InventoryKind, "produtos">, UsoConsumoEscopo> = {
  "uso-consumo": "USOCONSUMO",
  geral: "GERAL",
};

function escopoDoInventory(inventory: InventoryKind) {
  return inventory === "produtos" ? null : INVENTORY_ESCOPO[inventory];
}
type Direction = "entrada" | "saida";
type DirectionFilter = "todos" | Direction;
type StatusFilter = "todos" | "CONFIRMADA" | "CANCELADA";
type FiscalFilter = "todos" | "com_nf" | "sem_nf";
type FinanceiroFilter = "todos" | "sem_lancamento";
type AcaoFilter = "todas" | "REGISTRO" | "ESTORNO";

/** "todos" e o valor de "sem filtro" — Select do Radix nao aceita item vazio. */
const SEM_FILTRO = "todos";

/** Opcao de motivo (tipos_entrada / tipos_motivo_saida) ou de autor. */
type Opcao = { valor: string; rotulo: string };

type Origem = "ENTRADA" | "SAIDA_MANUAL" | "VENDA" | "ORDEM_SERVICO" | "NAO_IDENTIFICADA";
type OrigemFilter = "todas" | Origem;

/** Linha do razao de estoque de produtos (/api/estoque/movimentos). */
type RawLedgerMovement = {
  id: number;
  sentido: "ENTRADA" | "SAIDA";
  origem: Origem;
  acao: "REGISTRO" | "ESTORNO";
  quantidade: number;
  saldo_resultante: number | null;
  entrada_id: number | null;
  saida_id: number | null;
  venda_id: number | null;
  ordemservicoid: number | null;
  documento_label: string | null;
  reconstruido: boolean;
  created_at: string;
  status: string | null;
  fiscal: boolean | null;
  financeiro_lancado: boolean | null;
  xml_disponivel: boolean;
  produto?: { titulo?: string | null; unidade?: string | null } | null;
  criador?: { nome?: string | null } | null;
  entrada?: {
    id?: number | null;
    status?: string | null;
    origem?: string | null;
    fiscal?: boolean | null;
    numero_nota?: string | null;
    /** Motivo da entrada: codigo de `tipos_entrada` e o nome cadastrado. */
    tipo?: string | null;
    tipo_nome?: string | null;
    observacao?: string | null;
    fornecedor?: { nomerazaosocial?: string | null } | null;
  } | null;
  saida?: {
    status?: string | null;
    motivo?: string | null;
    motivo_nome?: string | null;
    observacao?: string | null;
    /** Preenchida quando a saida veio de um consumo registrado na OS. */
    ordemservicoid?: number | null;
  } | null;
};

/** Linha do historico de uso e consumo (/api/usoconsumo/movimentos). */
type RawUsoConsumoMovement = {
  sentido: Direction;
  id: number;
  created_at: string;
  status: string | null;
  valor_total: number | null;
  numero_nota: string | null;
  tipo: string | null;
  tipo_nome: string | null;
  origem: string | null;
  motivo: string | null;
  motivo_nome: string | null;
  observacao: string | null;
  parte: string | null;
  fiscal: boolean | null;
  financeiro_lancado: boolean | null;
  xml_disponivel: boolean;
  itens_resumo: string | null;
  criador_nome: string | null;
  /** `MISTO` quando a entrada tem item dos dois estoques simples. */
  escopo: EscopoDeEntrada | null;
  /** Preenchida quando a saida veio de um consumo registrado na OS. */
  saida_ordemservicoid: number | null;
};

type Movement = {
  key: string;
  id: number;
  inventory: InventoryKind;
  direction: Direction;
  createdAt: string;
  description: string;
  party: string;
  items: string;
  /** Motivo da entrada ou da saida, ja no nome legivel do cadastro. */
  motivo: string | null;
  total: number | null;
  status: string;
  fiscal?: boolean;
  financeiroLancado?: boolean | null;
  xmlDisponivel?: boolean;
  numeroNota?: string | null;
  origem?: Origem;
  acao?: "REGISTRO" | "ESTORNO";
  documentKind?: Direction | null;
  documentId?: number | null;
  reconstruido?: boolean;
  /** Entrada com item dos dois estoques simples: aparece nas duas abas. */
  mista?: boolean;
  /**
   * OS que consumiu o item. Preenchida, o cancelamento nao acontece aqui: o
   * banco recusa, porque devolver o saldo sem encerrar a despesa deixaria a
   * ordem com custo de um movimento inexistente.
   */
  ordemServicoId?: number | null;
};

type Pagination = { page?: number; limit?: number; total?: number; totalPages?: number };

/** Estado unico de consulta: tudo aqui vira parametro de requisicao. */
type Filtros = {
  inventory: InventoryKind;
  busca: string;
  direcao: DirectionFilter;
  status: StatusFilter;
  origem: OrigemFilter;
  acao: AcaoFilter;
  /** Codigo de `tipos_entrada`, ou SEM_FILTRO. */
  tipoEntrada: string;
  /** Codigo de `tipos_motivo_saida`, ou SEM_FILTRO. */
  motivoSaida: string;
  /** Id do usuario que assinou o movimento, ou SEM_FILTRO. */
  usuario: string;
  fiscal: FiscalFilter;
  financeiro: FinanceiroFilter;
  dataInicial: string;
  dataFinal: string;
  page: number;
  limit: number;
};

const FILTROS_INICIAIS: Filtros = {
  inventory: "produtos",
  busca: "",
  direcao: "todos",
  status: "todos",
  origem: "todas",
  acao: "todas",
  tipoEntrada: SEM_FILTRO,
  motivoSaida: SEM_FILTRO,
  usuario: SEM_FILTRO,
  fiscal: "todos",
  financeiro: "todos",
  dataInicial: "",
  dataFinal: "",
  page: 1,
  limit: 50,
};

const ROTULO_ORIGEM: Record<Origem, string> = {
  ENTRADA: "Entrada",
  SAIDA_MANUAL: "Saída manual",
  VENDA: "Venda",
  ORDEM_SERVICO: "Ordem de serviço",
  NAO_IDENTIFICADA: "Sem origem",
};

const COR_ORIGEM: Record<Origem, string> = {
  ENTRADA: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  SAIDA_MANUAL: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  VENDA: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  ORDEM_SERVICO: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  NAO_IDENTIFICADA: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

function errorText(error: unknown) {
  if (isAxiosError(error)) return error.response?.data?.error ?? error.message;
  return error instanceof Error ? error.message : "Erro inesperado.";
}

function label(value: string | null | undefined) {
  return value?.trim().replaceAll("_", " ") || "—";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeLedgerMovement(raw: RawLedgerMovement): Movement {
  const direction: Direction = raw.sentido === "ENTRADA" ? "entrada" : "saida";
  const party = raw.entrada?.fornecedor?.nomerazaosocial || raw.criador?.nome || "—";
  const isEstorno = raw.acao === "ESTORNO";
  const itemTitle = raw.produto?.titulo || "Produto";
  const itemUnit = raw.produto?.unidade ? ` ${raw.produto.unidade}` : "";
  const movementItem = `${itemTitle} (${Math.abs(raw.quantidade)}${itemUnit})`;

  // Entrada guarda o motivo em `tipo`; saida manual, em `motivo`. Quando o
  // codigo gravado saiu do cadastro, o proprio codigo vira o rotulo.
  const motivoCru =
    direction === "entrada"
      ? raw.entrada?.tipo_nome || raw.entrada?.tipo
      : raw.saida?.motivo_nome || raw.saida?.motivo;
  const motivo = motivoCru ? label(motivoCru) : null;

  let documentKind: Direction | null = null;
  let documentId: number | null = null;

  if (raw.origem === "ENTRADA") {
    documentKind = "entrada";
    documentId = raw.entrada_id;
  } else if (raw.origem === "SAIDA_MANUAL") {
    documentKind = "saida";
    documentId = raw.saida_id;
  }

  return {
    key: `ledger-${raw.id}`,
    id: raw.id,
    inventory: "produtos",
    direction,
    createdAt: raw.created_at,
    description: isEstorno
      ? `Estorno — ${raw.documento_label || "movimentação"}`
      : raw.entrada?.numero_nota
        ? `NF-e nº ${raw.entrada.numero_nota}`
        : raw.documento_label || ROTULO_ORIGEM[raw.origem] || "Movimentação",
    party,
    items: movementItem,
    motivo,
    total: null,
    status: raw.status || "CONFIRMADA",
    fiscal: Boolean(raw.fiscal),
    financeiroLancado: raw.financeiro_lancado,
    xmlDisponivel: raw.xml_disponivel,
    numeroNota: raw.entrada?.numero_nota ?? null,
    origem: raw.origem,
    acao: raw.acao,
    documentKind,
    documentId,
    reconstruido: raw.reconstruido,
    ordemServicoId: raw.saida?.ordemservicoid ?? null,
  };
}

function normalizeUsoConsumoMovement(raw: RawUsoConsumoMovement, aba: InventoryKind): Movement {
  const padrao = raw.sentido === "entrada" ? "Entrada no estoque" : "Saída do estoque";
  // Entrada guarda o motivo em `tipo`; saida, em `motivo`. Sem nota fiscal, e o
  // motivo que descreve a linha.
  const motivoCru =
    raw.sentido === "entrada" ? raw.tipo_nome || raw.tipo : raw.motivo_nome || raw.motivo;
  const motivo = motivoCru ? label(motivoCru) : null;

  return {
    key: `uso-${raw.sentido}-${raw.id}`,
    id: raw.id,
    // A linha diz de qual estoque simples ela e. Uma entrada MISTO tem item dos
    // dois e aparece nas duas abas, entao quem decide o rotulo dela e a aba.
    inventory:
      raw.escopo === "MISTO" ? aba : raw.escopo === "GERAL" ? "geral" : "uso-consumo",
    mista: raw.escopo === "MISTO",
    direction: raw.sentido,
    createdAt: raw.created_at,
    description: raw.numero_nota ? `Nota fiscal nº ${raw.numero_nota}` : motivo ?? padrao,
    party: raw.parte || raw.criador_nome || "—",
    items: raw.itens_resumo || "—",
    motivo,
    total: raw.valor_total ?? null,
    status: raw.status || "CONFIRMADA",
    fiscal: Boolean(raw.fiscal),
    financeiroLancado: raw.financeiro_lancado,
    xmlDisponivel: raw.xml_disponivel,
    numeroNota: raw.numero_nota ?? null,
    documentKind: raw.sentido,
    documentId: raw.id,
    ordemServicoId: raw.saida_ordemservicoid ?? null,
  };
}

function MovementRow({
  movement,
  cancellable,
  isCanceling,
  showActions,
  onCancel,
  onViewDetails,
  onLancarFinanceiro,
  onBaixarNfe,
  onBaixarDanfe,
  onEmitirNfe,
}: {
  movement: Movement;
  cancellable: boolean;
  isCanceling: boolean;
  showActions: boolean;
  onCancel: (movement: Movement) => void;
  onViewDetails: (movement: Movement) => void;
  onLancarFinanceiro: (movement: Movement) => void;
  onBaixarNfe: (movement: Movement) => void;
  onBaixarDanfe: (movement: Movement) => void;
  onEmitirNfe: (movement: Movement) => void;
}) {
  const isEntrada = movement.direction === "entrada";
  const isEntradaConfirmada =
    isEntrada &&
    movement.status === "CONFIRMADA" &&
    movement.documentKind === "entrada";
  const isEntradaFiscal = isEntradaConfirmada && Boolean(movement.fiscal);
  const canDownloadFiscal = isEntradaFiscal && movement.xmlDisponivel === true;
  // Só a saída de produto emite NF-e. Os estoques simples não têm motor fiscal de
  // saída, e saída cancelada ou estornada não documenta operação nenhuma.
  const canEmitirNfeSaida =
    movement.inventory === "produtos" &&
    movement.documentKind === "saida" &&
    Boolean(movement.documentId) &&
    movement.status === "CONFIRMADA" &&
    movement.acao !== "ESTORNO";
  const hasRowActions =
    Boolean(movement.documentKind && movement.documentId) ||
    isEntradaConfirmada ||
    canEmitirNfeSaida ||
    cancellable;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-start gap-2">
          <div
            className={`shrink-0 rounded-full p-2 ${
              isEntrada ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"
            }`}
          >
            {isEntrada ? <ArrowDownToLine className="size-3.5" /> : <ArrowUpFromLine className="size-3.5" />}
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-1.5 flex-wrap">
              <span className="truncate font-medium">{movement.description}</span>
              {movement.origem ? (
                <Badge
                  variant="outline"
                  className={`shrink-0 px-1.5 py-0 text-[10px] font-normal ${COR_ORIGEM[movement.origem]}`}
                >
                  {ROTULO_ORIGEM[movement.origem]}
                </Badge>
              ) : null}
              {/* Motivo da entrada ou da saida. Some quando ja e a propria
                  descricao da linha, para nao repetir a mesma palavra duas vezes. */}
              {movement.motivo && movement.motivo !== movement.description ? (
                <Badge
                  variant="outline"
                  className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                  title={isEntrada ? "Motivo da entrada" : "Motivo da saída"}
                >
                  {movement.motivo}
                </Badge>
              ) : null}
              {/* A OS do consumo. Alem de identificar a linha, avisa de onde
                  sai o estorno: por aqui o cancelamento e recusado. */}
              {movement.ordemServicoId ? (
                <Badge
                  variant="outline"
                  className="shrink-0 px-1.5 py-0 text-[10px] font-normal border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-400"
                  title="Consumo registrado nesta ordem de serviço. O estorno é feito na OS, cancelando a despesa."
                >
                  OS #{movement.ordemServicoId}
                </Badge>
              ) : null}
              {/* Sem isto a mesma nota aparece nas duas abas sem explicacao. */}
              {movement.mista ? (
                <Badge
                  variant="outline"
                  className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                  title="Esta nota tem itens de uso e consumo e do estoque geral, por isso aparece nas duas abas"
                >
                  Mista
                </Badge>
              ) : null}
              {isEntrada && movement.fiscal ? (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-semibold px-1.5 py-0 text-[10px]"
                  title={movement.numeroNota ? `Nota Fiscal Nº ${movement.numeroNota}` : "Entrada fiscal"}
                >
                  <FileText className="size-3 text-indigo-600 dark:text-indigo-400" />
                  <span>Fiscal</span>
                </Badge>
              ) : null}
              {isEntrada &&
              movement.fiscal &&
              movement.status === "CONFIRMADA" &&
              movement.financeiroLancado === false ? (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-red-500/40 bg-red-500/10 px-1.5 py-0 text-[10px] font-semibold text-red-700 dark:text-red-300"
                  title="Entrada fiscal sem lançamento financeiro ativo"
                >
                  <Wallet className="size-3 text-red-600 dark:text-red-400" />
                  <span>Não lançado</span>
                </Badge>
              ) : null}
              {movement.reconstruido ? (
                <span
                  className="shrink-0 text-[10px] uppercase text-muted-foreground"
                  title="Linha reconstruída na migração do histórico; saldo da época não registrado."
                >
                  reconstruído
                </span>
              ) : null}
            </div>
            <span className="truncate text-xs text-muted-foreground">{movement.party}</span>
            <span className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
              {formatDateTime(movement.createdAt)}
            </span>
            <span className="mt-0.5 line-clamp-2 max-w-xs text-xs text-muted-foreground lg:hidden">
              {movement.items}
            </span>
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden whitespace-nowrap md:table-cell">
        {formatDateTime(movement.createdAt)}
      </TableCell>

      <TableCell className="hidden lg:table-cell">
        <span className="line-clamp-2 max-w-xs text-xs text-muted-foreground">{movement.items}</span>
      </TableCell>

      <TableCell>
        <Badge variant={isEntrada ? "default" : "secondary"} className="whitespace-nowrap">
          {isEntrada ? "Entrada" : "Saída"}
        </Badge>
      </TableCell>

      <TableCell className="hidden sm:table-cell">
        <Badge variant={movement.status === "CONFIRMADA" ? "outline" : "secondary"}>
          {label(movement.status)}
        </Badge>
      </TableCell>

      {showActions ? (
        <TableCell className="text-right">
          {hasRowActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 hover:cursor-pointer">
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Ações</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {movement.documentKind && movement.documentId ? (
                  <DropdownMenuItem onClick={() => onViewDetails(movement)} className="hover:cursor-pointer">
                    <Eye className="mr-2 size-4 text-muted-foreground" />
                    Visualizar
                  </DropdownMenuItem>
                ) : null}

                {isEntradaConfirmada ? (
                  <DropdownMenuItem onClick={() => onLancarFinanceiro(movement)} className="hover:cursor-pointer">
                    <Wallet className="mr-2 size-4 text-emerald-600 dark:text-emerald-400" />
                    Lançar no Financeiro
                  </DropdownMenuItem>
                ) : null}

                {/*
                  Abre a lista de notas desta saída — a mesma da venda e da OS —,
                  e é de lá que sai o assistente de emissão.
                */}
                {canEmitirNfeSaida ? (
                  <DropdownMenuItem onClick={() => onEmitirNfe(movement)} className="hover:cursor-pointer">
                    <ReceiptText className="mr-2 size-4 text-blue-600 dark:text-blue-400" />
                    Emitir NF-e
                  </DropdownMenuItem>
                ) : null}

                {canDownloadFiscal ? (
                  <>
                    <DropdownMenuItem onClick={() => onBaixarNfe(movement)} className="hover:cursor-pointer">
                      <Download className="mr-2 size-4 text-emerald-600 dark:text-emerald-400" />
                      Baixar XML
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onBaixarDanfe(movement)} className="hover:cursor-pointer">
                      <FileText className="mr-2 size-4 text-indigo-600 dark:text-indigo-400" />
                      Baixar DANFE
                    </DropdownMenuItem>
                  </>
                ) : null}

                {cancellable ? (
                  <DropdownMenuItem
                    onClick={() => onCancel(movement)}
                    disabled={isCanceling}
                    className="text-destructive focus:text-destructive hover:cursor-pointer"
                  >
                    <RotateCcw className="mr-2 size-4" />
                    Cancelar
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

const SEM_OPCOES: { tiposEntrada: Opcao[]; motivosSaida: Opcao[]; autores: Opcao[] } = {
  tiposEntrada: [],
  motivosSaida: [],
  autores: [],
};

/** Cadastro de tipos: `{ codigo, nome }` vira `{ valor, rotulo }`. */
function paraOpcoes(items: unknown): Opcao[] {
  return ((items ?? []) as { codigo?: unknown; nome?: unknown }[]).map((item) => ({
    valor: String(item.codigo ?? ""),
    rotulo: String(item.nome || item.codigo || ""),
  }));
}

/**
 * Opcoes dos filtros de motivo e de autor.
 *
 * Carrega uma vez por estoque escolhido, e so quando o painel abre — quem nunca
 * filtra nao paga as tres requisicoes. Os tipos vem sem `ativo=true` de
 * proposito: motivo desativado hoje continua existindo no historico de ontem, e
 * precisa continuar filtravel.
 */
function useOpcoesDeFiltro(inventory: InventoryKind, enabled: boolean) {
  const [opcoes, setOpcoes] = useState(SEM_OPCOES);
  const [carregando, setCarregando] = useState(false);
  const carregado = useRef<InventoryKind | null>(null);

  useEffect(() => {
    if (!enabled || carregado.current === inventory) return;
    let ativo = true;
    const escopoDoEstoque = escopoDoInventory(inventory);
    // Tipos de entrada e motivos de saida sao cadastro compartilhado pelos dois
    // estoques simples: aqui o escopo consultado e o da tabela, nao o do estoque.
    const escopo = escopoDoEstoque ? "USOCONSUMO" : "PRODUTO";
    const autoresUrl = escopoDoEstoque
      ? `/api/usoconsumo/movimentos/autores?escopo=${escopoDoEstoque}`
      : "/api/estoque/movimentos/autores";

    // O setState fica na cadeia de promise, e nao no corpo do efeito, pela mesma
    // regra que o resto do modulo segue (react-hooks/set-state-in-effect).
    void Promise.resolve()
      .then(() => {
        if (!ativo) return null;
        setCarregando(true);
        return Promise.all([
          axios.get(`/api/tipos/tipos-entrada?escopo=${escopo}`),
          axios.get(`/api/tipos/motivos-saida?escopo=${escopo}`),
          axios.get(autoresUrl),
        ]);
      })
      .then((respostas) => {
        if (!ativo || !respostas) return;
        const [tipos, motivos, autores] = respostas;
        carregado.current = inventory;
        setOpcoes({
          tiposEntrada: paraOpcoes(tipos.data?.items),
          motivosSaida: paraOpcoes(motivos.data?.items),
          autores: ((autores.data?.autores ?? []) as { id?: unknown; nome?: unknown }[]).map(
            (autor) => ({ valor: String(autor.id ?? ""), rotulo: String(autor.nome ?? "") }),
          ),
        });
      })
      .catch(() => {
        if (ativo) toast.error("Opções de filtro não carregadas.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [enabled, inventory]);

  return { opcoes, carregandoOpcoes: carregando };
}

function MovementTable({
  filtros,
  movements,
  loading,
  total,
  totalPages,
  onFiltrosChange,
  canCancel,
  canceling,
  onReload,
  onCancel,
  onViewDetails,
  onLancarFinanceiro,
  onBaixarNfe,
  onBaixarDanfe,
  onEmitirNfe,
}: {
  filtros: Filtros;
  movements: Movement[];
  loading: boolean;
  total: number;
  totalPages: number;
  onFiltrosChange: (patch: Partial<Filtros>) => void;
  canCancel: (movement: Movement) => boolean;
  canceling: string | null;
  onReload: () => void;
  onCancel: (movement: Movement) => void;
  onViewDetails: (movement: Movement) => void;
  onLancarFinanceiro: (movement: Movement) => void;
  onBaixarNfe: (movement: Movement) => void;
  onBaixarDanfe: (movement: Movement) => void;
  onEmitirNfe: (movement: Movement) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftDirection, setDraftDirection] = useState<DirectionFilter>(filtros.direcao);
  const [draftStatus, setDraftStatus] = useState<StatusFilter>(filtros.status);
  const [draftOrigem, setDraftOrigem] = useState<OrigemFilter>(filtros.origem);
  const [draftAcao, setDraftAcao] = useState<AcaoFilter>(filtros.acao);
  const [draftTipoEntrada, setDraftTipoEntrada] = useState(filtros.tipoEntrada);
  const [draftMotivoSaida, setDraftMotivoSaida] = useState(filtros.motivoSaida);
  const [draftUsuario, setDraftUsuario] = useState(filtros.usuario);
  const [draftFiscal, setDraftFiscal] = useState<FiscalFilter>(filtros.fiscal);
  const [draftFinanceiro, setDraftFinanceiro] =
    useState<FinanceiroFilter>(filtros.financeiro);
  const [draftDateFrom, setDraftDateFrom] = useState(filtros.dataInicial);
  const [draftDateTo, setDraftDateTo] = useState(filtros.dataFinal);

  const { opcoes, carregandoOpcoes } = useOpcoesDeFiltro(filtros.inventory, sheetOpen);
  const produtos = filtros.inventory === "produtos";

  const showActions = movements.length > 0;
  const colSpan = showActions ? 6 : 5;
  const isEmpty = !loading && movements.length === 0;
  const start = (filtros.page - 1) * filtros.limit;
  const activeFilterCount =
    Number(filtros.direcao !== "todos") +
    Number(filtros.status !== "todos") +
    Number(filtros.origem !== "todas") +
    Number(filtros.acao !== "todas") +
    Number(filtros.tipoEntrada !== SEM_FILTRO) +
    Number(filtros.motivoSaida !== SEM_FILTRO) +
    Number(filtros.usuario !== SEM_FILTRO) +
    Number(filtros.fiscal !== "todos") +
    Number(filtros.financeiro !== "todos") +
    Number(Boolean(filtros.dataInicial)) +
    Number(Boolean(filtros.dataFinal));

  function changeInventory(value: string) {
    if (value !== "produtos" && value !== "uso-consumo" && value !== "geral") return;
    onFiltrosChange({ inventory: value });
  }

  function changeSheetOpen(open: boolean) {
    if (open) {
      setDraftDirection(filtros.direcao);
      setDraftStatus(filtros.status);
      setDraftOrigem(filtros.origem);
      setDraftAcao(filtros.acao);
      setDraftTipoEntrada(filtros.tipoEntrada);
      setDraftMotivoSaida(filtros.motivoSaida);
      setDraftUsuario(filtros.usuario);
      setDraftFiscal(filtros.fiscal);
      setDraftFinanceiro(filtros.financeiro);
      setDraftDateFrom(filtros.dataInicial);
      setDraftDateTo(filtros.dataFinal);
    }
    setSheetOpen(open);
  }

  /**
   * Motivo de entrada e motivo de saida vivem em lados opostos do histórico: os
   * dois juntos nunca devolvem linha. Escolher um solta o outro e já acerta o
   * sentido — e, no razão de produtos, também a origem, porque motivo de saída
   * só existe na saída manual.
   */
  function changeDraftTipoEntrada(valor: string) {
    setDraftTipoEntrada(valor);
    if (valor === SEM_FILTRO) return;
    setDraftMotivoSaida(SEM_FILTRO);
    setDraftDirection("entrada");
    if (produtos) setDraftOrigem("ENTRADA");
  }

  function changeDraftMotivoSaida(valor: string) {
    setDraftMotivoSaida(valor);
    if (valor === SEM_FILTRO) return;
    setDraftTipoEntrada(SEM_FILTRO);
    setDraftDirection("saida");
    if (produtos) setDraftOrigem("SAIDA_MANUAL");
  }

  function applyFilters() {
    onFiltrosChange({
      direcao: draftFinanceiro === "sem_lancamento" ? "entrada" : draftDirection,
      status: draftFinanceiro === "sem_lancamento" ? "CONFIRMADA" : draftStatus,
      origem:
        draftFinanceiro === "sem_lancamento" && produtos ? "ENTRADA" : draftOrigem,
      acao: draftAcao,
      tipoEntrada: draftTipoEntrada,
      motivoSaida: draftMotivoSaida,
      usuario: draftUsuario,
      fiscal: draftFiscal,
      financeiro: draftFinanceiro,
      dataInicial: draftDateFrom,
      dataFinal: draftDateTo,
    });
    setSheetOpen(false);
  }

  function clearDraftFilters() {
    setDraftDirection("todos");
    setDraftStatus("todos");
    setDraftOrigem("todas");
    setDraftAcao("todas");
    setDraftTipoEntrada(SEM_FILTRO);
    setDraftMotivoSaida(SEM_FILTRO);
    setDraftUsuario(SEM_FILTRO);
    setDraftFiscal("todos");
    setDraftFinanceiro("todos");
    setDraftDateFrom("");
    setDraftDateTo("");
  }

  return (
    <Card className="bg-card">
      <CardHeader className="border-b-2 pb-4">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <div className="min-w-0 lg:max-w-xs">
            <CardTitle>Histórico de estoque</CardTitle>
            <CardDescription className="flex flex-col items-start gap-1">
              <span>Todas as entradas e saídas, separadas entre produtos, uso/consumo e geral/avulso.</span>
              <button
                type="button"
                onClick={onReload}
                className="inline-flex items-center gap-1 text-foreground/50 hover:cursor-pointer hover:text-foreground/70"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={loading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="flex shrink-0 justify-center lg:order-2 lg:justify-start">
            <Tabs value={filtros.inventory} onValueChange={changeInventory}>
              <TabsList className="h-auto gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                <TabsTrigger
                  value="produtos"
                  className="h-8 rounded-xl px-3 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
                >
                  <Package className="size-3.5" />
                  Produtos
                </TabsTrigger>
                <TabsTrigger
                  value="uso-consumo"
                  className="h-8 rounded-xl px-3 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
                >
                  <Boxes className="size-3.5" />
                  {rotuloDeEscopo("USOCONSUMO").nome}
                </TabsTrigger>
                <TabsTrigger
                  value="geral"
                  className="h-8 rounded-xl px-3 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
                >
                  <Boxes className="size-3.5" />
                  {rotuloDeEscopo("GERAL").nome}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:order-3 lg:w-auto lg:items-center lg:justify-end">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filtros.busca}
                onChange={(event) => onFiltrosChange({ busca: event.target.value })}
                placeholder="Buscar por item, nota, motivo, pessoa..."
                className="h-9 pl-9"
              />
            </div>

            <Sheet open={sheetOpen} onOpenChange={changeSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2 hover:cursor-pointer">
                  <SlidersHorizontal className="size-4" />
                  Filtros
                  {activeFilterCount > 0 ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                      {activeFilterCount}
                    </span>
                  ) : null}
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full overflow-hidden sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Filtros do histórico de estoque</SheetTitle>
                </SheetHeader>

                <div className="grid min-h-0 flex-1 auto-rows-min gap-5 overflow-y-auto px-4 pb-4">
                  <div className="space-y-5 rounded-xl border bg-card p-4">
                    <div className="space-y-2">
                      <Label>Movimentação</Label>
                      <Select value={draftDirection} onValueChange={(value) => setDraftDirection(value as DirectionFilter)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Entradas e saídas</SelectItem>
                          <SelectItem value="entrada">Somente entradas</SelectItem>
                          <SelectItem value="saida">Somente saídas</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {produtos ? (
                      <div className="space-y-2 border-t pt-4">
                        <Label>Origem</Label>
                        <Select value={draftOrigem} onValueChange={(value) => setDraftOrigem(value as OrigemFilter)}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todas">Todas as origens</SelectItem>
                            <SelectItem value="ENTRADA">Entrada</SelectItem>
                            <SelectItem value="SAIDA_MANUAL">Saída manual</SelectItem>
                            <SelectItem value="VENDA">Venda</SelectItem>
                            <SelectItem value="ORDEM_SERVICO">Ordem de serviço</SelectItem>
                            <SelectItem value="NAO_IDENTIFICADA">Sem origem</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    <div className="space-y-2 border-t pt-4">
                      <Label htmlFor="estoque-motivo-entrada">Motivo da entrada</Label>
                      <Select value={draftTipoEntrada} onValueChange={changeDraftTipoEntrada}>
                        <SelectTrigger id="estoque-motivo-entrada" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_FILTRO}>Todos os motivos de entrada</SelectItem>
                          {opcoes.tiposEntrada.map((opcao) => (
                            <SelectItem key={opcao.valor} value={opcao.valor}>
                              {opcao.rotulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {carregandoOpcoes
                          ? "Carregando motivos..."
                          : "Tipos cadastrados em Configurações › Tipos."}
                      </p>
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <Label htmlFor="estoque-motivo-saida">Motivo da saída</Label>
                      <Select value={draftMotivoSaida} onValueChange={changeDraftMotivoSaida}>
                        <SelectTrigger id="estoque-motivo-saida" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_FILTRO}>Todos os motivos de saída</SelectItem>
                          {opcoes.motivosSaida.map((opcao) => (
                            <SelectItem key={opcao.valor} value={opcao.valor}>
                              {opcao.rotulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <Label htmlFor="estoque-usuario">Usuário</Label>
                      <Select value={draftUsuario} onValueChange={setDraftUsuario}>
                        <SelectTrigger id="estoque-usuario" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_FILTRO}>Todos os usuários</SelectItem>
                          {opcoes.autores.map((opcao) => (
                            <SelectItem key={opcao.valor} value={opcao.valor}>
                              {opcao.rotulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Quem registrou o movimento. Venda e ordem de serviço podem não ter autor.
                      </p>
                    </div>

                    {/*
                      Estorno é a linha que desfaz outra: escondê-lo deixa só o
                      que de fato aconteceu, sem o par de cancelamento no meio.
                    */}
                    {produtos ? (
                      <div className="space-y-2 border-t pt-4">
                        <Label>Lançamento</Label>
                        <Select value={draftAcao} onValueChange={(value) => setDraftAcao(value as AcaoFilter)}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todas">Registros e estornos</SelectItem>
                            <SelectItem value="REGISTRO">Somente registros</SelectItem>
                            <SelectItem value="ESTORNO">Somente estornos</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    <div className="space-y-2 border-t pt-4">
                      <Label>Status</Label>
                      <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value as StatusFilter)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Todos os status</SelectItem>
                          <SelectItem value="CONFIRMADA">Confirmadas</SelectItem>
                          <SelectItem value="CANCELADA">Canceladas</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <Label>Nota Fiscal (NF-e)</Label>
                      <Select value={draftFiscal} onValueChange={(value) => setDraftFiscal(value as FiscalFilter)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Todos os lançamentos</SelectItem>
                          <SelectItem value="com_nf">Somente com Nota Fiscal (NF-e)</SelectItem>
                          <SelectItem value="sem_nf">Sem Nota Fiscal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 border-t pt-4">
                      <Label>Financeiro</Label>
                      <Select
                        value={draftFinanceiro}
                        onValueChange={(value) => {
                          const financeiro = value as FinanceiroFilter;
                          setDraftFinanceiro(financeiro);
                          if (financeiro === "sem_lancamento") {
                            setDraftDirection("entrada");
                            setDraftStatus("CONFIRMADA");
                            setDraftMotivoSaida(SEM_FILTRO);
                            if (produtos) setDraftOrigem("ENTRADA");
                          }
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Qualquer situação</SelectItem>
                          <SelectItem value="sem_lancamento">
                            Entradas sem lançamento financeiro
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3 border-t pt-4">
                      <Label>Período</Label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="estoque-data-inicial" className="text-xs text-muted-foreground">
                            Data inicial
                          </Label>
                          <Input
                            id="estoque-data-inicial"
                            type="date"
                            value={draftDateFrom}
                            onChange={(event) => setDraftDateFrom(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="estoque-data-final" className="text-xs text-muted-foreground">
                            Data final
                          </Label>
                          <Input
                            id="estoque-data-final"
                            type="date"
                            value={draftDateTo}
                            onChange={(event) => setDraftDateTo(event.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/*
                  Fora da area que rola: sao dez filtros no painel, e os dois
                  botoes que encerram a escolha nao podem depender de o usuario
                  chegar ao fim da lista para reaparecer.
                */}
                <div className="flex shrink-0 justify-end gap-2 border-t bg-background p-4">
                  <Button type="button" variant="outline" onClick={clearDraftFilters}>
                    Limpar
                  </Button>
                  <Button type="button" onClick={applyFilters}>
                    Aplicar filtros
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </CardHeader>

      <CardContent className="relative -mt-[24px] min-h-[300px] px-4 pb-4 pt-0">
        <div
          className={`${
            loading ? "opacity-100" : ""
          } absolute left-0 right-0 top-0 h-0.5 w-full overflow-hidden bg-slate-400 opacity-0 transition-all`}
        >
          <div
            className={`absolute left-0 h-full w-1/2 -translate-x-[100%] rounded-lg bg-primary ${
              loading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        <Table className="mt-6 text-xs">
          <TableHeader>
            <TableRow className="font-bold">
              <TableHead>Descrição</TableHead>
              <TableHead className="hidden md:table-cell">Data</TableHead>
              <TableHead className="hidden lg:table-cell">Itens</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              {showActions ? <TableHead className="w-24 text-right">Ações</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((movement) => (
              <MovementRow
                key={movement.key}
                movement={movement}
                cancellable={canCancel(movement)}
                isCanceling={canceling === movement.key}
                showActions={showActions}
                onCancel={onCancel}
                onViewDetails={onViewDetails}
                onLancarFinanceiro={onLancarFinanceiro}
                onBaixarNfe={onBaixarNfe}
                onBaixarDanfe={onBaixarDanfe}
                onEmitirNfe={onEmitirNfe}
              />
            ))}

            {isEmpty ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-32 text-center text-muted-foreground">
                  Nenhuma movimentação encontrada.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {loading && movements.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            Carregando histórico...
          </div>
        ) : null}

        {movements.length > 0 ? (
          <div className="mt-4 grid min-h-9 grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-nowrap justify-self-center text-xs text-muted-foreground sm:justify-self-start">
              <span>{start + 1}</span> - <span>{start + movements.length}</span>
              <span className="ml-1 hidden sm:block">de {total}</span>
            </div>

            <div className="flex items-center justify-center space-x-1 sm:space-x-3 sm:col-start-2 sm:row-start-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Primeira página"
                  disabled={filtros.page === 1}
                  onClick={() => onFiltrosChange({ page: 1 })}
                >
                  <ChevronsLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Página anterior"
                  disabled={filtros.page === 1}
                  onClick={() => onFiltrosChange({ page: Math.max(1, filtros.page - 1) })}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-20 text-center text-xs text-muted-foreground">
                  Pg. {filtros.page} de {totalPages}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  aria-label="Próxima página"
                  disabled={filtros.page >= totalPages}
                  onClick={() => onFiltrosChange({ page: Math.min(totalPages, filtros.page + 1) })}
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  aria-label="Última página"
                  disabled={filtros.page >= totalPages}
                  onClick={() => onFiltrosChange({ page: totalPages })}
                >
                  <ChevronsRight className="size-4" />
                </Button>
            </div>

            <Select
              value={String(filtros.limit)}
              onValueChange={(value) => onFiltrosChange({ limit: Number(value) })}
            >
              <SelectTrigger
                className="w-auto justify-self-center hover:cursor-pointer sm:col-start-3 sm:row-start-1 sm:justify-self-end"
                aria-label="Itens por página"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="500">500</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function HistoricoEstoquePage() {
  const { session, ready: sessionReady } = useSessionReady();
  const permissions = (session?.user as { permissoes?: unknown })?.permissoes;
  const canProducts = permissionSetHas(permissions, PERMS.ESTOQUE);
  const canUse = permissionSetHas(permissions, PERMS.USOCONSUMO);
  const canCancelUse = permissionSetHas(permissions, PERMS.USOCONSUMO_CANCELAR);
  const canCancelProducts = permissionSetHas(permissions, PERMS.ESTOQUE_EDITAR);

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIAIS);
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ movement: Movement; target: CancelTarget } | null>(null);
  const [entradaCancelamento, setEntradaCancelamento] = useState<
    { id: number; origem: "ESTOQUE" | "USOCONSUMO" } | null
  >(null);
  const [detalhesMovimento, setDetalhesMovimento] = useState<{
    id: number;
    inventory: "produto" | "usoconsumo";
    kind: Direction;
  } | null>(null);
  const [lancarFinanceiroEntrada, setLancarFinanceiroEntrada] = useState<{
    id: number;
    inventory: "produto" | "usoconsumo";
    escopo: UsoConsumoEscopo;
  } | null>(null);
  /** Saída cujas notas estão abertas. É de lá que sai a emissão. */
  const [notasDaSaida, setNotasDaSaida] = useState<number | null>(null);

  /** Descarta resposta de requisicao antiga: quem digita rapido nao ve o passado. */
  const requisicaoAtual = useRef(0);

  function alterarFiltros(patch: Partial<Filtros>) {
    setFiltros((atual) => {
      const proximo = { ...atual, ...patch };
      // Mudou qualquer criterio? A pagina volta ao inicio — so a navegacao
      // explicita de pagina mantem onde estava.
      if (patch.page === undefined) proximo.page = 1;
      // Origem e acao so existem no razao de produtos.
      if (proximo.inventory !== "produtos") {
        proximo.origem = "todas";
        proximo.acao = "todas";
      }
      // Trocar de estoque troca os cadastros por tras dos filtros: os codigos de
      // motivo tem escopo, e cada aba tem sua propria lista de autores. Manter a
      // escolha antiga so devolveria lista vazia sem explicar por que.
      if (patch.inventory && patch.inventory !== atual.inventory) {
        proximo.tipoEntrada = SEM_FILTRO;
        proximo.motivoSaida = SEM_FILTRO;
        proximo.usuario = SEM_FILTRO;
      }
      return proximo;
    });
  }

  // Quem so tem uso e consumo abre direto na aba que pode ver.
  useEffect(() => {
    if (!sessionReady) return;
    if (canProducts || !canUse) return;
    setFiltros((atual) =>
      atual.inventory === "produtos" ? { ...atual, inventory: "uso-consumo", origem: "todas", page: 1 } : atual,
    );
  }, [canProducts, canUse, sessionReady]);

  useEffect(() => {
    const timer = setTimeout(() => setBuscaAplicada(filtros.busca.trim()), 350);
    return () => clearTimeout(timer);
  }, [filtros.busca]);

  const carregar = useCallback(async () => {
    const permitido = filtros.inventory === "produtos" ? canProducts : canUse;
    const id = ++requisicaoAtual.current;

    if (!permitido) {
      setMovements([]);
      setTotal(0);
      setTotalPages(1);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: filtros.page, limit: filtros.limit };
      if (buscaAplicada) params.q = buscaAplicada;
      if (filtros.direcao !== "todos") params.sentido = filtros.direcao;
      if (filtros.status !== "todos") params.status = filtros.status;
      if (filtros.tipoEntrada !== SEM_FILTRO) params.tipoEntrada = filtros.tipoEntrada;
      if (filtros.motivoSaida !== SEM_FILTRO) params.motivoSaida = filtros.motivoSaida;
      if (filtros.usuario !== SEM_FILTRO) params.usuario = filtros.usuario;
      if (filtros.fiscal !== "todos") params.fiscal = filtros.fiscal;
      if (filtros.financeiro !== "todos") params.financeiro = filtros.financeiro;
      if (filtros.dataInicial) params.desde = new Date(`${filtros.dataInicial}T00:00:00`).toISOString();
      if (filtros.dataFinal) params.ate = new Date(`${filtros.dataFinal}T23:59:59.999`).toISOString();

      const produtos = filtros.inventory === "produtos";
      const escopoDoEstoque = escopoDoInventory(filtros.inventory);
      if (escopoDoEstoque) params.escopo = escopoDoEstoque;
      if (produtos && filtros.origem !== "todas") params.origem = filtros.origem;
      if (produtos && filtros.acao !== "todas") params.acao = filtros.acao;

      const { data } = await axios.get(
        produtos ? "/api/estoque/movimentos" : "/api/usoconsumo/movimentos",
        { params },
      );
      if (id !== requisicaoAtual.current) return;

      const linhas = (data.data ?? []) as unknown[];
      setMovements(
        produtos
          ? (linhas as RawLedgerMovement[]).map(normalizeLedgerMovement)
          : (linhas as RawUsoConsumoMovement[]).map((linha) =>
              normalizeUsoConsumoMovement(linha, filtros.inventory),
            ),
      );

      const paginacao = (data.pagination ?? {}) as Pagination;
      const paginas = Math.max(1, paginacao.totalPages ?? 1);
      setTotal(paginacao.total ?? 0);
      setTotalPages(paginas);
      // Apagar filtro pode encolher o resultado abaixo da pagina em que se estava.
      if (filtros.page > paginas) setFiltros((atual) => ({ ...atual, page: paginas }));
    } catch (error) {
      if (id !== requisicaoAtual.current) return;
      setMovements([]);
      setTotal(0);
      setTotalPages(1);
      toast.error("Histórico de estoque não carregado", { description: errorText(error) });
    } finally {
      if (id === requisicaoAtual.current) setLoading(false);
    }
  }, [
    buscaAplicada,
    canProducts,
    canUse,
    filtros.acao,
    filtros.dataFinal,
    filtros.dataInicial,
    filtros.direcao,
    filtros.fiscal,
    filtros.financeiro,
    filtros.inventory,
    filtros.limit,
    filtros.motivoSaida,
    filtros.origem,
    filtros.page,
    filtros.status,
    filtros.tipoEntrada,
    filtros.usuario,
  ]);

  useEffect(() => {
    if (!sessionReady) return;
    void carregar();
  }, [carregar, sessionReady]);

  function podeCancelar(movement: Movement) {
    if (movement.status !== "CONFIRMADA") return false;
    if (movement.inventory !== "produtos") return canCancelUse;
    if (!movement.documentKind || !movement.documentId) return false;
    if (movement.acao === "ESTORNO") return false;
    return canCancelProducts;
  }

  async function cancelMovement(motivo: string) {
    if (!cancelTarget) return;
    const { movement } = cancelTarget;

    setCanceling(movement.key);
    try {
      const kind = movement.documentKind ?? movement.direction;
      const documentId = movement.documentId ?? movement.id;
      const path = kind === "entrada" ? "entradas" : "saidas";
      const endpoint =
        movement.inventory !== "produtos"
          ? `/api/usoconsumo/${path}/${movement.id}/cancelar`
          : kind === "entrada"
            ? `/api/entradas/${documentId}/cancelar`
            : `/api/estoque/saidas/${documentId}/cancelar`;
      await axios.post(endpoint, { motivo });
      toast.success("Movimentação cancelada.");
      setCancelTarget(null);
      await carregar();
    } catch (error) {
      toast.error("Cancelamento não realizado", { description: errorText(error) });
    } finally {
      setCanceling(null);
    }
  }

  async function handleBaixarNfe(movement: Movement) {
    const docId = movement.documentId ?? movement.id;
    const inventory = movement.inventory !== "produtos" ? "usoconsumo" : "produto";
    const toastId = toast.loading("Baixando XML da NF-e...");

    try {
      const response = await fetch(`/api/entradas/${docId}/xml?inventory=${inventory}`);
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || errData?.detail || "XML da NF-e não encontrado.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `NFe-Entrada-${docId}.xml`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("XML baixado com sucesso!", { id: toastId });
    } catch (error: any) {
      toast.error("Não foi possível baixar a NF-e", {
        id: toastId,
        description: error?.message,
      });
    }
  }

  async function handleBaixarDanfe(movement: Movement) {
    const docId = movement.documentId ?? movement.id;
    const inventory = movement.inventory !== "produtos" ? "usoconsumo" : "produto";
    const toastId = toast.loading("Gerando PDF do DANFE...");

    try {
      const response = await fetch(`/api/entradas/${docId}/danfe?inventory=${inventory}`);
      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || errData?.detail || "Erro ao gerar PDF do DANFE.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `DANFE-Entrada-${docId}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("DANFE (PDF) baixado com sucesso!", { id: toastId });
    } catch (error: any) {
      toast.error("Não foi possível baixar o DANFE", {
        id: toastId,
        description: error?.message,
      });
    }
  }

  return (
    <div className="mx-auto space-y-6">
      <MovementTable
        filtros={filtros}
        movements={movements}
        loading={loading}
        total={total}
        totalPages={totalPages}
        onFiltrosChange={alterarFiltros}
        canCancel={podeCancelar}
        canceling={canceling}
        onReload={() => void carregar()}
        onViewDetails={(movement) => {
          if (!movement.documentKind || !movement.documentId) return;
          setDetalhesMovimento({
            id: movement.documentId,
            inventory: movement.inventory !== "produtos" ? "usoconsumo" : "produto",
            kind: movement.documentKind,
          });
        }}
        onLancarFinanceiro={(movement) => {
          const docId = movement.documentId ?? movement.id;
          setLancarFinanceiroEntrada({
            id: docId,
            inventory: movement.inventory !== "produtos" ? "usoconsumo" : "produto",
            escopo: escopoDoInventory(movement.inventory) ?? "USOCONSUMO",
          });
        }}
        onBaixarNfe={handleBaixarNfe}
        onBaixarDanfe={handleBaixarDanfe}
        onEmitirNfe={(movement) => {
          const saidaId = movement.documentId;
          if (!saidaId) return;
          setNotasDaSaida(saidaId);
        }}
        onCancel={(movement) => {
          const kind = movement.documentKind ?? movement.direction;
          const documentId = movement.documentId ?? movement.id;

          if (kind === "entrada") {
            setEntradaCancelamento({
              id: documentId,
              origem: movement.inventory !== "produtos" ? "USOCONSUMO" : "ESTOQUE",
            });
            return;
          }
          setCancelTarget({
            movement,
            target: {
              id: documentId,
              kind,
              inventory: movement.inventory !== "produtos" ? "usoconsumo" : "produto",
              ordemServicoId: movement.ordemServicoId ?? null,
            },
          });
        }}
      />

      <EntryDetailsDialog
        open={detalhesMovimento?.kind === "entrada"}
        onOpenChange={(open) => !open && setDetalhesMovimento(null)}
        entryId={detalhesMovimento?.kind === "entrada" ? detalhesMovimento.id : null}
        inventory={detalhesMovimento?.inventory ?? "produto"}
      />

      <ExitDetailsDialog
        open={detalhesMovimento?.kind === "saida"}
        onOpenChange={(open) => !open && setDetalhesMovimento(null)}
        exitId={detalhesMovimento?.kind === "saida" ? detalhesMovimento.id : null}
        inventory={detalhesMovimento?.inventory ?? "produto"}
      />

      {/*
        Mesmo diálogo da venda e da OS: lista as notas da saída e abre o
        assistente de emissão. Recarrega o histórico ao fechar, porque emitir
        pode ter marcado a saída como fiscal.
      */}
      <EmissaoNotaDialog
        open={notasDaSaida !== null}
        onOpenChange={(open) => {
          if (open) return;
          setNotasDaSaida(null);
          void carregar();
        }}
        saidaId={notasDaSaida}
      />

      <LancarFinanceiroEntradaDialog
        open={lancarFinanceiroEntrada !== null}
        onOpenChange={(open) => !open && setLancarFinanceiroEntrada(null)}
        entryId={lancarFinanceiroEntrada?.id ?? null}
        inventory={lancarFinanceiroEntrada?.inventory ?? "produto"}
        escopo={lancarFinanceiroEntrada?.escopo ?? "USOCONSUMO"}
        onSuccess={() => void carregar()}
      />

      <CancelMovementDialog
        target={cancelTarget?.target ?? null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onConfirm={cancelMovement}
        canceling={canceling !== null}
      />

      <CancelarEntradaDialog
        open={entradaCancelamento !== null}
        onOpenChange={(open) => !open && setEntradaCancelamento(null)}
        entradaId={entradaCancelamento?.id ?? null}
        origem={entradaCancelamento?.origem ?? "ESTOQUE"}
      />
    </div>
  );
}
