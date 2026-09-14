"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Clock,
  ChevronDown,
  Trash2Icon,
  ChevronsRight,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronsLeft,
  Loader2,
  Edit,
  Loader,
  CircleOff,
  Store,
  Plus,
  FileText,
  MoreHorizontal,
  PackagePlus,
  PackageMinus,
  BadgeCheck,
  ShieldCheck,
  ShieldX,
  MapPin,
  Tag,
  Handshake,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { Estoque_status, Pagination, Produto, ProductListFilters } from "../types";
import { DialogProduto } from "./dialog-produto/dialog-produto";
import AlertaExcluir from "./alerta-excluir";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { BotaoExportarProdutos } from "./botao-exportar-produtos";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

import EntradaDialog from "./dialog-entrada/dialog-entrada-unica";
import SaidaDialog from "./dialog-saida/dialog-saida-unica";
import { EntradaFiscalDialog } from "@/components/entrada-fiscal/entrada-fiscal-dialog";
import { DialogEntradaGeral } from "./dialog-entrada-geral/dialog-entrada-geral";
import { ProdutoFiltrosSheet } from "./produto-filtros-sheet";

interface TabelaProdutosProps {
  isLoading: boolean;
  products: Produto[];
  pagination: Pagination;
  search: string;
  handleGetProducts: (
    pageNumber?: number,
    limit?: number,
    search?: string,
    status?: Estoque_status,
    filters?: ProductListFilters,
  ) => void;
  fetchStatusCounts: () => void;
  status: Estoque_status;
  filters: ProductListFilters;
  setFilters: (filters: ProductListFilters) => void;

  selectedProductId?: number | undefined;
  setSelectedProductId?: (value: number | undefined) => void;
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
}

const getStatusBadge = (status: Estoque_status | undefined) => {
  if (!status) return null;

  if (status === "CRITICO") {
    return (
      <Badge variant="destructive" className="text-xs">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Crítico
      </Badge>
    );
  }
  if (status === "BAIXO") {
    return (
      <Badge
        variant="secondary"
        className="text-xs bg-yellow-600 not-dark:text-white"
      >
        <Clock className="h-3 w-3 mr-1" />
        Baixo
      </Badge>
    );
  }
  if (status === "SEM_ESTOQUE") {
    return (
      <Badge
        variant="secondary"
        className="text-xs bg-purple-800 not-dark:text-white"
      >
        <CircleOff className="h-3 w-3 mr-1" />
        Sem Estoque
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      OK
    </Badge>
  );
};

export default function TabelaProdutos({
  isLoading,
  products,
  pagination,
  search,
  handleGetProducts,
  fetchStatusCounts,
  status,
  filters,
  setFilters,
  selectedProductId,
  setSelectedProductId,
  isOpen,
  setIsOpen,
}: TabelaProdutosProps) {
  const { data: session } = useSession();
  const [isDeleting, setIsDeleting] = useState(false);
  const canCreate = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.ESTOQUE_CRIAR,
  );
  const canEdit = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.ESTOQUE_EDITAR,
  );
  const canDelete = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.ESTOQUE_EXCLUIR,
  );

  // ✅ Dialogs controlados por estado
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const [entradaOpen, setEntradaOpen] = useState(false);
  const [entradaProduto, setEntradaProduto] = useState<{
    id: number;
    titulo: string;
    estoque: number;
  } | null>(null);
  const [saidaOpen, setSaidaOpen] = useState(false);
  const [saidaProduto, setSaidaProduto] = useState<{
    id: number;
    titulo: string;
    estoque: number;
  } | null>(null);

  const [entradaFiscalOpen, setEntradaFiscalOpen] = useState(false);
  const [entradaGeralOpen, setEntradaGeralOpen] = useState(false);
  const filteredHandleGetProducts = (
    pageNumber?: number,
    limit?: number,
    searchValue?: string,
    statusValue?: Estoque_status,
  ) => handleGetProducts(pageNumber, limit, searchValue, statusValue, filters);

  const abrirNovoProduto = () => {
    if (!canCreate) return;
    setSelectedProductId?.(undefined);
    setIsOpen(true);
  };

  // ✅ aceita id opcional e faz guard (remove erro TS)
  const abrirEdicaoProduto = (id?: number) => {
    if (!canEdit) return;
    if (!id) {
      toast.error("Produto sem ID válido para editar.");
      return;
    }
    setSelectedProductId?.(id);
    setIsOpen(true);
  };

  // ✅ guard do id
  const abrirEntrada = (p: Produto) => {
    if (!canCreate) return;
    if (!p.id) {
      toast.error("Produto sem ID válido para entrada.");
      return;
    }
    setEntradaProduto({
      id: p.id,
      titulo: p.titulo || "",
      estoque: p.estoque ?? 0,
    });
    setEntradaOpen(true);
  };

  const abrirSaida = (p: Produto) => {
    if (!canEdit) return;
    if (!p.id) {
      toast.error("Produto sem ID válido para saída.");
      return;
    }
    setSaidaProduto({
      id: p.id,
      titulo: p.titulo || "",
      estoque: p.estoque ?? 0,
    });
    setSaidaOpen(true);
  };

  // ✅ aceita id opcional e faz guard
  const abrirExcluir = (id?: number) => {
    if (!canDelete) return;
    if (!id) {
      toast.error("Produto sem ID válido para excluir.");
      return;
    }
    setDeleteId(id);
    setDeleteOpen(true);
  };

  const handleDeleteProduct = async (id: number) => {
    setIsDeleting(true);
    toast(
      <div className="flex gap-2 items-center flex-nowrap">
        <Loader className=" animate-spin w-4" />
        <span className="text-nowrap">Excluindo produto...</span>
      </div>,
    );

    try {
      const response = await axios.delete(`/api/products/${id}`, {});
      if (response.status === 204) {
        toast.success("Produto excluído!");
        handleGetProducts(pagination.page, pagination.limit, search, status, filters);
        fetchStatusCounts();
      } else {
        toast.warning(`Status inesperado: ${response.status}`);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Não foi possível excluir o produto", {
          description: error.response?.data?.error ?? "Tente novamente.",
        });
      }
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
      setDeleteId(null);
    }
  };

  const rangeText = useMemo(() => {
    const start = pagination.limit * (pagination.page - 1) + 1;
    const end =
      pagination.limit * (pagination.page - 1) + (pagination.pageCount || 0);
    return { start, end };
  }, [pagination]);

  return (
    <Card>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle>Lista de Produtos</CardTitle>
            <CardDescription>
              <button
                onClick={() => {
                  handleGetProducts(
                    pagination.page,
                    pagination.limit,
                    search,
                    status,
                    filters,
                  );
                  fetchStatusCounts();
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

          <div className="flex flex-wrap items-center gap-2">
            <ProdutoFiltrosSheet filters={filters} onApply={setFilters} />
            <BotaoExportarProdutos />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={"outline"} className="hover:cursor-pointer">
                  Ações <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>

              {/* ✅ DropdownMenuItem no lugar de Button */}
              <DropdownMenuContent align="center">
                {canCreate ? (
                  <DropdownMenuItem
                    onClick={abrirNovoProduto}
                    className="cursor-pointer"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Novo Produto
                  </DropdownMenuItem>
                ) : null}

                {canCreate ? (
                  <DropdownMenuItem
                    onClick={() => setEntradaGeralOpen(true)}
                    className="cursor-pointer"
                  >
                    <PackagePlus className="mr-2 h-4 w-4" />
                    Entrada
                  </DropdownMenuItem>
                ) : null}
                {canCreate ? (
                  <DropdownMenuItem
                    onClick={() => setEntradaFiscalOpen(true)}
                    className="cursor-pointer"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Entrada Fiscal (NF-e)
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ✅ 1 ÚNICO dialog de produto */}
        <DialogProduto
          setSelectedProductId={setSelectedProductId}
          productId={selectedProductId}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          onAfterSaveProduct={() =>
            handleGetProducts(pagination.page, pagination.limit, search, status, filters)
          }
        />

        {/* ✅ Entrada Fiscal (1 instância) */}
        <EntradaFiscalDialog
          open={entradaFiscalOpen}
          onOpenChange={setEntradaFiscalOpen}
          onSaved={() => filteredHandleGetProducts(pagination.page, pagination.limit, search, status)}
        />
        <DialogEntradaGeral
          open={entradaGeralOpen}
          onOpenChange={setEntradaGeralOpen}
          onSaved={async () => {
            await Promise.all([
              handleGetProducts(
                pagination.page,
                pagination.limit,
                search,
                status,
                filters,
              ),
              fetchStatusCounts(),
            ]);
          }}
        />
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        <div
          className={`${
            isLoading && " opacity-100"
          } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading && "animate-slideIn "
            }`}
          />
        </div>

        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Referência</TableHead>
              <TableHead>Fabricante</TableHead>
              <TableHead>Estoque</TableHead>
              <TableHead>Mín.</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Preço Unit.</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {products.map((p, idx) => {
              const id = typeof p.id === "number" ? p.id : undefined;
              const canAct = !!id;

              return (
                <TableRow
                  key={id ?? `row-${idx}`}
                  onDoubleClick={() => canEdit && abrirEdicaoProduto(id)}
                  className="hover:cursor-pointer"
                >
                  <TableCell>{id}</TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="flex flex-row gap-2 items-center">
                          <p className="font-medium max-w-[350px] truncate">
                            {p.titulo || "-"}
                          </p>
                          {p.exibirPdv && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Store className="w-4 h-4 text-primary/80 not-dark:text-primary" />
                              </TooltipTrigger>
                              <TooltipContent>
                                Exibindo no Marketplace
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {p.conservacao && p.conservacao === "NOVO" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <BadgeCheck className="w-4 h-4 text-primary" />
                              </TooltipTrigger>
                              <TooltipContent>Produto Novo</TooltipContent>
                            </Tooltip>
                          )}
                          {p.conservacao && p.conservacao === "USADO" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <ShieldX className="w-4 h-4 text-yellow-500" />
                              </TooltipTrigger>
                              <TooltipContent>Produto Usado</TooltipContent>
                            </Tooltip>
                          )}
                          {p.conservacao &&
                            p.conservacao === "RECONDICIONADO" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <ShieldCheck className="w-4 h-4 text-green-500" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  Produto Recondicionado
                                </TooltipContent>
                              </Tooltip>
                            )}
                          {(p.temAnuncioMercadoLivre || p.mercadolivre) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Handshake className="w-4 h-4 text-amber-500 shrink-0 hover:text-amber-600 transition-colors" />
                              </TooltipTrigger>
                              <TooltipContent>
                                {p.mercadolivre?.ml_item_id
                                  ? `Anunciado no Mercado Livre (${p.mercadolivre.ml_item_id})`
                                  : "Anunciado no Mercado Livre"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-row gap-1 max-w-[350px] truncate">
                          {p.etiqueta && (
                            <div className="flex flex-row items-center justify-center w-min font-semibold">
                              <Tag className="w-3 h-3 mr-1" />
                              {p.etiqueta}
                            </div>
                          )}
                          {p.etiqueta && p.unidade && <span>-</span>}
                          {p.unidade}
                          {p.fabricante && ` • ${p.fabricante}`}
                        </div>
                        {/* {p.codigobarras && (
                          <p className="text-xs text-muted-foreground">
                            CODIGOBARRAS: {p.codigobarras || "-"}
                          </p>
                        )} */}
                        {p.local && (
                          <div className="mt-1 rounded-2xl w-min py-0.5 px-1.5 text-[10px] flex items-center justify-center bg-primary text-primary-foreground">
                            <MapPin className="w-3 h-3 mr-0.5" />
                            {p.local || "-"}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="font-mono text-xs max-w-[300px] truncate">
                    {p.referencia || "-"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {p.fabricante || "-"}
                  </TableCell>

                  <TableCell className="font-medium">
                    {p.estoque ?? 0}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.estoqueminimo ?? 0}
                  </TableCell>

                  <TableCell>{getStatusBadge(p.status_estoque)}</TableCell>

                  <TableCell>
                    R{"$ "}
                    {p.precovenda?.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0 cursor-pointer"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>

                      {/* ✅ DropdownMenuItem no lugar de Button */}
                      <DropdownMenuContent align="center">
                        {canCreate ? (
                          <DropdownMenuItem
                            disabled={!canAct}
                            onClick={() => abrirEdicaoProduto(id)}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                        ) : null}

                        {/* Imprimir é leitura: quem enxerga a lista pode gerar
                            a etiqueta, sem exigir permissão de edição. */}
                        <DropdownMenuItem
                          disabled={!canAct || !p.etiqueta?.trim()}
                          onClick={() =>
                            window.open(`/print/produto/${id}/etiqueta`, "_blank")
                          }
                        >
                          <Tag className="mr-2 h-4 w-4" />
                          Etiqueta
                          {canAct && !p.etiqueta?.trim() ? (
                            // Item desabilitado em menu não comporta tooltip:
                            // o motivo vem escrito ao lado.
                            <span className="ml-auto pl-2 text-[10px] text-muted-foreground">
                              sem etiqueta
                            </span>
                          ) : null}
                        </DropdownMenuItem>

                        {canEdit ? (
                          <DropdownMenuItem
                            disabled={!canAct}
                            onClick={() => abrirEntrada(p)}
                          >
                            <PackagePlus className="mr-2 h-4 w-4" />
                            Entrada
                          </DropdownMenuItem>
                        ) : null}

                        {canEdit ? (
                          <DropdownMenuItem
                            disabled={!canAct || (p.estoque ?? 0) <= 0}
                            onClick={() => abrirSaida(p)}
                          >
                            <PackageMinus className="mr-2 h-4 w-4" />
                            Saída
                          </DropdownMenuItem>
                        ) : null}

                        {canDelete ? (
                          <DropdownMenuItem
                            disabled={!canAct || isDeleting}
                            onClick={() => abrirExcluir(id)}
                            variant="destructive"
                          >
                            <Trash2Icon className="mr-2 h-4 w-4" />
                            Excluir
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Rodapé */}
        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground flex flex-nowrap">
            <span>{rangeText.start}</span> - <span>{rangeText.end}</span>
            <span className="ml-1 hidden sm:block">de {pagination.total}</span>
            <Loader
              className={`w-4 h-full animate-spin transition-all opacity-0 ${isLoading && "opacity-100"}`}
            />
          </div>

          <div className="flex items-center justify-center space-x-1 sm:space-x-3">
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() =>
                handleGetProducts(1, pagination.limit, search, status, filters)
              }
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() =>
                handleGetProducts(
                  pagination.page - 1,
                  pagination.limit,
                  search,
                  status,
                  filters,
                )
              }
              disabled={pagination.page === 1}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="text-[10px] sm:text-xs font-medium text-nowrap">
              Pg. {pagination.page} de {pagination.totalPages || 1}
            </span>
            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="sm"
              onClick={() =>
                handleGetProducts(
                  pagination.page + 1,
                  pagination.limit,
                  search,
                  status,
                  filters,
                )
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
              size="sm"
              onClick={() =>
                handleGetProducts(
                  pagination.totalPages,
                  pagination.limit,
                  search,
                  status,
                  filters,
                )
              }
              disabled={
                pagination.page === pagination.totalPages ||
                pagination.totalPages === 0
              }
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <div>
            <Select>
              <SelectTrigger size="sm" className="hover:cursor-pointer ml-2">
                <SelectValue placeholder={pagination.limit}></SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="hover:cursor-pointer" value="20">
                  {pagination.limit}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ✅ 1 ÚNICO dialog de Entrada */}
        {entradaProduto && (
          <EntradaDialog
            handleGetProducts={filteredHandleGetProducts}
            status={status}
            search={search}
            isOpen={entradaOpen}
            setIsOpen={(v) => {
              setEntradaOpen(v);
              if (!v) setEntradaProduto(null);
            }}
            currentQuantity={entradaProduto.estoque}
            productDescription={entradaProduto.titulo}
            productId={entradaProduto.id}
          />
        )}

        {saidaProduto && (
          <SaidaDialog
            isOpen={saidaOpen}
            setIsOpen={(value) => {
              setSaidaOpen(value);
              if (!value) setSaidaProduto(null);
            }}
            productId={saidaProduto.id}
            productDescription={saidaProduto.titulo}
            currentQuantity={saidaProduto.estoque}
            onSuccess={async () => {
              filteredHandleGetProducts(pagination.page, pagination.limit, search, status);
              fetchStatusCounts();
            }}
          />
        )}

        {/* ✅ 1 ÚNICO dialog de Delete */}
        {deleteId != null && (
          <AlertaExcluir
            handleDeleteProduct={handleDeleteProduct}
            isAlertOpen={deleteOpen}
            setIsAlertOpen={(v) => {
              setDeleteOpen(v);
              if (!v) setDeleteId(null);
            }}
            idToDelete={deleteId}
          />
        )}
      </CardContent>
    </Card>
  );
}
