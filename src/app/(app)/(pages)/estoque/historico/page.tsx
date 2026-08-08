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
  RotateCcw,
  Search,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { CancelMovementDialog, type CancelTarget } from "../components/cancel-movement-dialog";
import { CancelarEntradaDialog } from "@/components/entrada-fiscal/cancelar-entrada-dialog";
import { EntryDetailsDialog } from "../components/entry-details-dialog";
import { LancarFinanceiroEntradaDialog } from "@/components/entrada-fiscal/lancar-financeiro-entrada-dialog";

type InventoryKind = "produtos" | "uso-consumo";
type Direction = "entrada" | "saida";
type DirectionFilter = "todos" | Direction;
type StatusFilter = "todos" | "CONFIRMADA" | "CANCELADA";

type MovementItem = {
  quantidade?: number | null;
  titulo?: string | null;
  unidade?: string | null;
  item?: { titulo?: string | null; unidade?: string | null } | null;
  produto?: { titulo?: string | null; unidade?: string | null } | null;
};

type RawMovement = {
  id: number;
  created_at: string;
  fiscal?: boolean | null;
  numero_nota?: string | null;
  origem?: string | null;
  tipo?: string | null;
  motivo?: string | null;
  observacao?: string | null;
  status?: string | null;
  valor_total?: number | null;
  funcionario?: string | null;
  setor?: string | null;
  fornecedor?: { nomerazaosocial?: string | null } | null;
  centro_custo?: { nome?: string | null } | null;
  itens?: MovementItem[] | null;
};

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
  produto?: { titulo?: string | null; unidade?: string | null } | null;
  criador?: { nome?: string | null } | null;
  entrada?: { status?: string | null; fornecedor?: { nomerazaosocial?: string | null } | null } | null;
  saida?: { status?: string | null; motivo?: string | null; observacao?: string | null } | null;
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
  total: number | null;
  status: string;
  fiscal?: boolean;
  origem?: Origem;
  acao?: "REGISTRO" | "ESTORNO";
  documentKind?: Direction | null;
  documentId?: number | null;
  reconstruido?: boolean;
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

function movementItems(lines?: MovementItem[] | null) {
  if (!lines?.length) return "—";
  return lines
    .map((line) => {
      const related = line.item ?? line.produto;
      const title = line.titulo || related?.titulo || "Item";
      const unit = line.unidade || related?.unidade || "";
      return `${title} (${Number(line.quantidade ?? 0)}${unit ? ` ${unit}` : ""})`;
    })
    .join(", ");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeMovement(
  raw: RawMovement,
  inventory: InventoryKind,
  direction: Direction,
): Movement {
  return {
    key: `${inventory}-${direction}-${raw.id}`,
    id: raw.id,
    inventory,
    direction,
    createdAt: raw.created_at,
    description:
      raw.numero_nota
        ? `Nota fiscal nº ${raw.numero_nota}`
        : raw.motivo || raw.tipo || (direction === "entrada" ? "Entrada no estoque" : "Saída do estoque"),
    party: raw.fornecedor?.nomerazaosocial || raw.funcionario || raw.setor || raw.centro_custo?.nome || "—",
    items: movementItems(raw.itens),
    total: raw.valor_total ?? null,
    status: raw.status || "CONFIRMADA",
    fiscal: Boolean(raw.fiscal),
  };
}

function normalizeLedgerMovement(raw: RawLedgerMovement): Movement {
  const direction: Direction = raw.sentido === "ENTRADA" ? "entrada" : "saida";
  const party = raw.entrada?.fornecedor?.nomerazaosocial || raw.criador?.nome || "—";
  const isEstorno = raw.acao === "ESTORNO";
  const itemTitle = raw.produto?.titulo || "Produto";
  const itemUnit = raw.produto?.unidade ? ` ${raw.produto.unidade}` : "";
  const movementItem = `${itemTitle} (${Math.abs(raw.quantidade)}${itemUnit})`;

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
      : raw.documento_label || ROTULO_ORIGEM[raw.origem] || "Movimentação",
    party,
    items: movementItem,
    total: null,
    status: isEstorno ? "CANCELADA" : raw.entrada?.status || raw.saida?.status || "CONFIRMADA",
    origem: raw.origem,
    acao: raw.acao,
    documentKind,
    documentId,
    reconstruido: raw.reconstruido,
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
}) {
  const isEntrada = movement.direction === "entrada";
  const isEntradaFiscal =
    isEntrada &&
    movement.status === "CONFIRMADA" &&
    (Boolean(movement.fiscal) ||
      movement.origem === "ENTRADA" ||
      movement.documentKind === "entrada");

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
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium">{movement.description}</span>
              {movement.origem ? (
                <Badge
                  variant="outline"
                  className={`shrink-0 px-1.5 py-0 text-[10px] font-normal ${COR_ORIGEM[movement.origem]}`}
                >
                  {ROTULO_ORIGEM[movement.origem]}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:cursor-pointer">
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Ações</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onViewDetails(movement)} className="hover:cursor-pointer">
                <Eye className="mr-2 size-4 text-muted-foreground" />
                Visualizar
              </DropdownMenuItem>

              {isEntradaFiscal ? (
                <>
                  <DropdownMenuItem onClick={() => onLancarFinanceiro(movement)} className="hover:cursor-pointer">
                    <Wallet className="mr-2 size-4 text-emerald-600 dark:text-emerald-400" />
                    Lançar no Financeiro
                  </DropdownMenuItem>
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
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function MovementTable({
  products,
  useItems,
  loading,
  canCancel,
  canceling,
  onReload,
  onCancel,
  onViewDetails,
  onLancarFinanceiro,
  onBaixarNfe,
  onBaixarDanfe,
}: {
  products: Movement[];
  useItems: Movement[];
  loading: boolean;
  canCancel: (movement: Movement) => boolean;
  canceling: string | null;
  onReload: () => void;
  onCancel: (movement: Movement) => void;
  onViewDetails: (movement: Movement) => void;
  onLancarFinanceiro: (movement: Movement) => void;
  onBaixarNfe: (movement: Movement) => void;
  onBaixarDanfe: (movement: Movement) => void;
}) {
  const [inventory, setInventory] = useState<InventoryKind>("produtos");
  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("todos");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [origemFilter, setOrigemFilter] = useState<OrigemFilter>("todas");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftDirection, setDraftDirection] = useState<DirectionFilter>("todos");
  const [draftStatus, setDraftStatus] = useState<StatusFilter>("todos");
  const [draftOrigem, setDraftOrigem] = useState<OrigemFilter>("todas");
  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const sourceMovements = inventory === "produtos" ? products : useItems;
  const filteredMovements = useMemo(
    () =>
      sourceMovements.filter((movement) => {
        if (directionFilter !== "todos" && movement.direction !== directionFilter) return false;
        if (statusFilter !== "todos" && movement.status !== statusFilter) return false;
        if (origemFilter !== "todas" && movement.origem !== origemFilter) return false;

        const movementDate = new Date(movement.createdAt);
        if (dateFrom && movementDate < new Date(`${dateFrom}T00:00:00`)) return false;
        if (dateTo && movementDate > new Date(`${dateTo}T23:59:59.999`)) return false;

        if (!normalizedSearch) return true;
        return [movement.id, movement.description, movement.party, movement.items, movement.status]
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedSearch);
      }),
    [dateFrom, dateTo, directionFilter, normalizedSearch, origemFilter, sourceMovements, statusFilter],
  );
  const totalPages = Math.max(1, Math.ceil(filteredMovements.length / limit));
  const start = (page - 1) * limit;
  const pageMovements = filteredMovements.slice(start, start + limit);
  const showActions = filteredMovements.length > 0;
  const colSpan = showActions ? 6 : 5;
  const isEmpty = !loading && filteredMovements.length === 0;
  const activeFilterCount =
    Number(directionFilter !== "todos") +
    Number(statusFilter !== "todos") +
    Number(origemFilter !== "todas") +
    Number(Boolean(dateFrom)) +
    Number(Boolean(dateTo));

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, directionFilter, inventory, limit, normalizedSearch, origemFilter, statusFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  function changeInventory(value: string) {
    if (value !== "produtos" && value !== "uso-consumo") return;
    setInventory(value);
    if (value === "uso-consumo") setOrigemFilter("todas");
  }

  function changeSheetOpen(open: boolean) {
    if (open) {
      setDraftDirection(directionFilter);
      setDraftStatus(statusFilter);
      setDraftOrigem(origemFilter);
      setDraftDateFrom(dateFrom);
      setDraftDateTo(dateTo);
    }
    setSheetOpen(open);
  }

  function applyFilters() {
    setDirectionFilter(draftDirection);
    setStatusFilter(draftStatus);
    setOrigemFilter(draftOrigem);
    setDateFrom(draftDateFrom);
    setDateTo(draftDateTo);
    setSheetOpen(false);
  }

  function clearDraftFilters() {
    setDraftDirection("todos");
    setDraftStatus("todos");
    setDraftOrigem("todas");
    setDraftDateFrom("");
    setDraftDateTo("");
  }

  return (
    <Card className="bg-card">
      <CardHeader className="border-b-2 pb-4">
        <div className="relative flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 md:max-w-sm xl:max-w-md">
            <CardTitle>Histórico de estoque</CardTitle>
            <CardDescription className="flex flex-col items-start gap-1">
              <span>Todas as entradas e saídas, separadas entre produtos e itens de uso/consumo.</span>
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

          <div className="flex flex-1 items-center justify-center xl:absolute xl:left-1/2 xl:top-1/2 xl:-translate-x-1/2 xl:-translate-y-1/2">
            <Tabs value={inventory} onValueChange={changeInventory}>
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
                  Uso e consumo
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto md:items-center md:justify-end">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar no histórico..."
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

                <div className="grid flex-1 auto-rows-min gap-5 overflow-y-auto p-4">
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

                    {inventory === "produtos" ? (
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

                    <div className="flex justify-end gap-2 border-t pt-4">
                      <Button type="button" variant="outline" onClick={clearDraftFilters}>
                        Limpar
                      </Button>
                      <Button type="button" onClick={applyFilters}>
                        Aplicar filtros
                      </Button>
                    </div>
                  </div>
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
            {pageMovements.map((movement) => (
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

        {loading && filteredMovements.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            Carregando histórico...
          </div>
        ) : null}

        {!loading && filteredMovements.length > 0 ? (
          <div className="mt-4 grid min-h-9 grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-nowrap justify-self-center text-xs text-muted-foreground sm:justify-self-start">
              <span>{start + 1}</span> - <span>{Math.min(start + pageMovements.length, filteredMovements.length)}</span>
              <span className="ml-1 hidden sm:block">de {filteredMovements.length}</span>
            </div>

            <div className="flex items-center justify-center space-x-1 sm:space-x-3 sm:col-start-2 sm:row-start-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Primeira página"
                  disabled={page === 1}
                  onClick={() => setPage(1)}
                >
                  <ChevronsLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Página anterior"
                  disabled={page === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-20 text-center text-xs text-muted-foreground">
                  Pg. {page} de {totalPages}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  aria-label="Próxima página"
                  disabled={page === totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  aria-label="Última página"
                  disabled={page === totalPages}
                  onClick={() => setPage(totalPages)}
                >
                  <ChevronsRight className="size-4" />
                </Button>
            </div>

            <Select
              value={String(limit)}
              onValueChange={(value) => {
                setPage(1);
                setLimit(Number(value));
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
  );
}

export default function HistoricoEstoquePage() {
  const { data: session, status: sessionStatus } = useSession();
  const permissions = (session?.user as { permissoes?: unknown })?.permissoes;
  const canProducts = permissionSetHas(permissions, PERMS.ESTOQUE);
  const canUse = permissionSetHas(permissions, PERMS.USOCONSUMO);
  const canCancelUse = permissionSetHas(permissions, PERMS.USOCONSUMO_CANCELAR);
  const canCancelProducts = permissionSetHas(permissions, PERMS.ESTOQUE_EDITAR);

  const [products, setProducts] = useState<Movement[]>([]);
  const [useItems, setUseItems] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ movement: Movement; target: CancelTarget } | null>(null);
  const [entradaCancelamento, setEntradaCancelamento] = useState<
    { id: number; origem: "ESTOQUE" | "USOCONSUMO" } | null
  >(null);
  const [detalhesEntrada, setDetalhesEntrada] = useState<{
    id: number;
    inventory: "produto" | "usoconsumo";
  } | null>(null);
  const [lancarFinanceiroEntrada, setLancarFinanceiroEntrada] = useState<{
    id: number;
    inventory: "produto" | "usoconsumo";
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<void>[] = [];

      if (canProducts) {
        requests.push(
          axios
            .get("/api/estoque/movimentos", { params: { page: 1, limit: 200 } })
            .then((response) => {
              const linhas = (response.data.data ?? []) as RawLedgerMovement[];
              setProducts(linhas.map(normalizeLedgerMovement));
            }),
        );
      } else {
        setProducts([]);
      }

      if (canUse) {
        requests.push(
          Promise.all([
            axios.get("/api/usoconsumo/entradas", { params: { page: 1, limit: 100 } }),
            axios.get("/api/usoconsumo/saidas", { params: { page: 1, limit: 100 } }),
          ]).then(([entriesResponse, outputsResponse]) => {
            const entries = (entriesResponse.data.data ?? []) as RawMovement[];
            const outputs = (outputsResponse.data.data ?? []) as RawMovement[];
            setUseItems([
              ...entries.map((entry) => normalizeMovement(entry, "uso-consumo", "entrada")),
              ...outputs.map((output) => normalizeMovement(output, "uso-consumo", "saida")),
            ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
          }),
        );
      } else {
        setUseItems([]);
      }

      await Promise.all(requests);
    } catch (error) {
      toast.error("Histórico de estoque não carregado", { description: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [canProducts, canUse]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    void load();
  }, [load, sessionStatus]);

  function podeCancelar(movement: Movement) {
    if (movement.status !== "CONFIRMADA") return false;
    if (movement.inventory === "uso-consumo") return canCancelUse;
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
        movement.inventory === "uso-consumo"
          ? `/api/usoconsumo/${path}/${movement.id}/cancelar`
          : kind === "entrada"
            ? `/api/entradas/${documentId}/cancelar`
            : `/api/estoque/saidas/${documentId}/cancelar`;
      await axios.post(endpoint, { motivo });
      toast.success("Movimentação cancelada.");
      setCancelTarget(null);
      await load();
    } catch (error) {
      toast.error("Cancelamento não realizado", { description: errorText(error) });
    } finally {
      setCanceling(null);
    }
  }

  async function handleBaixarNfe(movement: Movement) {
    const docId = movement.documentId ?? movement.id;
    const inventory = movement.inventory === "uso-consumo" ? "usoconsumo" : "produto";
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
    const inventory = movement.inventory === "uso-consumo" ? "usoconsumo" : "produto";
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
        products={products}
        useItems={useItems}
        loading={loading}
        canCancel={podeCancelar}
        canceling={canceling}
        onReload={() => void load()}
        onViewDetails={(movement) => {
          const docId = movement.documentId ?? movement.id;
          setDetalhesEntrada({
            id: docId,
            inventory: movement.inventory === "uso-consumo" ? "usoconsumo" : "produto",
          });
        }}
        onLancarFinanceiro={(movement) => {
          const docId = movement.documentId ?? movement.id;
          setLancarFinanceiroEntrada({
            id: docId,
            inventory: movement.inventory === "uso-consumo" ? "usoconsumo" : "produto",
          });
        }}
        onBaixarNfe={handleBaixarNfe}
        onBaixarDanfe={handleBaixarDanfe}
        onCancel={(movement) => {
          const kind = movement.documentKind ?? movement.direction;
          const documentId = movement.documentId ?? movement.id;

          if (kind === "entrada") {
            setEntradaCancelamento({
              id: documentId,
              origem: movement.inventory === "uso-consumo" ? "USOCONSUMO" : "ESTOQUE",
            });
            return;
          }
          setCancelTarget({
            movement,
            target: {
              id: documentId,
              kind,
              inventory: movement.inventory === "uso-consumo" ? "usoconsumo" : "produto",
            },
          });
        }}
      />

      <EntryDetailsDialog
        open={detalhesEntrada !== null}
        onOpenChange={(open) => !open && setDetalhesEntrada(null)}
        entryId={detalhesEntrada?.id ?? null}
        inventory={detalhesEntrada?.inventory ?? "produto"}
      />

      <LancarFinanceiroEntradaDialog
        open={lancarFinanceiroEntrada !== null}
        onOpenChange={(open) => !open && setLancarFinanceiroEntrada(null)}
        entryId={lancarFinanceiroEntrada?.id ?? null}
        inventory={lancarFinanceiroEntrada?.inventory ?? "produto"}
        onSuccess={() => void load()}
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
