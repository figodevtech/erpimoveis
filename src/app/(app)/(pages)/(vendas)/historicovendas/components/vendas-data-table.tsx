"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Clock,
  Trash2Icon,
  ChevronsRight,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronsLeft,
  Loader2,
  Loader,
  Check,
  CreditCard,
  AlertCircle,
  Package,
  MoreHorizontal,
  FileText,
  Pencil,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { Pagination, VendaCanal, VendaComItens, vendaStatus } from "../types";
import { formatDate } from "@/utils/formatDate";
import formatarEmReal from "@/utils/formatarEmReal";
import DeleteAlert from "./deleteAlert";
import { EmissaoNotaDialog } from "../../../ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog";
import { VendaDetailsDialog } from "./venda-detail-dialog";
import { PedidoOnlineDialog } from "./pedido-online-dialog";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { useConfig } from "../../../config-context";
import { PaymentListFilters, PaymentsFilterSheet } from "../../../(financeiro)/components/payments-filter-sheet";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

interface VendasDataTableProps {
  vendas: VendaComItens[];
  isLoading: boolean;
  pagination: Pagination;
  search: string;
  filters: PaymentListFilters;
  setFilters: (value: PaymentListFilters) => void;
  handleGetVendas: (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
    status?: vendaStatus | "TODOS",
    filters?: PaymentListFilters,
  ) => void;
  fetchStatusCounts: () => void;
  status: vendaStatus | "TODOS";

  // âœ… para ediÃ§Ã£o via duplo clique (controlado no pai)
  selectedVendaId?: number | undefined;
  setSelectedVendaId?: (value: number | undefined) => void;
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
}

type ApprovalPaymentMethod = "CREDITO" | "DEBITO" | "DINHEIRO" | "PIX" | "NAO_INFORMAR";

const getStatusBadge = (status: vendaStatus) => {
  if (status === "ORCAMENTO") {
    return (
      <Badge variant="secondary" className="text-xs bg-violet-600 not-dark:text-white">
        <FileText className="h-3 w-3 mr-1" />
        ORÇAMENTO
      </Badge>
    );
  }

  if (status === "ABERTA") {
    return (
      <Badge variant="secondary" className="text-xs bg-primary">
        <Clock className="h-3 w-3 mr-1" />
        ABERTA
      </Badge>
    );
  }

  if (status === "PAGAMENTO" || status === "PENDENTE" || status === "AUTORIZADO") {
    return (
      <Badge variant="secondary" className="text-xs bg-yellow-600 not-dark:text-white">
        <CreditCard className="h-3 w-3 mr-1" />
        {status}
      </Badge>
    );
  }

  if (status === "PAGO") {
    return (
      <Badge variant="secondary" className="text-xs bg-emerald-600 not-dark:text-white">
        <Check className="h-3 w-3 mr-1" />
        PAGO
      </Badge>
    );
  }

  if (status === "FINALIZADA") {
    return (
      <Badge variant="secondary" className="text-xs bg-gray-800 not-dark:text-white">
        <Check className="h-3 w-3 mr-1" />
        FINALIZADA
      </Badge>
    );
  }

  if (status === "CANCELADA" || status === "CANCELADO") {
    return (
      <Badge variant="secondary" className="text-xs bg-red-600 not-dark:text-white">
        <AlertCircle className="h-3 w-3 mr-1" />
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      OK
    </Badge>
  );
};

const getCanalBadge = (canal: VendaCanal | string | null | undefined) => {
  const c = String(canal || "").toUpperCase();
  if (c === "MERCADO_LIVRE") {
    return (
      <Badge variant="secondary" className="text-xs bg-yellow-500 text-slate-950">
        MERCADO LIVRE
      </Badge>
    );
  }
  if (c === "SHOPEE") {
    return (
      <Badge variant="secondary" className="text-xs bg-orange-600 not-dark:text-white">
        SHOPEE
      </Badge>
    );
  }
  if (c === "ONLINE") {
    return (
      <Badge variant="secondary" className="text-xs bg-sky-600 not-dark:text-white">
        MARKETPLACE
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs bg-emerald-600 not-dark:text-white">
      PDV
    </Badge>
  );
};

const getEntregaBadge = (canal: VendaCanal | string | null | undefined, statusEntrega?: string | null) => {
  const c = String(canal || "").toUpperCase();
  if (c !== "ONLINE" && c !== "MERCADO_LIVRE" && c !== "SHOPEE") {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  const s = String(statusEntrega || "").toUpperCase();
  if (!s) {
    return (
      <Badge variant="outline" className="text-xs">
        NAO INICIADA
      </Badge>
    );
  }

  if (s === "SEPARACAO") {
    return (
      <Badge variant="secondary" className="text-xs bg-sky-600 not-dark:text-white">
        SEPARACAO
      </Badge>
    );
  }

  if (s === "ENVIO") {
    return (
      <Badge variant="secondary" className="text-xs bg-indigo-600 not-dark:text-white">
        ENVIO
      </Badge>
    );
  }

  if (s === "ENTREGUE") {
    return (
      <Badge variant="secondary" className="text-xs bg-emerald-600 not-dark:text-white">
        ENTREGUE
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-xs">
      {s}
    </Badge>
  );
};

export default function VendasDataTable({
  isLoading,
  vendas,
  pagination,
  search,
  filters,
  setFilters,
  handleGetVendas,
  fetchStatusCounts,
  status,
}: VendasDataTableProps) {
  const { data: session } = useSession();
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [openEmissao, setOpenEmissao] = useState(false);
  const [emissaoId, setEmissaoId] = useState<number | null>(null);
  const [selectedVendaId, setSelectedVendaId] = useState<number | null>(null);
  const [openDetails, setOpenDetails] = useState(false);
  const [openOnline, setOpenOnline] = useState(false);
  const [onlineVendaId, setOnlineVendaId] = useState<number | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveVendaId, setApproveVendaId] = useState<number | null>(null);
  const [approvalPaymentMethod, setApprovalPaymentMethod] = useState<ApprovalPaymentMethod>("NAO_INFORMAR");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [syncingMercadoLivre, setSyncingMercadoLivre] = useState(false);
  const config = useConfig();
  const canEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.VENDAS_EDITAR);
  const canDelete = permissionSetHas((session?.user as any)?.permissoes, PERMS.VENDAS_EXCLUIR);
  const hasActiveFilters = Boolean(
    filters.cliente.trim() || filters.notaNumero.trim() || filters.dataInicio || filters.dataFim,
  );

  const handleDeleteVenda = async (id: number) => {
    if (!canDelete) return;
    toast(
      <div className="flex flex-row items-center flex-nowrap gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Deletando venda</span>
      </div>,
    );
    try {
      const response = await axios.delete(`/api/venda/${id}`);
      if (response.status === 200) {
        toast.success("Venda deletada");
      }
    } catch (error) {
      if (isAxiosError(error)) {
        console.log(error);
        toast.error(error.status + " Erro ao deletar venda", {
          description: error.response?.data?.error,
          duration: 5000,
        });
      }
    }
  };

  const handleApproveBudget = async () => {
    if (!canEdit) return;
    if (!approveVendaId) return;

    toast(
      <div className="flex flex-row items-center flex-nowrap gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Aprovando orçamento</span>
      </div>,
    );

    try {
      const response = await axios.patch(`/api/venda/${approveVendaId}`, {
        status: "PAGAMENTO",
        formaPagamento: approvalPaymentMethod === "NAO_INFORMAR" ? null : approvalPaymentMethod,
      });

      if (response.status === 200) {
        toast.success("Orçamento aprovado com sucesso.");
        setApproveDialogOpen(false);
        setApproveVendaId(null);
        setApprovalPaymentMethod("NAO_INFORMAR");
        handleGetVendas(pagination.page, pagination.limit, search, status, filters);
        fetchStatusCounts();
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao aprovar orçamento", {
          description: error.response?.data?.error || "Tente novamente.",
        });
      } else {
        toast.error("Erro ao aprovar orçamento");
      }
    }
  };

  const handleSyncMercadoLivre = async () => {
    if (!canEdit) return;

    setSyncingMercadoLivre(true);
    try {
      const response = await axios.post("/api/integracoes/mercadolivre/sync-orders", {
        days: 15,
        limit: 50,
      });

      const created = Number(response.data?.created ?? 0);
      toast.success(created > 0 ? `${created} venda(s) importada(s) do Mercado Livre.` : "Nenhuma venda nova no Mercado Livre.");
      handleGetVendas(1, pagination.limit, search, status, filters);
      fetchStatusCounts();
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao sincronizar Mercado Livre", {
          description: error.response?.data?.error || "Tente novamente.",
        });
      } else {
        toast.error("Erro ao sincronizar Mercado Livre");
      }
    } finally {
      setSyncingMercadoLivre(false);
    }
  };
  return (
    <Card>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Lista de Vendas</CardTitle>
            <CardDescription>
              <button
                onClick={() => {
                  handleGetVendas(pagination.page, pagination.limit, search, status, filters);
                  fetchStatusCounts();
                }}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="bg-transparent hover:cursor-pointer"
                onClick={handleSyncMercadoLivre}
                disabled={syncingMercadoLivre}
              >
                {syncingMercadoLivre ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Package className="h-4 w-4" />
                )}
                Mercado Livre
              </Button>
            )}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="hover:cursor-pointer"
                onClick={() => {
                  const cleared = { cliente: "", notaNumero: "" };
                  setFilters(cleared);
                  handleGetVendas(1, pagination.limit, search, status, cleared);
                }}
              >
                Limpar filtros
              </Button>
            )}
            <PaymentsFilterSheet
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
              filters={filters}
              onFiltersChange={setFilters}
              onAplicar={() => handleGetVendas(1, pagination.limit, search, status, filters)}
              onLimpar={() => {
                const cleared = { cliente: "", notaNumero: "" };
                setFilters(cleared);
                handleGetVendas(1, pagination.limit, search, status, cleared);
              }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative">
        <div
          className={`${
            isLoading && " opacity-100"
          } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full  absolute left-0 rounded-lg  -translate-x-[100%] ${
              isLoading && "animate-slideIn "
            } `}
          ></div>
        </div>

        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-center">Canal</TableHead>
              <TableHead>Valor Total</TableHead>
              <TableHead className="text-center">Pagamento</TableHead>
              <TableHead className="text-center">Entrega</TableHead>

              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {vendas.map((p) => {
              return (
                <TableRow
                  onDoubleClick={() => {
                    setSelectedVendaId(p.id);
                    setOpenDetails(true);
                  }}
                  key={p.id}
                  className="hover:cursor-pointer"
                >
                  <TableCell>{p.id}</TableCell>
                  <TableCell>{p.cliente.nomerazaosocial}</TableCell>

                  <TableCell className="font-mono text-xs">{formatDate(p.datavenda)}</TableCell>
                  <TableCell className="text-center">{getCanalBadge((p as any).canal)}</TableCell>
                  <TableCell>{formatarEmReal(p.valortotal)}</TableCell>
                  <TableCell className="text-center">{getStatusBadge(p.status)}</TableCell>
                  <TableCell className="text-center">
                    {getEntregaBadge((p as any).canal, (p as any).status_entrega)}
                  </TableCell>

                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="space-y-1">
                        {config?.habilitar_emissao_nfe &&
                          config?.emissao_nf_no_modulo_vendas &&
                          (config?.emissao_nf_vendas_nao_pagas
                            ? p.status === "FINALIZADA" || p.status === "PAGO" || p.status === "PAGAMENTO"
                            : p.status === "FINALIZADA") && (
                            <DropdownMenuItem
                              onClick={() => {
                                setEmissaoId(p.id);
                                setOpenEmissao(true);
                              }}
                            >
                              <CreditCard className=" h-4 w-4" />
                              Emissão de NF-e
                            </DropdownMenuItem>
                          )}
                        {canEdit ? (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedVendaId(p.id);
                              setOpenDetails(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                        ) : null}

                        {canEdit && p.status === "ORCAMENTO" && (
                          <DropdownMenuItem
                            onClick={() => {
                              setApproveVendaId(p.id);
                              setApprovalPaymentMethod("NAO_INFORMAR");
                              setApproveDialogOpen(true);
                            }}
                          >
                            <Check className="h-4 w-4" />
                            Aprovar orçamento
                          </DropdownMenuItem>
                        )}

                        <DropdownMenuItem onClick={() => window.open(`/print/venda/${p.id}/orcamento`, "_blank")}>
                          <FileText className="h-4 w-4" />
                          Imprimir venda
                        </DropdownMenuItem>

                        {canEdit && isMarketplaceCanal((p as any).canal) && (
                          <DropdownMenuItem
                            onClick={() => {
                              setOnlineVendaId(p.id);
                              setOpenOnline(true);
                            }}
                          >
                            <Package className="h-4 w-4" />
                            Pedido marketplace
                          </DropdownMenuItem>
                        )}

                        {canDelete ? (
                          <DeleteAlert
                            onDelete={() => handleDeleteVenda(p.id)}
                            isAlertOpen={isAlertOpen}
                            setIsAlertOpen={setIsAlertOpen}
                          >
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} variant="destructive">
                              <Trash2Icon className="h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DeleteAlert>
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
          <div className="text-xs text-muted-foreground flex flex-nowrap">
            <span>{pagination.limit * (pagination.page - 1) + 1}</span> -{" "}
            <span>{pagination.limit * (pagination.page - 1) + (pagination.pageCount || 0)}</span>
            <span className="ml-1 hidden sm:block">de {pagination.total}</span>
            <Loader className={`w-4 h-full animate-spin transition-all opacity-0 ${isLoading && "opacity-100"}`} />
          </div>

          <div className="flex items-center justify-center space-x-1 sm:space-x-3">
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => handleGetVendas(1, pagination.limit, search, status, filters)}
              disabled={pagination.page === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => handleGetVendas(pagination.page - 1, pagination.limit, search, status, filters)}
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
              onClick={() => handleGetVendas(pagination.page + 1, pagination.limit, search, status, filters)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              className="hover:cursor-pointer"
              variant="outline"
              size="sm"
              onClick={() => handleGetVendas(pagination.totalPages, pagination.limit, search, status, filters)}
              disabled={pagination.page === pagination.totalPages || pagination.totalPages === 0}
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

        <EmissaoNotaDialog onOpenChange={setOpenEmissao} open={openEmissao} vendaId={emissaoId} />
      </CardContent>
      <VendaDetailsDialog vendaId={selectedVendaId} onOpenChange={setOpenDetails} open={openDetails} />
      <PedidoOnlineDialog
        vendaId={onlineVendaId}
        open={openOnline}
        onOpenChange={setOpenOnline}
        onSaved={() => {
          handleGetVendas(pagination.page, pagination.limit, search, status);
          fetchStatusCounts();
        }}
      />
      <AlertDialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar orçamento</AlertDialogTitle>
            <AlertDialogDescription>Ao aprovar, a venda passará para o status de pagamento.</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">Método de pagamento</span>
            <Select
              value={approvalPaymentMethod}
              onValueChange={(value) => setApprovalPaymentMethod(value as ApprovalPaymentMethod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o método de pagamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NAO_INFORMAR">Não informar</SelectItem>
                <SelectItem value="CREDITO">Crédito</SelectItem>
                <SelectItem value="DEBITO">Débito</SelectItem>
                <SelectItem value="DINHEIRO">Dinheiro</SelectItem>
                <SelectItem value="PIX">Pix</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setApproveVendaId(null);
                setApprovalPaymentMethod("NAO_INFORMAR");
              }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handleApproveBudget()}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function isMarketplaceCanal(canal: unknown) {
  const value = String(canal ?? "").toUpperCase();
  return value === "ONLINE" || value === "MERCADO_LIVRE" || value === "SHOPEE";
}
