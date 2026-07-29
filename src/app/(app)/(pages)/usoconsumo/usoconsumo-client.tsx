"use client";

import axios, { isAxiosError } from "axios";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Box,
  ChevronDown,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  CircleOff,
  ClipboardCheck,
  Clock,
  Download,
  Edit,
  FileText,
  Loader,
  Loader2,
  MapPin,
  MoreHorizontal,
  PackageMinus,
  PackagePlus,
  Plus,
  Search,
  ShieldCheck,
  ShieldX,
  Tag,
  Trash2Icon,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/lib/toast";
import type {
  UsoConsumoGrupo,
  UsoConsumoItem,
  UsoConsumoPagination,
  UsoConsumoStatus,
} from "@/types/usoconsumo";
import { FiscalEntryDialog } from "./components/fiscal-entry-dialog";
import { ItemDialog } from "./components/item-dialog";
import { ManualEntryDialog } from "./components/manual-entry-dialog";
import { MovementDialog } from "./components/movement-dialog";

type Counts = Record<"TODOS" | UsoConsumoStatus, number>;
type StatusFilter = "TODOS" | UsoConsumoStatus;
type Option = {
  id: number;
  nome?: string;
  titulo?: string;
  codigo?: string;
  nomerazaosocial?: string;
  cpfcnpj?: string;
};
type Options = {
  fornecedores: Option[];
  bancos: Option[];
  categorias: Option[];
  planos: Option[];
  centros: Option[];
};

const EMPTY_OPTIONS: Options = {
  fornecedores: [],
  bancos: [],
  categorias: [],
  planos: [],
  centros: [],
};

function errorText(error: unknown) {
  return isAxiosError(error)
    ? error.response?.data?.error ?? error.message
    : "Erro inesperado.";
}

function statusBadge(status: UsoConsumoStatus) {
  if (status === "CRITICO") {
    return (
      <Badge variant="destructive" className="text-xs">
        <AlertTriangle className="mr-1 h-3 w-3" />
        Crítico
      </Badge>
    );
  }
  if (status === "BAIXO") {
    return (
      <Badge variant="secondary" className="bg-yellow-600 text-xs not-dark:text-white">
        <Clock className="mr-1 h-3 w-3" />
        Baixo
      </Badge>
    );
  }
  if (status === "SEM_ESTOQUE") {
    return (
      <Badge variant="secondary" className="bg-purple-800 text-xs not-dark:text-white">
        <CircleOff className="mr-1 h-3 w-3" />
        Sem Estoque
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-xs">OK</Badge>;
}

function StatusCards({ counts, loading }: { counts: Counts; loading: boolean }) {
  const cards = [
    { title: "Total de Itens", value: counts.TODOS, description: "Itens cadastrados", icon: Box, color: "" },
    { title: "Sem estoque", value: counts.SEM_ESTOQUE, description: "Estoque zerado", icon: CircleOff, color: "text-purple-600" },
    { title: "Itens Críticos", value: counts.CRITICO, description: "Reposição urgente", icon: AlertTriangle, color: "text-destructive" },
    { title: "Estoque Baixo", value: counts.BAIXO, description: "Atenção necessária", icon: TrendingDown, color: "text-orange-500" },
    { title: "Estoque Bom", value: counts.OK, description: "Saldo acima do mínimo", icon: TrendingUp, color: "" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <Card key={card.title} className={`gap-0 py-4 ${index === 4 ? "col-span-2 md:col-span-1" : ""}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <Icon className={`h-4 w-4 ${card.color || "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-8" /> : <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>}
              <p className="text-xs text-muted-foreground">{card.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function UsoConsumoClient() {
  const { data: session } = useSession();
  const permissions = (session?.user as { permissoes?: unknown })?.permissoes;
  const canCreate = permissionSetHas(permissions, PERMS.USOCONSUMO_CRIAR);
  const canEdit = permissionSetHas(permissions, PERMS.USOCONSUMO_EDITAR);
  const canDelete = permissionSetHas(permissions, PERMS.USOCONSUMO_EXCLUIR);
  const canEntry = permissionSetHas(permissions, PERMS.USOCONSUMO_ENTRADA);
  const canExit = permissionSetHas(permissions, PERMS.USOCONSUMO_SAIDA);

  const [items, setItems] = useState<UsoConsumoItem[]>([]);
  const [groups, setGroups] = useState<UsoConsumoGrupo[]>([]);
  const [options, setOptions] = useState<Options>(EMPTY_OPTIONS);
  const [counts, setCounts] = useState<Counts>({ TODOS: 0, OK: 0, BAIXO: 0, CRITICO: 0, SEM_ESTOQUE: 0 });
  const [pagination, setPagination] = useState<UsoConsumoPagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [groupId, setGroupId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [itemOpen, setItemOpen] = useState(false);
  const [editing, setEditing] = useState<UsoConsumoItem | null>(null);
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<UsoConsumoItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movement, setMovement] = useState<{
    item: UsoConsumoItem;
    type: "entrada" | "saida" | "inventario";
  } | null>(null);

  const loadGroups = useCallback(async () => {
    const { data } = await axios.get("/api/usoconsumo/grupos");
    setGroups(data.data ?? []);
  }, []);

  const loadOptions = useCallback(async () => {
    const { data } = await axios.get("/api/usoconsumo/opcoes");
    setOptions(data);
  }, []);

  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      const { data } = await axios.get("/api/usoconsumo/itens/status-counter");
      setCounts(data.data);
    } finally {
      setLoadingCounts(false);
    }
  }, []);

  const load = useCallback(async (page = 1, limit = pagination.limit) => {
    setLoading(true);
    try {
      const { data } = await axios.get("/api/usoconsumo/itens", {
        params: {
          page,
          limit,
          search: search || undefined,
          status: status === "TODOS" ? undefined : status,
          grupoId: groupId === "all" ? undefined : groupId,
        },
      });
      setItems(data.data ?? []);
      setPagination(data.pagination);
    } catch (error) {
      toast.error("Não foi possível carregar o estoque.", { description: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [groupId, pagination.limit, search, status]);

  const refresh = useCallback(async (page = pagination.page) => {
    await Promise.all([load(page), loadCounts()]);
  }, [load, loadCounts, pagination.page]);

  useEffect(() => {
    Promise.all([loadGroups(), loadOptions()]).catch((error) => {
      toast.error("Não foi possível carregar as opções.", { description: errorText(error) });
    });
  }, [loadGroups, loadOptions]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void load(1);
    void loadCounts();
  }, [groupId, search, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = useMemo(() => {
    if (!pagination.total) return { start: 0, end: 0 };
    const start = pagination.limit * (pagination.page - 1) + 1;
    return { start, end: Math.min(start + items.length - 1, pagination.total) };
  }, [items.length, pagination]);

  function createItem() {
    setEditing(null);
    setItemOpen(true);
  }

  function editItem(item: UsoConsumoItem) {
    if (!canEdit) return;
    setEditing(item);
    setItemOpen(true);
  }

  async function deactivate() {
    if (!deleteItem) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/usoconsumo/itens/${deleteItem.id}`);
      toast.success("Item inativado.");
      setDeleteItem(null);
      await refresh();
    } catch (error) {
      toast.error("Item não inativado.", { description: errorText(error) });
    } finally {
      setDeleting(false);
    }
  }

  function exportItems() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status !== "TODOS") params.set("status", status);
    if (groupId !== "all") params.set("grupoId", groupId);
    window.location.href = `/api/usoconsumo/itens/export?${params}`;
  }

  return (
    <div className="mx-auto space-y-6">
      <StatusCards counts={counts} loading={loadingCounts} />

      <Card>
        <CardContent>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <form
              className="relative flex-1"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(searchInput.trim());
              }}
            >
              <button type="submit" aria-label="Buscar itens" className="absolute left-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                <Search className="h-4 w-4" />
              </button>
              <Input
                placeholder="Busque por código, descrição, referência, título..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="pl-10 pr-10"
              />
              {searchInput ? (
                <button
                  type="button"
                  aria-label="Limpar busca"
                  className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => { setSearchInput(""); setSearch(""); }}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </form>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="w-full md:w-1/4"><SelectValue placeholder="Todos os grupos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os grupos</SelectItem>
                {groups.map((group) => <SelectItem key={group.id} value={String(group.id)}>{group.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <SelectTrigger className="w-full md:w-1/4"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos</SelectItem>
                <SelectItem value="OK">Ok</SelectItem>
                <SelectItem value="BAIXO">Estoque Baixo</SelectItem>
                <SelectItem value="CRITICO">Crítico</SelectItem>
                <SelectItem value="SEM_ESTOQUE">Sem Estoque</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b-2 pb-4">
          <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle>Lista de Itens</CardTitle>
              <CardDescription>
                <button onClick={() => void refresh()} className="inline-flex cursor-pointer items-center gap-1 text-foreground/50 hover:text-foreground/70">
                  <span>Recarregar</span>
                  <Loader2 width={12} className={loading ? "animate-spin" : ""} />
                </button>
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={exportItems} className="cursor-pointer">
                <Download className="mr-2 h-4 w-4" /> Exportar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="cursor-pointer">Ações <ChevronDown className="ml-1 h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  {canCreate ? <DropdownMenuItem onClick={createItem}><Plus className="mr-2 h-4 w-4" />Novo Item</DropdownMenuItem> : null}
                  {canEntry ? <DropdownMenuItem onClick={() => setManualOpen(true)}><PackagePlus className="mr-2 h-4 w-4" />Entrada</DropdownMenuItem> : null}
                  {canEntry ? <DropdownMenuItem onClick={() => setFiscalOpen(true)}><FileText className="mr-2 h-4 w-4" />Entrada Fiscal (NF-e)</DropdownMenuItem> : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative -mt-6 min-h-[300px] px-4 pb-4 pt-0">
          <div className={`${loading ? "opacity-100" : "opacity-0"} absolute left-0 right-0 top-0 h-0.5 overflow-hidden bg-slate-400 transition-all`}>
            <div className={`absolute left-0 h-full w-1/2 -translate-x-full rounded-lg bg-primary ${loading ? "animate-slideIn" : ""}`} />
          </div>

          <Table className="mt-6">
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Referência</TableHead>
                <TableHead>Fabricante</TableHead>
                <TableHead>Estoque</TableHead>
                <TableHead>Mín.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Custo Unit.</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && items.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="h-40 text-center text-muted-foreground">Nenhum item encontrado.</TableCell></TableRow>
              ) : items.map((item) => (
                <TableRow key={item.id} onDoubleClick={() => editItem(item)} className="cursor-pointer">
                  <TableCell>{item.id}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="max-w-[350px] truncate font-medium">{item.titulo}</p>
                          {item.conservacao === "NOVO" ? <Tooltip><TooltipTrigger asChild><BadgeCheck className="h-4 w-4 text-primary" /></TooltipTrigger><TooltipContent>Item novo</TooltipContent></Tooltip> : null}
                          {item.conservacao === "USADO" ? <Tooltip><TooltipTrigger asChild><ShieldX className="h-4 w-4 text-yellow-500" /></TooltipTrigger><TooltipContent>Item usado</TooltipContent></Tooltip> : null}
                          {item.conservacao === "RECONDICIONADO" ? <Tooltip><TooltipTrigger asChild><ShieldCheck className="h-4 w-4 text-green-500" /></TooltipTrigger><TooltipContent>Item recondicionado</TooltipContent></Tooltip> : null}
                        </div>
                        <div className="flex max-w-[350px] gap-1 truncate text-xs text-muted-foreground">
                          {item.etiqueta ? <span className="flex items-center font-semibold"><Tag className="mr-1 h-3 w-3" />{item.etiqueta}</span> : null}
                          {item.etiqueta ? <span>-</span> : null}
                          <span>{item.unidade}</span>
                          {item.grupo?.nome ? <span>• {item.grupo.nome}</span> : null}
                        </div>
                        {item.local ? <div className="mt-1 flex w-min items-center rounded-2xl bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground"><MapPin className="mr-0.5 h-3 w-3" />{item.local}</div> : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate font-mono text-xs">{item.referencia || "-"}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{item.fabricante || "-"}</TableCell>
                  <TableCell className="font-medium">{item.estoque}</TableCell>
                  <TableCell className="text-muted-foreground">{item.estoqueminimo}</TableCell>
                  <TableCell>{statusBadge(item.status_estoque)}</TableCell>
                  <TableCell>{Number(item.precocompra ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 cursor-pointer p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="center">
                        {canEdit ? <DropdownMenuItem onClick={() => editItem(item)}><Edit className="mr-2 h-4 w-4" />Editar</DropdownMenuItem> : null}
                        {canEntry ? <DropdownMenuItem onClick={() => setMovement({ item, type: "entrada" })}><PackagePlus className="mr-2 h-4 w-4" />Entrada</DropdownMenuItem> : null}
                        {canExit ? <DropdownMenuItem disabled={item.estoque <= 0} onClick={() => setMovement({ item, type: "saida" })}><PackageMinus className="mr-2 h-4 w-4" />Saída</DropdownMenuItem> : null}
                        {canEdit ? <DropdownMenuItem onClick={() => setMovement({ item, type: "inventario" })}><ClipboardCheck className="mr-2 h-4 w-4" />Inventário</DropdownMenuItem> : null}
                        {canDelete ? <DropdownMenuItem variant="destructive" onClick={() => setDeleteItem(item)}><Trash2Icon className="mr-2 h-4 w-4" />Excluir</DropdownMenuItem> : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex flex-nowrap text-xs text-muted-foreground">
              <span>{range.start}</span> - <span>{range.end}</span><span className="ml-1 hidden sm:block">de {pagination.total}</span>
              <Loader className={`h-full w-4 animate-spin opacity-0 transition-all ${loading ? "opacity-100" : ""}`} />
            </div>
            <div className="flex items-center justify-center space-x-1 sm:space-x-3">
              <Button variant="outline" size="sm" onClick={() => void load(1)} disabled={pagination.page === 1}><ChevronsLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" onClick={() => void load(pagination.page - 1)} disabled={pagination.page === 1}><ChevronLeftIcon className="h-4 w-4" /></Button>
              <span className="text-nowrap text-[10px] font-medium sm:text-xs">Pg. {pagination.page} de {pagination.totalPages || 1}</span>
              <Button variant="outline" size="sm" onClick={() => void load(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}><ChevronRightIcon className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" onClick={() => void load(pagination.totalPages)} disabled={pagination.page >= pagination.totalPages}><ChevronsRight className="h-4 w-4" /></Button>
            </div>
            <Select value={String(pagination.limit)} onValueChange={(value) => void load(1, Number(value))}>
              <SelectTrigger size="sm" className="ml-2 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{[20, 50, 100].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <ItemDialog
        open={itemOpen}
        item={editing}
        grupos={groups}
        onOpenChange={setItemOpen}
        onSaved={refresh}
        onGroupsChanged={loadGroups}
      />
      <MovementDialog
        item={movement?.item ?? null}
        type={movement?.type ?? null}
        onClose={() => setMovement(null)}
        onSaved={refresh}
      />
      <ManualEntryDialog open={manualOpen} onOpenChange={setManualOpen} fornecedores={options.fornecedores} onSaved={refresh} />
      <FiscalEntryDialog open={fiscalOpen} onOpenChange={setFiscalOpen} options={options} onSaved={refresh} />

      <AlertDialog open={Boolean(deleteItem)} onOpenChange={(open) => { if (!open && !deleting) setDeleteItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              O item será inativado. Para preservar o histórico, itens com saldo precisam ser zerados antes desta operação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(event) => { event.preventDefault(); void deactivate(); }}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
