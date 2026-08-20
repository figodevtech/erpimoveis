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
  UserRound,
  Search,
  Ban,
  Undo2,
  Send,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { VendaLinkAprovacaoDialog } from "./venda-link-aprovacao-dialog";
import { PedidoOnlineDialog } from "./pedido-online-dialog";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { useConfig } from "../../../config-context";
import { PaymentListFilters, PaymentsFilterSheet } from "../../../(financeiro)/components/payments-filter-sheet";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import {
  dadosParaFinanceiroDaVenda,
  dadosParaFinanceiroVazios,
  montarFormaPagamento,
  montarPagamentosPrevistos,
  validarDadosParaFinanceiro,
  type DadosParaFinanceiro,
} from "@/components/financeiro/dados-para-financeiro";
import { VendaConfirmacaoFields } from "@/components/vendas/venda-confirmacao-fields";

interface VendasDataTableProps {
  vendas: VendaComItens[];
  isLoading: boolean;
  pagination: Pagination;
  search: string;
  setSearch: (value: string) => void;
  filters: PaymentListFilters;
  setFilters: (value: PaymentListFilters) => void;
  handleGetVendas: (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
    status?: vendaStatus | "TODOS",
    filters?: PaymentListFilters,
  ) => Promise<void>;
  fetchStatusCounts: () => Promise<void>;
  status: vendaStatus | "TODOS";

  // âœ… para ediÃ§Ã£o via duplo clique (controlado no pai)
  selectedVendaId?: number | undefined;
  setSelectedVendaId?: (value: number | undefined) => void;
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
}

type CancelamentoResumo = {
  produtos: { itens: number; quantidade: number };
  transacoes: { pendentes: number; concluidas: number; valorConcluido: number };
  bloqueio: string | null;
};

const moneyToCents = (value: number) =>
  Math.round((Number.isFinite(value) ? value : 0) * 100);

const getStatusBadge = (status: vendaStatus) => {
  if (status === "ORCAMENTO") {
    return (
      <Badge variant="secondary" className="text-xs bg-violet-600 not-dark:text-white">
        <FileText className="h-3 w-3 mr-1" />
        ORÇAMENTO
      </Badge>
    );
  }

  if (status === "APROVACAO_ORCAMENTO") {
    return (
      <Badge variant="secondary" className="bg-sky-600 text-xs not-dark:text-white">
        <Send className="mr-1 h-3 w-3" />
        APROVAÇÃO ORÇAMENTO
      </Badge>
    );
  }

  if (status === "ORCAMENTO_APROVADO") {
    return (
      <Badge variant="secondary" className="bg-emerald-600 text-xs not-dark:text-white">
        <Check className="mr-1 h-3 w-3" />
        ORÇAMENTO APROVADO
      </Badge>
    );
  }

  if (status === "ORCAMENTO_RECUSADO") {
    return (
      <Badge variant="secondary" className="bg-red-600 text-xs not-dark:text-white">
        <AlertCircle className="mr-1 h-3 w-3" />
        ORÇAMENTO RECUSADO
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
  setSearch,
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
  const [loadingApprovalData, setLoadingApprovalData] = useState(false);
  const [approvingBudget, setApprovingBudget] = useState(false);
  const [advancingVendaId, setAdvancingVendaId] = useState<number | null>(null);
  const [approvalTotal, setApprovalTotal] = useState(0);
  const [approvalDescription, setApprovalDescription] = useState("");
  const [approvalInternalNotes, setApprovalInternalNotes] = useState("");
  const [approvalFiscalNotes, setApprovalFiscalNotes] = useState("");
  const [approvalFinancial, setApprovalFinancial] = useState<DadosParaFinanceiro>(
    dadosParaFinanceiroVazios,
  );
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkVenda, setLinkVenda] = useState<VendaComItens | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelVendaId, setCancelVendaId] = useState<number | null>(null);
  const [cancelMotivo, setCancelMotivo] = useState("");
  const [cancelResumo, setCancelResumo] = useState<CancelamentoResumo | null>(null);
  const [loadingCancelamento, setLoadingCancelamento] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [orcamentoDialogOpen, setOrcamentoDialogOpen] = useState(false);
  const [orcamentoVendaId, setOrcamentoVendaId] = useState<number | null>(null);
  const [revertendoOrcamento, setRevertendoOrcamento] = useState(false);
  const [syncingMercadoLivre, setSyncingMercadoLivre] = useState(false);
  const config = useConfig();
  const canEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.VENDAS_EDITAR);
  const canDelete = permissionSetHas((session?.user as any)?.permissoes, PERMS.VENDAS_EXCLUIR);
  const canNotasFiscais = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_NOTAS_FISCAIS,
  );
  const hasActiveFilters = Boolean(
    filters.dataInicio ||
      filters.dataFim ||
      filters.apenasMinhas ||
      filters.canal ||
      filters.categoriaVendaId ||
      filters.vendedorId ||
      filters.valorMin != null ||
      filters.valorMax != null,
  );

  const toggleApenasMinhas = () => {
    const next = { ...filters, apenasMinhas: !filters.apenasMinhas };
    setFilters(next);
    handleGetVendas(1, pagination.limit, search, status, next);
  };

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
        const pageAfterDelete = vendas.length === 1 && pagination.page > 1 ? pagination.page - 1 : pagination.page;

        setIsAlertOpen(false);
        await Promise.all([
          handleGetVendas(pageAfterDelete, pagination.limit, search, status, filters),
          fetchStatusCounts(),
        ]);
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

  const abrirAprovacaoManual = async (vendaId: number) => {
    setApproveVendaId(vendaId);
    setApproveDialogOpen(true);
    setLoadingApprovalData(true);
    setApprovalFinancial(dadosParaFinanceiroVazios());
    setApprovalDescription("");
    setApprovalInternalNotes("");
    setApprovalFiscalNotes("");
    try {
      const response = await axios.get(`/api/venda/${vendaId}`);
      const venda = response.data?.data ?? {};
      setApprovalTotal(Number(venda.valortotal ?? 0));
      setApprovalDescription(String(venda.descricao ?? ""));
      setApprovalInternalNotes(String(venda.observacoes ?? ""));
      setApprovalFiscalNotes(String(venda.observacoes_fiscais ?? ""));
      setApprovalFinancial(dadosParaFinanceiroDaVenda(venda));
    } catch (error) {
      toast.error("Erro ao carregar o orçamento", {
        description: isAxiosError(error) ? error.response?.data?.error || "Tente novamente." : "Tente novamente.",
      });
      setApproveDialogOpen(false);
      setApproveVendaId(null);
    } finally {
      setLoadingApprovalData(false);
    }
  };

  const handleApproveBudget = async () => {
    if (!canEdit) return;
    if (!approveVendaId) return;

    const recusa = validarDadosParaFinanceiro(approvalFinancial, moneyToCents(approvalTotal));
    if (recusa) {
      toast.error(recusa);
      return;
    }

    setApprovingBudget(true);

    toast(
      <div className="flex flex-row items-center flex-nowrap gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Aprovando orçamento</span>
      </div>,
    );

    try {
      const response = await axios.patch(`/api/venda/${approveVendaId}`, {
        status: "ORCAMENTO_APROVADO",
        formaPagamento: montarFormaPagamento(approvalFinancial),
        pagamentosPrevistos: montarPagamentosPrevistos(approvalFinancial),
        descricaoFinanceiro: approvalFinancial.descricaoFinanceiro.trim() || null,
        garantia: approvalFinancial.garantia.trim() || null,
        descricao: approvalDescription.trim() || null,
        observacoes: approvalInternalNotes.trim() || null,
        observacoesFiscais: approvalFiscalNotes.trim() || null,
      });

      if (response.status === 200) {
        toast.success("Orçamento aprovado com sucesso.");
        setApproveDialogOpen(false);
        setApproveVendaId(null);
        setApprovalFinancial(dadosParaFinanceiroVazios());
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
    } finally {
      setApprovingBudget(false);
    }
  };

  const handleAvancarParaPagamento = async (vendaId: number) => {
    if (!canEdit || advancingVendaId) return;
    setAdvancingVendaId(vendaId);
    try {
      await axios.patch(`/api/venda/${vendaId}`, { status: "PAGAMENTO" });
      toast.success("Venda encaminhada para pagamento.");
      await Promise.all([
        handleGetVendas(pagination.page, pagination.limit, search, status, filters),
        fetchStatusCounts(),
      ]);
    } catch (error) {
      toast.error("Erro ao encaminhar para pagamento", {
        description: isAxiosError(error) ? error.response?.data?.error || "Tente novamente." : "Tente novamente.",
      });
    } finally {
      setAdvancingVendaId(null);
    }
  };

  const handleReverterParaOrcamento = async () => {
    if (!canEdit || !orcamentoVendaId) return;

    setRevertendoOrcamento(true);
    try {
      const response = await axios.post(`/api/venda/${orcamentoVendaId}/reverter-orcamento`);
      const resultado = response.data?.data ?? {};

      toast.success("Venda mantida como orçamento", {
        description: `${resultado.transacoesExcluidas ?? 0} transação(ões) removida(s) e estoque devolvido.`,
      });
      setOrcamentoDialogOpen(false);
      setOrcamentoVendaId(null);
      await Promise.all([
        handleGetVendas(pagination.page, pagination.limit, search, status, filters),
        fetchStatusCounts(),
      ]);
    } catch (error) {
      toast.error("Erro ao voltar a venda para orçamento", {
        description: isAxiosError(error) ? error.response?.data?.error || "Tente novamente." : "Tente novamente.",
      });
    } finally {
      setRevertendoOrcamento(false);
    }
  };

  const abrirCancelamento = async (id: number) => {
    setCancelVendaId(id);
    setCancelMotivo("");
    setCancelResumo(null);
    setCancelDialogOpen(true);
    setLoadingCancelamento(true);
    try {
      const response = await axios.get(`/api/venda/${id}/cancelar`);
      setCancelResumo(response.data as CancelamentoResumo);
    } catch (error) {
      const mensagem = isAxiosError(error)
        ? error.response?.data?.error || "Não foi possível preparar o cancelamento."
        : "Não foi possível preparar o cancelamento.";
      toast.error(mensagem);
      setCancelDialogOpen(false);
    } finally {
      setLoadingCancelamento(false);
    }
  };

  const confirmarCancelamento = async () => {
    if (!cancelVendaId || cancelMotivo.trim().length < 3 || cancelResumo?.bloqueio) return;
    setCancelando(true);
    try {
      const response = await axios.post(`/api/venda/${cancelVendaId}/cancelar`, {
        motivo: cancelMotivo.trim(),
      });
      const resultado = response.data?.data ?? {};
      toast.success("Venda cancelada", {
        description: `${resultado.transacoesExcluidas ?? 0} transação(ões) removida(s) e estoque devolvido.`,
      });
      setCancelDialogOpen(false);
      setCancelVendaId(null);
      await Promise.all([
        handleGetVendas(pagination.page, pagination.limit, search, status, filters),
        fetchStatusCounts(),
      ]);
    } catch (error) {
      toast.error("Erro ao cancelar venda", {
        description: isAxiosError(error) ? error.response?.data?.error || "Tente novamente." : "Tente novamente.",
      });
    } finally {
      setCancelando(false);
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

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ID, valor, cliente, CPF/CNPJ ou nota..."
                aria-label="Buscar no histórico de vendas"
                className="pl-9"
              />
            </div>
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
            <Button
              variant={filters.apenasMinhas ? "default" : "outline"}
              size="sm"
              className="gap-1 hover:cursor-pointer"
              aria-pressed={Boolean(filters.apenasMinhas)}
              title="Mostrar apenas as vendas criadas por mim"
              onClick={toggleApenasMinhas}
            >
              <UserRound className="h-4 w-4" />
              Minhas Vendas
            </Button>
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
              showTextFilters={false}
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
                  <TableCell className="text-center">
                    {getStatusBadge(p.status)}
                  </TableCell>
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
                          canNotasFiscais && (config?.emissao_nf_vendas_nao_pagas
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

                        {canEdit && ["ORCAMENTO", "APROVACAO_ORCAMENTO"].includes(String(p.status)) && (
                          <>
                            <DropdownMenuItem onClick={() => void abrirAprovacaoManual(p.id)}>
                              <Check className="h-4 w-4" />
                              Aprovar orçamento
                            </DropdownMenuItem>
                          </>
                        )}

                        {canEdit && ["ORCAMENTO", "APROVACAO_ORCAMENTO", "ORCAMENTO_RECUSADO"].includes(String(p.status)) && (
                          <>
                            <DropdownMenuItem
                              onClick={() => {
                                setLinkVenda(p);
                                setLinkDialogOpen(true);
                              }}
                            >
                              <Send className="h-4 w-4" />
                              {p.status === "ORCAMENTO_RECUSADO"
                                ? "Reenviar para aprovação"
                                : p.status === "APROVACAO_ORCAMENTO"
                                  ? "Abrir link de aprovação"
                                  : "Enviar para aprovação"}
                            </DropdownMenuItem>
                          </>
                        )}

                        {canEdit && p.status === "ORCAMENTO_APROVADO" && (
                          <DropdownMenuItem
                            disabled={advancingVendaId === p.id}
                            onClick={() => void handleAvancarParaPagamento(p.id)}
                          >
                            {advancingVendaId === p.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <ChevronsRight className="h-4 w-4" />}
                            Continuar para pagamento
                          </DropdownMenuItem>
                        )}

                        {canEdit && p.status === "PAGAMENTO" && (
                          <DropdownMenuItem
                            onClick={() => {
                              setOrcamentoVendaId(p.id);
                              setOrcamentoDialogOpen(true);
                            }}
                          >
                            <Undo2 className="h-4 w-4" />
                            Manter como orçamento
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

                        {canEdit && !["CANCELADA", "CANCELADO"].includes(String(p.status).toUpperCase()) && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => void abrirCancelamento(p.id)}
                          >
                            <Ban className="h-4 w-4" />
                            Cancelar venda
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
      <VendaDetailsDialog
        vendaId={selectedVendaId}
        onOpenChange={setOpenDetails}
        open={openDetails}
        onSaved={() => {
          handleGetVendas(pagination.page, pagination.limit, search, status, filters);
          fetchStatusCounts();
        }}
      />
      <PedidoOnlineDialog
        vendaId={onlineVendaId}
        open={openOnline}
        onOpenChange={setOpenOnline}
        onSaved={() => {
          handleGetVendas(pagination.page, pagination.limit, search, status);
          fetchStatusCounts();
        }}
      />
      <VendaLinkAprovacaoDialog
        open={linkDialogOpen}
        onOpenChange={(open) => {
          setLinkDialogOpen(open);
          if (!open) setLinkVenda(null);
        }}
        vendaId={linkVenda?.id ?? null}
        clienteNome={linkVenda?.cliente?.nomerazaosocial}
        clienteTelefone={linkVenda?.cliente?.telefone}
        onGenerated={() => {
          void handleGetVendas(pagination.page, pagination.limit, search, status, filters);
        }}
      />
      <AlertDialog
        open={approveDialogOpen}
        onOpenChange={(open) => {
          if (approvingBudget) return;
          setApproveDialogOpen(open);
          if (!open) setApproveVendaId(null);
        }}
      >
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar orçamento #{approveVendaId}</AlertDialogTitle>
            <AlertDialogDescription>Ao aprovar, a venda passará para o status de pagamento.</AlertDialogDescription>
          </AlertDialogHeader>

          {loadingApprovalData ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando informações...
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-4">
              <VendaConfirmacaoFields
                idPrefix="aprovacao-venda"
                descricao={approvalDescription}
                onDescricaoChange={setApprovalDescription}
                observacoesInternas={approvalInternalNotes}
                onObservacoesInternasChange={setApprovalInternalNotes}
                observacoesFiscais={approvalFiscalNotes}
                onObservacoesFiscaisChange={setApprovalFiscalNotes}
                dadosFinanceiro={approvalFinancial}
                onDadosFinanceiroChange={setApprovalFinancial}
                totalCents={moneyToCents(approvalTotal)}
                disabled={approvingBudget}
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={approvingBudget}
              onClick={() => {
                setApproveVendaId(null);
                setApprovalFinancial(dadosParaFinanceiroVazios());
              }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={loadingApprovalData || approvingBudget}
              onClick={(event) => {
                event.preventDefault();
                void handleApproveBudget();
              }}
            >
              {approvingBudget ? "Aprovando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={orcamentoDialogOpen}
        onOpenChange={(open) => {
          if (revertendoOrcamento) return;
          setOrcamentoDialogOpen(open);
          if (!open) setOrcamentoVendaId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Manter venda #{orcamentoVendaId} como orçamento</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>A venda volta para o status ORÇAMENTO e continua com os mesmos produtos e valores.</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>As transações vinculadas, inclusive pagamentos parciais já recebidos, serão apagadas.</li>
                  <li>O estoque baixado na aprovação será devolvido.</li>
                  <li>A forma de pagamento será limpa e escolhida de novo na próxima aprovação.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={revertendoOrcamento}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={revertendoOrcamento}
              onClick={(event) => {
                event.preventDefault();
                void handleReverterParaOrcamento();
              }}
            >
              {revertendoOrcamento && <Loader2 className="size-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          if (cancelando) return;
          setCancelDialogOpen(open);
          if (!open) setCancelVendaId(null);
        }}
      >
        <DialogContent
          className="overflow-hidden p-0 sm:max-w-lg"
          onInteractOutside={(event) => {
            if (loadingCancelamento || cancelando) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (loadingCancelamento || cancelando) event.preventDefault();
          }}
        >
          {(loadingCancelamento || cancelando) && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-[1px]">
              <Loader2 className="size-7 animate-spin text-primary" />
              <p className="text-sm font-medium text-muted-foreground">
                {cancelando ? "Cancelando venda..." : "Verificando venda..."}
              </p>
            </div>
          )}
          <DialogHeader className="border-b bg-muted/30 px-6 py-5 text-left">
            <DialogTitle className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Ban className="size-4" />
              </span>
              Cancelar venda #{cancelVendaId}
            </DialogTitle>
            <DialogDescription>
              A venda permanecerá no histórico, o estoque será devolvido e as transações vinculadas serão removidas.
            </DialogDescription>
          </DialogHeader>

          {loadingCancelamento ? (
            <div className="h-64" aria-hidden />
          ) : cancelResumo ? (
            <div className="space-y-4 px-6 py-5">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Devolução ao estoque</p>
                  <p className="mt-1 text-lg font-semibold">{cancelResumo.produtos.quantidade} unidade(s)</p>
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Valor das transações</p>
                  <p className="mt-1 text-lg font-semibold">{formatarEmReal(cancelResumo.transacoes.valorConcluido)}</p>
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Serão removidas {cancelResumo.transacoes.concluidas} transação(ões) concluída(s) e {cancelResumo.transacoes.pendentes} pendente(s). Nenhum estorno será criado.
              </div>
              {cancelResumo.bloqueio && (
                <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {cancelResumo.bloqueio}
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="motivo-cancelamento-venda" className="text-sm font-medium">
                  Motivo do cancelamento
                </label>
                <Textarea
                  id="motivo-cancelamento-venda"
                  value={cancelMotivo}
                  onChange={(event) => setCancelMotivo(event.target.value)}
                  placeholder="Informe por que esta venda está sendo cancelada"
                  rows={3}
                  maxLength={500}
                  disabled={Boolean(cancelResumo.bloqueio) || cancelando}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={loadingCancelamento || cancelando}
              onClick={() => setCancelDialogOpen(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={loadingCancelamento || cancelando || Boolean(cancelResumo?.bloqueio) || cancelMotivo.trim().length < 3}
              onClick={() => void confirmarCancelamento()}
            >
              {cancelando && <Loader2 className="size-4 animate-spin" />}
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function isMarketplaceCanal(canal: unknown) {
  const value = String(canal ?? "").toUpperCase();
  return value === "ONLINE" || value === "MERCADO_LIVRE" || value === "SHOPEE";
}
