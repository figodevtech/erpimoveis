"use client";
import { siteStatusLabel } from "@/lib/integrations/site-status-labels";
import { readJsonResponse } from "@/lib/read-json-response";


import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  ExternalLink,
  FilePenLine,
  Loader2,
  MoreHorizontal,
  PackageCheck,
  ReceiptText,
  Store,
  Truck,
  Filter, Copy, Undo2, RefreshCw, CreditCard, User, History, MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StorefrontOrderFilters } from "./storefront-order-filters";
import { EMPTY_SITE_ORDER_FILTERS, type SiteOrderFilters } from "@/lib/integrations/site-order-filters";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MarketplacePagination } from "./marketplace-layout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const VendaDetailsDialog = dynamic(
  () =>
    import("../(vendas)/historicovendas/components/venda-detail-dialog").then(
      (module) => module.VendaDetailsDialog,
    ),
  { ssr: false },
);

const EmissaoNotaDialog = dynamic(
  () =>
    import("../ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog").then(
      (module) => module.EmissaoNotaDialog,
    ),
  { ssr: false },
);

type SiteOrder = {
  checkout_pending?: boolean;
  payment_due_date?: string | null;
  checkout_updated_at?: string | null;
  payment_checked_at?: string | null;
  bank_cancelled_at?: string | null;
  stock_release_pending?: boolean;
  refund_status?: string | null;
  nextAction?: string;
  refund_request_url?: string | null;
  payment_provider?: string | null;
  gateway_payment_id?: string | null;
  refund_checked_at?: string | null;
  return_requested_at?: string | null;
  return_received_at?: string | null;
  return_reason?: string | null;
  return_inspection_note?: string | null;
  reverse_tracking?: string | null;
  returnItems?: Array<{ productId: number; quantity: number; title: string; reference?: string; subtotal?: number; total?: number; discount?: number; freight?: number }>;
  paymentMethod?: string | null;
  subtotal?: number | null;
  customer?: { name?: string; document?: string; email?: string; phone?: string } | null;
  refund_requested_at?: string | null;
  refund_reason?: string | null;
  refund_denial_reason?: string | null;
  id: number;
  site_order_id: number;
  site_status: string;
  total_amount: number;
  order_created_at?: string | null;
  import_status: "PENDENTE" | "PROCESSANDO" | "IMPORTADA" | "ERRO";
  import_error?: string | null;
  last_synced_at?: string | null;
  venda?: {
    id: number;
    status?: string | null;
    status_entrega?: string | null;
    codigo_rastreio?: string | null;
    transportadora_rastreio?: string | null;
    cliente?: {
      nomerazaosocial?: string | null;
      cpfcnpj?: string | null;
      email?: string | null;
      telefone?: string | null;
    } | null;
  } | null;
  delivery?: {
    method: "delivery" | "pickup";
    label: string;
    address: {
      street?: string | null;
      number?: string | null;
      complement?: string | null;
      neighborhood?: string | null;
      city?: string | null;
      state?: string | null;
      zipCode?: string | null;
    };
  } | null;
  invoice?: {
    id: number;
    numero?: number | string | null;
    serie?: number | string | null;
    chave_acesso?: string | null;
    status?: string | null;
  } | null;
};

export type StorefrontOrderActions = {
  reload: () => void;
  sync: () => void;
  loading: boolean;
  syncing: boolean;
  total: number;
  openFilters: () => void;
  activeFilters: number;
};

type StorefrontOrdersProps = {
  embedded?: boolean;
  onActionsChange?: (actions: StorefrontOrderActions) => void;
};

export function StorefrontOrders({
  embedded = false,
  onActionsChange,
}: StorefrontOrdersProps) {
  const syncLock = useRef(false);
  const [cancelOrder, setCancelOrder] = useState<SiteOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [returnOrder, setReturnOrder] = useState<SiteOrder | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnTracking, setReturnTracking] = useState("");
  const [returnApproved, setReturnApproved] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);
  const [orderFilters, setOrderFilters] = useState<SiteOrderFilters>(EMPTY_SITE_ORDER_FILTERS);
  const extraFilterCount=Object.values(orderFilters).filter(value=>value!==""&&value!=="all").length;
  const [stageFilter, setStageFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsOrder, setDetailsOrder] = useState<SiteOrder | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");

  async function saveReturn() {
    if (!returnOrder || returnSaving) return;
    setReturnSaving(true);
    try {
      const response = await fetch(`/api/integracoes/site/orders/${returnOrder.site_order_id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: returnOrder.return_requested_at ? "RECEIVE_RETURN" : "REQUEST_RETURN", reason: returnReason, reverseTracking: returnTracking, ...(returnApproved ? { allItemsApproved: true } : {}) }),
      });
      const result = await readJsonResponse(response, "ERP");
      if (!response.ok) throw new Error(result.error || "Falha ao registrar devolução.");
      toast.success(result.message);
      setReturnOrder(null);
      await loadOrders();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha na devolução."); }
    finally { setReturnSaving(false); }
  }
  const [orders, setOrders] = useState<SiteOrder[]>([]);
  useEffect(() => {
    if (!detailsOpen) return;
    setDetailsOrder(previous => orders.find(order => order.site_order_id === previous?.site_order_id) ?? previous);
  }, [orders, detailsOpen]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<SiteOrder | null>(null);
  const [editingSaleId, setEditingSaleId] = useState<number | null>(null);
  const [invoiceSaleId, setInvoiceSaleId] = useState<number | null>(null);
  const [savingShipment, setSavingShipment] = useState(false);
  const [shipment, setShipment] = useState({
    deliveryStatus: "SEPARACAO" as "SEPARACAO" | "FATURADO" | "ENVIADO" | "ENTREGUE",
    carrier: "Correios",
    trackingCode: "",
    trackingUrl: "",
  });

  const loadOrders = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(
        `/api/integracoes/site/orders?page=${page}&limit=${pageSize}&stage=${encodeURIComponent(stageFilter)}&search=${encodeURIComponent(orderSearch)}&${new URLSearchParams(orderFilters).toString()}`,
        { cache: "no-store" },
      );
      const json = await readJsonResponse(response, "ERP");
      if (!response.ok)
        throw new Error(json?.error || "Falha ao carregar pedidos.");
      setOrders(json.data || []);
      setTotal(json.pagination?.total ?? json.count ?? 0);
      setTotalPages(json.pagination?.totalPages ?? 1);
      setError(json.warning || null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao carregar pedidos.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, stageFilter, orderSearch, orderFilters]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const onNotification = (event: Event) => {
      const row = (event as CustomEvent<{ source?: string }>).detail;
      if(row?.source === "SITE_ORDER") void loadOrders(true);
    };
    window.addEventListener("erp:system-notification", onNotification);
    return () => window.removeEventListener("erp:system-notification", onNotification);
  }, [loadOrders]);

  const syncOrders = useCallback(async (silent = false) => {
    if (syncLock.current) return;
    syncLock.current = true;
    if (!silent) setSyncing(true);
    try {
      const response = await fetch("/api/integracoes/site/orders", {
        method: "POST",
      });
      const json = await readJsonResponse(response, "ERP");
      if (!response.ok)
        throw new Error(json?.error || "Falha ao sincronizar pedidos.");
      if (!silent || json.imported > 0) toast.success("Pedidos sincronizados", {
        description: `${json.imported || 0} novo(s) pedido(s) importado(s) e ${json.errors || 0} erro(s).`,
      });
      await loadOrders(silent);
    } catch (requestError) {
      if (!silent) toast.error("Erro ao sincronizar pedidos", {
        description:
          requestError instanceof Error
            ? requestError.message
            : "Tente novamente.",
      });
    } finally {
      if (!silent) setSyncing(false);
      syncLock.current = false;
    }
  }, [loadOrders]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void syncOrders(true); };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [syncOrders]);

  async function reconcilePayment() {
    if(syncLock.current)return;
    syncLock.current=true;setSyncing(true);
    try {
      const response=await fetch('/api/integracoes/site/checkouts',{method:'POST'});
      const result=await readJsonResponse(response,'ERP');
      if(!response.ok)throw new Error(result.error||'Não foi possível conferir os pagamentos.');
      await loadOrders(true);
      toast.success('Pagamentos conferidos');
    }catch(error){toast.error(error instanceof Error?error.message:'Falha ao conferir pagamentos.');}
    finally{syncLock.current=false;setSyncing(false);}
  }

  async function checkRefund(order: SiteOrder) {
    try {
      const response = await fetch(`/api/integracoes/site/orders/${order.site_order_id}`, {cache:"no-store"});
      const result = await readJsonResponse(response, "ERP");
      if(!response.ok) throw new Error(result.error || "Falha ao consultar estorno.");
      toast.info(result.refundStatus === "AWAITING_CRITICAL_ACTION_AUTHORIZATION" ? "Reembolso aguarda autorização na conta Asaas da loja. Autorize a ação pendente; não solicite outro estorno." : result.refundStatus === "DENIED" ? `Estorno recusado: ${result.denialReason || "Motivo nao informado"}. Nenhum estoque foi devolvido.` : result.gatewayStatus === "REFUNDED" ? result.requiresPhysicalReturn ? "Estorno confirmado. Estoque aguarda devolução física conferida." : "Estorno confirmado e estoque devolvido." : result.requestedAt && ["RECEIVED", "CONFIRMED"].includes(result.gatewayStatus) ? "Solicitação registrada, mas o pagamento continua recebido. O reembolso precisa de verificação antes de nova tentativa." : result.requestedAt ? `Estorno solicitado. Status Asaas: ${siteStatusLabel(result.gatewayStatus)}` : `Nenhum estorno solicitado. Status Asaas: ${siteStatusLabel(result.gatewayStatus)}`);
      await loadOrders(true);
    } catch(error) { toast.error(error instanceof Error ? error.message : "Falha ao consultar estorno."); }
  }

  async function confirmCancellation() {
    if (!cancelOrder || canceling) return;
    setCanceling(true);
    try {
      const response = await fetch(`/api/integracoes/site/orders/${cancelOrder.site_order_id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const result = await readJsonResponse(response, "ERP");
      if (!response.ok) throw new Error(result.error || "Falha ao cancelar pedido.");
      if (result.pending) toast.info(result.message || "Estorno em processamento. Consulte novamente para concluir.");
      else toast.success("Pedido estornado e estoque devolvido.");
      setCancelOrder(null);
      await loadOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao cancelar pedido.");
    } finally { setCanceling(false); }
  }

  useEffect(() => {
    onActionsChange?.({
      reload: () => void loadOrders(),
      sync: () => void syncOrders(),
      loading,
      syncing,
      total,
      openFilters: () => setFiltersOpen(true),
      activeFilters: Number(stageFilter !== "all") + Number(Boolean(orderSearch)) + extraFilterCount,
    });
  }, [loadOrders, loading, onActionsChange, syncOrders, syncing, total, stageFilter, orderSearch, extraFilterCount]);

  function openShipment(order: SiteOrder) {
    setSelectedOrder(order);
    setShipment({
      deliveryStatus: order.venda?.status_entrega === "ENTREGUE"
        ? "ENTREGUE"
        : order.venda?.status_entrega === "ENVIO"
          ? "ENVIADO"
          : order.invoice?.chave_acesso
            ? "FATURADO"
            : "SEPARACAO",
      carrier: order.venda?.transportadora_rastreio || "Correios",
      trackingCode: order.venda?.codigo_rastreio || "",
      trackingUrl: "",
    });
  }

  async function saveShipment() {
    const pickup = selectedOrder?.delivery?.method === "pickup";
    if (
      !selectedOrder ||
      (!pickup && shipment.deliveryStatus === "ENVIADO" &&
        (!shipment.carrier.trim() || !shipment.trackingCode.trim()))
    ) {
      toast.error("Informe a transportadora e o código de rastreio.");
      return;
    }
    setSavingShipment(true);
    try {
      const response = await fetch(
        `/api/integracoes/site/orders/${selectedOrder.site_order_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(shipment),
        },
      );
      const json = await readJsonResponse(response, "ERP");
      if (!response.ok)
        throw new Error(json?.error || "Falha ao registrar postagem.");
      toast.success("Andamento enviado para a loja", {
        description: shipment.deliveryStatus === "SEPARACAO"
          ? "O cliente já pode acompanhar a etapa de separação."
          : shipment.deliveryStatus === "FATURADO"
            ? "Os dados da NF-e foram atualizados no pedido."
          : shipment.deliveryStatus === "ENTREGUE"
              ? pickup
                ? "A retirada foi confirmada no pedido da loja."
                : "A entrega foi confirmada no pedido da loja."
              : json.invoiceSent
                ? pickup
                  ? "O pedido está pronto para retirada e a NF-e foi atualizada."
                  : "Rastreio e dados da NF-e foram atualizados no pedido."
                : pickup
                  ? "O cliente já pode acompanhar a retirada."
                  : "O rastreio foi atualizado no pedido.",
      });
      setSelectedOrder(null);
      await loadOrders();
    } catch (requestError) {
      toast.error("Erro ao registrar postagem", {
        description:
          requestError instanceof Error
            ? requestError.message
            : "Tente novamente.",
      });
    } finally {
      setSavingShipment(false);
    }
  }

  const imported = orders.filter(
    (order) => order.import_status === "IMPORTADA",
  ).length;
  const awaitingShipment = orders.filter(
    (order) => !order.refund_requested_at && order.site_status !== "CANCELADO" && order.venda && !["CANCELADA", "CANCELADO"].includes(order.venda.status || "") && order.delivery?.method !== "pickup" && !order.venda.codigo_rastreio,
  ).length;
  const awaitingPickup = orders.filter(
    (order) => !order.refund_requested_at && order.site_status !== "CANCELADO" && order.venda && !["CANCELADA", "CANCELADO"].includes(order.venda.status || "") && order.delivery?.method === "pickup" && order.venda.status_entrega !== "ENTREGUE",
  ).length;
  const invoiced = orders.filter((order) => order.invoice?.chave_acesso).length;
  const selectedIsPickup = selectedOrder?.delivery?.method === "pickup";

  return (
    <>
      <Card
        className={
          embedded ? "gap-0 border-0 py-0 shadow-none" : "gap-0 overflow-hidden"
        }
      >
        {!embedded ? (
          <CardHeader className="border-b pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Pedidos do Site</CardTitle>
                <CardDescription>
                  Pedidos pagos importados como vendas online, com rastreio e
                  situação fiscal.
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void syncOrders()}
                disabled={syncing}
              >
                {syncing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ClipboardList className="mr-2 h-4 w-4" />
                )}
                Sincronizar pedidos
              </Button>
            </div>
          </CardHeader>
        ) : null}
        <CardContent className="space-y-5 p-4 lg:p-6">
          {!embedded ? <Button variant="outline" size="sm" onClick={() => setFiltersOpen(true)}><Filter className="h-4 w-4" />Filtros</Button> : null}
          <StorefrontOrderFilters key={JSON.stringify([filtersOpen,orderFilters,stageFilter,orderSearch])} open={filtersOpen} onOpenChange={setFiltersOpen} filters={orderFilters} stage={stageFilter} search={orderSearch} onApply={(filters,stage,search)=>{setOrderFilters(filters);setStageFilter(stage);setOrderSearch(search);setPage(1);}} />
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border xl:grid-cols-4">
            <Summary label="Importados" value={imported} icon={PackageCheck} />
            <Summary
              label="Aguardando postagem"
              value={awaitingShipment}
              icon={Truck}
            />
            <Summary label="Aguardando retirada" value={awaitingPickup} icon={Store} />
            <Summary label="Com NF-e" value={invoiced} icon={ReceiptText} />
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              <div>
                <p className="text-sm font-medium">
                  Pedidos ainda não disponíveis
                </p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table className="block md:table">
              <TableHeader className="hidden bg-muted/30 md:table-header-group">
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Nota fiscal</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="block md:table-row-group">
                {orders.map((order) => {
                  const actionsBlocked = !order.venda?.id || order.checkout_pending || Boolean(order.return_requested_at || order.refund_requested_at) || order.refund_status === "REFUNDED" || order.site_status === "CANCELADO" || ["CANCELADA", "CANCELADO"].includes(order.venda?.status || "");
                  return (
                  <TableRow key={order.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 p-3 md:table-row md:p-0">
                    <TableCell className="block p-0 md:table-cell md:p-2">
                      <p className="font-medium">Site #{order.site_order_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(order.order_created_at)}
                      </p>
                      {!order.checkout_pending && <ImportBadge status={order.import_status} />}
                    </TableCell>
                    <TableCell className="col-span-2 row-start-2 block min-w-0 p-0 md:table-cell md:p-2">
                      <p className="max-w-56 truncate">
                        {order.venda?.cliente?.nomerazaosocial || order.customer?.name || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {order.checkout_pending ? "Venda após confirmação do pagamento" : `Venda ERP ${order.venda?.id ? `#${order.venda.id}` : "pendente"}`}
                      </p>
                    </TableCell>
                    <TableCell className="col-start-2 row-start-1 block p-0 text-right font-medium md:table-cell md:p-2 md:text-left">
                      {formatMoney(order.total_amount)}
                    </TableCell>
                    <TableCell className="col-span-2 block min-w-0 whitespace-normal p-0 md:table-cell md:p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="gap-1">
                          {order.delivery?.method === "pickup" ? <Store className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
                          {order.delivery?.method === "pickup" ? "Retirada" : "Envio"}
                        </Badge>
                        <FulfillmentBadge order={order} />
                      </div>
                      {order.venda?.codigo_rastreio ? (
                        <p className="mt-1 font-mono text-xs">{order.venda.codigo_rastreio}</p>
                      ) : null}
                      <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">
                        {formatDeliveryAddress(order)}
                      </p>
                      {order.nextAction ? <p className="mt-1 max-w-80 text-xs text-muted-foreground">Próxima ação: {order.nextAction}</p> : null}
                    </TableCell>
                    <TableCell className="block p-0 md:table-cell md:p-2">
                      <span className="mr-2 text-xs text-muted-foreground md:hidden">NF-e</span>
                      {order.invoice?.chave_acesso ? (
                        <>
                          <Badge
                            variant="outline"
                            className="border-emerald-600/30 text-emerald-700"
                          >
                            {siteStatusLabel(order.invoice.status, "Emitida")}
                          </Badge>
                          <p className="mt-1 text-xs">
                            NF-e {order.invoice.numero || "—"}
                          </p>
                        </>
                      ) : (
                        <Badge variant="secondary">{order.checkout_pending ? "—" : "Pendente"}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="block p-0 text-right md:table-cell md:p-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-10 gap-2 md:h-9" aria-label={`Ações do pedido ${order.site_order_id}`}>
                            <span className="md:hidden">Ações</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {order.checkout_pending && order.site_status!=="CANCELADO" && <DropdownMenuItem disabled={syncing} onSelect={() => void reconcilePayment()}><RefreshCw className="h-4 w-4" />Conferir pagamentos</DropdownMenuItem>}
                          <DropdownMenuItem onSelect={() => { setDetailsOrder(order); setDetailsOpen(true); }}><ClipboardList className="h-4 w-4" /> Detalhes do pedido</DropdownMenuItem>
                          {!actionsBlocked ? (
                          <DropdownMenuItem
                            disabled={!order.venda?.id}
                            onSelect={() => setEditingSaleId(order.venda?.id ?? null)}
                          >
                            <FilePenLine className="h-4 w-4" /> Editar venda
                          </DropdownMenuItem>
                          ) : null}
                          {!actionsBlocked || order.invoice ? (
                          <DropdownMenuItem
                            disabled={!order.venda?.id}
                            onSelect={() => setInvoiceSaleId(order.venda?.id ?? null)}
                          >
                            <ReceiptText className="h-4 w-4" /> {order.invoice ? "Gerenciar NF-e" : "Emitir NF-e"}
                          </DropdownMenuItem>
                          ) : null}
                          {!actionsBlocked ? (
                            <>
                          <DropdownMenuItem
                            disabled={!order.venda?.id || Boolean(order.refund_requested_at) || order.refund_status === "REFUNDED" || ["CANCELADA", "CANCELADO"].includes(order.venda?.status || "")}
                            onSelect={() => openShipment(order)}
                          >
                            {order.delivery?.method === "pickup" ? <Store className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                            Atualizar andamento
                          </DropdownMenuItem>
                          {!["ENVIO", "ENVIADO", "ENTREGUE"].includes(order.venda?.status_entrega || "") ? <DropdownMenuItem
                            onSelect={() => { setCancelOrder(order); setCancelReason(""); }}
                            className="text-destructive"
                          ><Undo2 className="h-4 w-4" />Cancelar e estornar</DropdownMenuItem> : null}
                            </>
                          ) : null}
                          {order.refund_status === "DENIED" && order.venda?.id && !["CANCELADA", "CANCELADO"].includes(order.venda.status || "") && !["ENVIO", "ENVIADO", "ENTREGUE"].includes(order.venda.status_entrega || "") ? (
                            <DropdownMenuItem className="text-destructive" onSelect={() => { setCancelOrder(order); setCancelReason(""); }}>
                              <Undo2 className="h-4 w-4" />Tentar estorno novamente
                            </DropdownMenuItem>
                          ) : null}
                          {!order.checkout_pending && order.refund_status && <DropdownMenuItem onSelect={() => void checkRefund(order)}><RefreshCw className="h-4 w-4" />Consultar estorno</DropdownMenuItem>}
                          {order.venda?.id && ["ENVIO", "ENVIADO", "ENTREGUE"].includes(order.venda.status_entrega || "") && !order.return_received_at ? (
                            <DropdownMenuItem onSelect={() => { setReturnOrder(order); setReturnReason(""); setReturnTracking(""); setReturnApproved(false); }}>
                              <PackageCheck className="h-4 w-4" />{order.return_requested_at ? "Conferir recebimento da devolução" : "Solicitar devolução física"}
                            </DropdownMenuItem>
                          ) : null}
                          {order.return_received_at && order.refund_status !== "REFUNDED" && (!order.refund_requested_at || order.refund_status === "DENIED") ? (
                            <DropdownMenuItem onSelect={() => { setCancelOrder(order); setCancelReason("Devolução integral recebida e conferida"); }}><Undo2 className="h-4 w-4" />Reembolsar devolução recebida</DropdownMenuItem>
                          ) : null}
                          {order.refund_request_url && order.refund_status !== "REFUNDED" ? (
                            <>
                              <DropdownMenuItem asChild><a href={order.refund_request_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />Abrir formulário de reembolso do boleto</a></DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(order.refund_request_url!).then(() => toast.success("Link copiado. Envie ao cliente para preencher os dados."), () => toast.error("Não foi possível copiar. Abra o formulário e copie o endereço.")); }}><Copy className="h-4 w-4" />Copiar link para o cliente</DropdownMenuItem>
                            </>
                          ) : null}
                          {order.venda?.id ? <><DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href="/historicovendas">
                              <ExternalLink className="h-4 w-4" /> Abrir histórico de vendas
                            </Link>
                          </DropdownMenuItem></> : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
                })}
                {!loading && !orders.length ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="flex min-h-40 flex-col items-center justify-center text-center">
                        <ClipboardList className="mb-3 h-7 w-7 text-muted-foreground" />
                        <p className="text-sm font-medium">
                          Nenhuma compra encontrada
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Use “Sincronizar pedidos” para buscar as compras pagas
                          na loja.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <MarketplacePagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            total={total}
            visible={orders.length}
            onPageChange={setPage}
            onPageSizeChange={(value) => {
              setPageSize(value);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedOrder)}
        onOpenChange={(open) => {
          if (!open) setSelectedOrder(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atualizar andamento do pedido</DialogTitle>
            <DialogDescription>
              {selectedIsPickup
                ? "Atualize a preparação e a retirada do pedido #"
                : "A etapa, a NF-e e o rastreio serão enviados para o pedido #"}
              {selectedOrder?.site_order_id} na loja.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="site-delivery-status">Etapa do pedido</Label>
              <Select
                value={shipment.deliveryStatus}
                onValueChange={(value) =>
                  setShipment((current) => ({
                    ...current,
                    deliveryStatus: value as typeof current.deliveryStatus,
                  }))
                }
              >
                <SelectTrigger id="site-delivery-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SEPARACAO">Em separação</SelectItem>
                  <SelectItem value="FATURADO">Faturado / NF-e emitida</SelectItem>
                  <SelectItem value="ENVIADO">{selectedIsPickup ? "Pronto para retirada" : "Enviado"}</SelectItem>
                  <SelectItem value="ENTREGUE">{selectedIsPickup ? "Retirado pelo cliente" : "Entregue"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!selectedIsPickup ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="site-carrier">Transportadora</Label>
                  <Input
                    id="site-carrier"
                    value={shipment.carrier}
                    onChange={(event) => setShipment((current) => ({ ...current, carrier: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="site-tracking">Código de rastreio/postagem</Label>
                  <Input
                    id="site-tracking"
                    value={shipment.trackingCode}
                    onChange={(event) => setShipment((current) => ({ ...current, trackingCode: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="site-tracking-url">Link de acompanhamento (opcional)</Label>
                  <Input
                    id="site-tracking-url"
                    type="url"
                    placeholder="https://..."
                    value={shipment.trackingUrl}
                    onChange={(event) => setShipment((current) => ({ ...current, trackingUrl: event.target.value }))}
                  />
                </div>
              </>
            ) : (
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                Este pedido será retirado no local. Transportadora e código de postagem não são necessários.
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Se a venda já possuir uma NF-e autorizada, número, série e chave
              de acesso também serão enviados à loja.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedOrder(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void saveShipment()}
              disabled={savingShipment}
            >
              {savingShipment ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Atualizar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VendaDetailsDialog
        vendaId={editingSaleId}
        open={editingSaleId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingSaleId(null);
        }}
        onSaved={() => void loadOrders()}
      />

      <EmissaoNotaDialog
        vendaId={invoiceSaleId}
        open={invoiceSaleId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInvoiceSaleId(null);
            void loadOrders();
          }
        }}
      />
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="flex h-[85dvh] max-h-[850px] w-[calc(100vw-1rem)] flex-col overflow-hidden !gap-0 p-0 sm:w-[95vw] md:max-w-[1000px]">
          <DialogHeader className="shrink-0 border-b bg-background/95 px-5 py-4 pr-12 text-left">
            <DialogTitle className="flex flex-wrap items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" />Pedido do Site #{detailsOrder?.site_order_id}{detailsOrder ? <FulfillmentBadge order={detailsOrder} /> : null}</DialogTitle>
            <DialogDescription>Dados do pedido e marcos registrados de acompanhamento.</DialogDescription>
          </DialogHeader>
          {detailsOrder ? <Tabs key={detailsOrder.site_order_id} defaultValue="summary" className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden bg-muted/25 text-sm [&_dt]:text-xs [&_dt]:font-medium [&_dd]:mt-1 [&_dd]:font-semibold [&_[data-slot=tabs-content]]:min-h-0 [&_[data-slot=tabs-content]]:flex-1 [&_[data-slot=tabs-content]]:overflow-y-auto [&_[data-slot=tabs-content]]:overscroll-contain [&_[data-slot=tabs-content]]:m-4 sm:[&_[data-slot=tabs-content]]:m-6">
            <div className="shrink-0 border-b bg-background px-4 py-3 sm:px-6"><TabsList className="flex h-auto w-full justify-start gap-1.5 overflow-x-auto rounded-2xl border bg-muted/90 p-1 shadow-sm [&_[data-slot=tabs-trigger]]:h-8 [&_[data-slot=tabs-trigger]]:shrink-0 [&_[data-slot=tabs-trigger]]:flex-none [&_[data-slot=tabs-trigger]]:rounded-xl [&_[data-slot=tabs-trigger]]:px-3 [&_[data-slot=tabs-trigger]]:text-xs [&_[data-slot=tabs-trigger][data-state=active]]:bg-primary [&_[data-slot=tabs-trigger][data-state=active]]:text-primary-foreground"><TabsTrigger value="summary"><User className="h-4 w-4" />Resumo</TabsTrigger><TabsTrigger value="delivery"><MapPin className="h-4 w-4" />Entrega</TabsTrigger><TabsTrigger value="payment"><CreditCard className="h-4 w-4" />Pagamento</TabsTrigger><TabsTrigger value="history"><History className="h-4 w-4" />Histórico</TabsTrigger></TabsList></div>
            <TabsContent value="summary" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4"><div><p className="text-xs font-medium text-muted-foreground">Cliente do pedido</p><p className="mt-1 text-lg font-semibold">{detailsOrder.venda?.cliente?.nomerazaosocial || detailsOrder.customer?.name || "Não informado"}</p></div><div><p className="text-xs text-muted-foreground">Total do pedido</p><p className="text-xl font-bold text-primary">{formatMoney(detailsOrder.total_amount)}</p></div></div>
            <dl className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-muted-foreground">Cliente</dt><dd>{detailsOrder.venda?.cliente?.nomerazaosocial || detailsOrder.customer?.name || "Não informado"}</dd></div>
              <div><dt className="text-muted-foreground">CPF/CNPJ</dt><dd>{detailsOrder.venda?.cliente?.cpfcnpj || detailsOrder.customer?.document || "Não informado"}</dd></div>
              <div><dt className="text-muted-foreground">E-mail</dt><dd className="break-all">{detailsOrder.venda?.cliente?.email || detailsOrder.customer?.email || "Não informado"}</dd></div>
              <div><dt className="text-muted-foreground">Telefone</dt><dd>{detailsOrder.venda?.cliente?.telefone || detailsOrder.customer?.phone || "Não informado"}</dd></div>
              <div><dt className="text-muted-foreground">Total</dt><dd>{formatMoney(detailsOrder.total_amount)}</dd></div>
              <div><dt className="text-muted-foreground">Andamento</dt><dd>{siteStatusLabel(detailsOrder.venda?.status_entrega)}</dd></div>
              <div><dt className="text-muted-foreground">Estorno</dt><dd>{siteStatusLabel(detailsOrder.refund_status, "Sem solicitação")}</dd></div>
            </dl>
            <div className="rounded-lg border bg-card p-4"><p className="font-medium">Produtos</p><ul className="mt-3 divide-y">{detailsOrder.returnItems?.length ? detailsOrder.returnItems.map((item, index) => <li className="flex flex-wrap justify-between gap-2 py-3" key={`${item.productId}-${index}`}><div>{item.quantity} × {item.title}<p className="text-xs text-muted-foreground">{item.reference || `Produto #${item.productId}`}</p></div><span>{item.total != null ? formatMoney(item.total) : ""}</span></li>) : <li>Itens não disponíveis no vínculo do pedido.</li>}</ul></div>
            </TabsContent>
            <TabsContent value="delivery" className="space-y-4"><div className="rounded-lg border bg-card p-4"><h3 className="mb-4 flex items-center gap-2 border-b pb-3 font-semibold"><MapPin className="h-4 w-4 text-primary" />{detailsOrder.delivery?.label || "Entrega"}</h3><dl className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><dt className="text-muted-foreground">Endereço</dt><dd>{formatDeliveryAddress(detailsOrder)}</dd></div><div><dt className="text-muted-foreground">Complemento</dt><dd>{detailsOrder.delivery?.address?.complement || "Não informado"}</dd></div><div><dt className="text-muted-foreground">CEP</dt><dd>{detailsOrder.delivery?.address?.zipCode || "Não informado"}</dd></div><div><dt className="text-muted-foreground">Transportadora</dt><dd>{detailsOrder.venda?.transportadora_rastreio || "Não informada"}</dd></div><div><dt className="text-muted-foreground">Rastreio</dt><dd className="break-all">{detailsOrder.venda?.codigo_rastreio || "Não informado"}</dd></div></dl></div><div className="rounded-lg border bg-card p-4"><h3 className="mb-4 flex items-center gap-2 border-b pb-3 font-semibold"><Undo2 className="h-4 w-4 text-primary" />Devolução física</h3><dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-muted-foreground">Rastreio reverso</dt><dd className="break-all">{detailsOrder.reverse_tracking || "Não informado"}</dd></div><div><dt className="text-muted-foreground">Motivo</dt><dd>{detailsOrder.return_reason || "Sem solicitação"}</dd></div></dl></div></TabsContent>
            <TabsContent value="payment" className="space-y-4 rounded-lg border bg-card p-4">
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 border-b pb-3 font-semibold"><CreditCard className="h-4 w-4 text-primary" />{detailsOrder.checkout_pending ? "Pagamento" : "Pagamento e reembolso"}</h3>
              {detailsOrder.checkout_pending ? <div className="space-y-2 rounded-md bg-muted p-3"><FulfillmentBadge order={detailsOrder} /><p className="text-xs text-muted-foreground">{detailsOrder.stock_release_pending ? "Cancelamento em processamento. O estoque será liberado após a conferência da cobrança." : detailsOrder.site_status === "CANCELADO" ? "Compra cancelada. Não foi gerada uma venda." : "A compra ainda não gerou uma venda no ERP. A confirmação do pagamento atualiza esta lista automaticamente."}</p></div> : null}
              {detailsOrder.payment_due_date ? <p><span className="text-muted-foreground">Vencimento: </span>{formatDueDate(detailsOrder.payment_due_date)}</p> : null}
              <dl className="grid grid-cols-2 gap-4"><div><dt className="text-muted-foreground">Forma de pagamento</dt><dd>{paymentMethodLabel(detailsOrder.paymentMethod) || "Não informada"}</dd></div><div><dt className="text-muted-foreground">Total do pedido</dt><dd className="text-lg font-semibold">{formatMoney(detailsOrder.total_amount)}</dd></div>{detailsOrder.subtotal != null ? <div><dt className="text-muted-foreground">Subtotal</dt><dd>{formatMoney(detailsOrder.subtotal)}</dd></div> : null}<div><dt className="text-muted-foreground">NF-e</dt><dd>{detailsOrder.invoice ? `${siteStatusLabel(detailsOrder.invoice.status, "Pendente")} · Nº ${detailsOrder.invoice.numero || "—"}` : "Não emitida"}</dd></div></dl>
              {!detailsOrder.checkout_pending ? <><dl className="grid gap-3 sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Provedor</dt><dd>{detailsOrder.payment_provider || "Não informado"}</dd></div>
                <div><dt className="text-muted-foreground">Identificador da cobrança</dt><dd className="break-all">{detailsOrder.gateway_payment_id || "Não informado"}</dd></div>
                <div><dt className="text-muted-foreground">Situação do reembolso</dt><dd>{siteStatusLabel(detailsOrder.refund_status, "Sem solicitação")}</dd></div>
                <div><dt className="text-muted-foreground">Última consulta</dt><dd>{detailsOrder.refund_checked_at ? new Date(detailsOrder.refund_checked_at).toLocaleString("pt-BR") : "Ainda não consultado"}</dd></div>
              </dl>
              {detailsOrder.refund_status ? <Button variant="outline" size="sm" onClick={() => void checkRefund(detailsOrder)}>Consultar estorno</Button> : null}</> : null}
              {detailsOrder.checkout_pending && detailsOrder.site_status!=="CANCELADO" ? <Button variant="outline" size="sm" disabled={syncing} onClick={() => void reconcilePayment()}>{syncing ? "Conferindo…" : "Conferir pagamento"}</Button> : null}
              {detailsOrder.refund_request_url && detailsOrder.refund_status !== "REFUNDED" ? <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <p>Formulário do boleto: o cliente precisa preencher os dados solicitados. O link não confirma a devolução do dinheiro.</p>
                <p className="break-all text-xs">{detailsOrder.refund_request_url}</p>
                <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" asChild><a href={detailsOrder.refund_request_url} target="_blank" rel="noopener noreferrer">Abrir formulário</a></Button><Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(detailsOrder.refund_request_url!).then(() => toast.success("Link copiado para enviar ao cliente."), () => toast.error("Não foi possível copiar o link.")); }}>Copiar link</Button></div>
              </div> : null}
            </div>
            </TabsContent><TabsContent value="history" className="space-y-4 rounded-lg border bg-card p-4">
            <div className="space-y-3"><p className="font-medium">Operações do pedido</p>{detailsOrder.checkout_pending ? <p className="text-muted-foreground">{detailsOrder.site_status === "CANCELADO" ? "Compra encerrada. Consulte abaixo as datas registradas." : "Emissão de nota, separação e entrega ficam disponíveis após a confirmação do pagamento e a criação da venda."}</p> : null}<div className="flex flex-wrap gap-2">
              {!detailsOrder.return_requested_at && !detailsOrder.refund_requested_at && detailsOrder.site_status !== "CANCELADO" && detailsOrder.venda?.id && !["CANCELADA", "CANCELADO"].includes(detailsOrder.venda.status || "") ? <Button variant="outline" size="sm" onClick={() => { setDetailsOpen(false); openShipment(detailsOrder); }}>Atualizar andamento</Button> : null}
              {detailsOrder.venda?.id && !["CANCELADA", "CANCELADO"].includes(detailsOrder.venda.status || "") && detailsOrder.refund_status !== "REFUNDED" && (!detailsOrder.refund_requested_at || detailsOrder.refund_status === "DENIED") && (!["ENVIO", "ENVIADO", "ENTREGUE"].includes(detailsOrder.venda.status_entrega || "") || detailsOrder.return_received_at) ? <Button variant="destructive" size="sm" onClick={() => { setDetailsOpen(false); setCancelOrder(detailsOrder); setCancelReason(detailsOrder.return_received_at ? "Devolução integral recebida e conferida" : ""); }}> {detailsOrder.return_received_at ? "Reembolsar devolução" : detailsOrder.refund_status === "DENIED" ? "Tentar estorno novamente" : "Cancelar e estornar"}</Button> : null}
              {detailsOrder.venda?.id && ["ENVIO", "ENVIADO", "ENTREGUE"].includes(detailsOrder.venda.status_entrega || "") && !detailsOrder.return_received_at ? <Button variant="outline" size="sm" onClick={() => { setDetailsOpen(false); setReturnOrder(detailsOrder); setReturnReason(""); setReturnTracking(""); setReturnApproved(false); }}>{detailsOrder.return_requested_at ? "Conferir recebimento" : "Solicitar devolução"}</Button> : null}
              {detailsOrder.venda?.id ? <Button variant="outline" size="sm" onClick={() => { setDetailsOpen(false); setInvoiceSaleId(detailsOrder.venda!.id); }}>Gerenciar NF-e</Button> : null}
            </div></div>
            <div><p className="font-medium">Datas registradas</p><ul className="mt-1 space-y-1">{([
              [detailsOrder.checkout_pending ? "Compra iniciada" : "Pedido criado", detailsOrder.order_created_at], ["Última atualização da compra", detailsOrder.checkout_updated_at], ["Última conferência do pagamento", detailsOrder.payment_checked_at], ["Cancelamento do registro do boleto", detailsOrder.bank_cancelled_at], ["Última sincronização", detailsOrder.last_synced_at],
              ["Devolução solicitada", detailsOrder.return_requested_at], ["Recebimento conferido", detailsOrder.return_received_at], ["Estorno solicitado", detailsOrder.refund_requested_at],
            ] as const).filter(([, date]) => date).map(([label, date]) => <li key={label}>{label}: {new Date(date!).toLocaleString("pt-BR")}</li>)}</ul></div>
            {detailsOrder.return_reason ? <p>Motivo da devolução: {detailsOrder.return_reason}</p> : null}
            {detailsOrder.return_inspection_note ? <p>Conferência do recebimento: {detailsOrder.return_inspection_note}</p> : null}
            {detailsOrder.refund_reason ? <p>Motivo do estorno: {detailsOrder.refund_reason}</p> : null}
            {detailsOrder.refund_denial_reason ? <p className="text-destructive">Recusa: {detailsOrder.refund_denial_reason}</p> : null}
            {detailsOrder.import_error ? <p className="text-destructive">Erro de importação: {detailsOrder.import_error}</p> : null}
            {detailsOrder.nextAction ? <p className="rounded-md bg-muted p-3">Próxima ação: {detailsOrder.nextAction}</p> : null}
            </TabsContent>
          </Tabs> : null}
          <DialogFooter className="shrink-0 border-t bg-background px-5 py-3"><Button variant="outline" onClick={() => setDetailsOpen(false)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(cancelOrder)} onOpenChange={open => { if (!open && !canceling) setCancelOrder(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancelar pedido #{cancelOrder?.site_order_id}</DialogTitle>
            <DialogDescription>Solicitar estorno integral no Asaas e devolver os itens ao estoque após a confirmação. Caso haja NF-e autorizada, cancele-a antes.</DialogDescription></DialogHeader>
          <Label htmlFor="site-cancel-reason">Motivo do cancelamento</Label>
          <Input id="site-cancel-reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} maxLength={500} disabled={canceling} />
          <DialogFooter><Button variant="outline" onClick={() => setCancelOrder(null)} disabled={canceling}>Voltar</Button>
            <Button variant="destructive" disabled={canceling || cancelReason.trim().length < 3} onClick={() => void confirmCancellation()}>{canceling ? "Processando..." : "Confirmar estorno"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(returnOrder)} onOpenChange={open => { if (!open && !returnSaving) setReturnOrder(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{returnOrder?.return_requested_at ? "Conferir devolução recebida" : "Solicitar devolução física"} #{returnOrder?.site_order_id}</DialogTitle>
            <DialogDescription>Fluxo integral: todos os itens devem voltar e ser aprovados. Itens danificados ou devolução parcial precisam de tratamento separado. O estoque será reposto após a confirmação do reembolso.</DialogDescription></DialogHeader>
          <ul className="space-y-1 text-sm">{returnOrder?.returnItems?.map((item, index) => <li key={`${item.productId}-${index}`}>{item.quantity} × {item.title}</li>)}</ul>
          <Label htmlFor="return-reason">{returnOrder?.return_requested_at ? "Resultado da conferência" : "Motivo da devolução"}</Label>
          <Input id="return-reason" value={returnReason} onChange={e => setReturnReason(e.target.value)} maxLength={500} disabled={returnSaving} />
          {!returnOrder?.return_requested_at ? <><Label htmlFor="reverse-tracking">Rastreio do frete reverso (opcional)</Label><Input id="reverse-tracking" value={returnTracking} onChange={e => setReturnTracking(e.target.value)} maxLength={160} disabled={returnSaving} /></> : (
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={returnApproved} disabled={returnSaving} onChange={e => setReturnApproved(e.target.checked)} />Confirmo que todos os produtos e quantidades acima foram recebidos e estão aptos a retornar ao estoque.</label>
          )}
          <DialogFooter><Button variant="outline" disabled={returnSaving} onClick={() => setReturnOrder(null)}>Voltar</Button><Button disabled={returnSaving || returnReason.trim().length < 3 || Boolean(returnOrder?.return_requested_at && !returnApproved)} onClick={() => void saveReturn()}>{returnSaving ? "Salvando..." : returnOrder?.return_requested_at ? "Confirmar recebimento" : "Registrar solicitação"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Summary({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Truck;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 border-b border-r px-3 py-3 xl:border-b-0 xl:last:border-r-0">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
      <Icon className="h-4 w-4 shrink-0 text-sky-600 sm:h-5 sm:w-5" />
    </div>
  );
}

function ImportBadge({ status }: { status: SiteOrder["import_status"] }) {
  if (status === "IMPORTADA")
    return (
      <Badge
        variant="outline"
        className="mt-1 border-emerald-600/30 text-emerald-700"
      >
        Importado
      </Badge>
    );
  if (status === "ERRO")
    return (
      <Badge variant="destructive" className="mt-1">
        Erro
      </Badge>
    );
  return (
    <Badge variant="secondary" className="mt-1">
      {status === "PROCESSANDO" ? "Processando" : "Pendente"}
    </Badge>
  );
}

function FulfillmentBadge({ order }: { order: SiteOrder }) {
  if(order.checkout_pending){
    const labels:Record<string,string>={AGUARDANDO_PAGAMENTO:'Aguardando pagamento',PAGAMENTO_EM_ANALISE:'Pagamento em análise',REVISAO_NECESSARIA:'Pagamento em revisão',PAGAMENTO_CONFIRMADO:'Pago · aguardando importação',CANCELADO:'Cancelado'};
    return <Badge variant={order.site_status==='REVISAO_NECESSARIA'?'destructive':'secondary'}>{labels[order.site_status]||'Aguardando pagamento'}</Badge>;
  }
  if (order.refund_status === "AWAITING_CRITICAL_ACTION_AUTHORIZATION") return <Badge variant="outline">Estorno: autorizar no Asaas</Badge>;
  if (order.refund_status === "AWAITING_CUSTOMER") return <Badge variant="outline">Boleto: aguardando dados do cliente</Badge>;
  if (order.return_received_at && order.refund_status !== "REFUNDED") return <Badge variant="outline">Devolução recebida · reembolso pendente</Badge>;
  if (order.return_requested_at && !order.return_received_at) return <Badge variant="outline">Aguardando devolução física</Badge>;
  if (order.refund_status === "DENIED") return <Badge variant="destructive" title={order.refund_denial_reason || "Estorno recusado pelo Asaas"}>Estorno recusado</Badge>;
  if(order.refund_requested_at && order.refund_status !== "REFUNDED") return <Badge variant="outline">Estorno: {order.refund_status === "REFUND_REQUESTED" || order.refund_status === "REFUND_IN_PROGRESS" ? "Em processamento" : order.refund_status === "REQUESTING" ? "Solicitando" : ["RECEIVED", "CONFIRMED"].includes(order.refund_status || "") ? "Verificar solicitação" : "Aguardando confirmação"}</Badge>;
  if (["CANCELADA", "CANCELADO"].includes(order.venda?.status || "")) return <Badge variant="destructive">Cancelado</Badge>;
  const pickup = order.delivery?.method === "pickup";
  if (order.venda?.status_entrega === "ENTREGUE") {
    return <Badge className="bg-emerald-600 text-white">{pickup ? "Retirado" : "Entregue"}</Badge>;
  }
  if (order.venda?.status_entrega === "ENVIO" || order.venda?.codigo_rastreio) {
    return <Badge variant="outline">{pickup ? "Pronto para retirada" : "Enviado"}</Badge>;
  }
  if (order.invoice?.chave_acesso) {
    return <Badge variant="outline">Faturado</Badge>;
  }
  return <Badge variant="secondary">Em separação</Badge>;
}

function formatDeliveryAddress(order: SiteOrder) {
  const address = order.delivery?.address;
  if (!address) return "Endereço não informado";
  return [
    [address.street, address.number].filter(Boolean).join(", "),
    address.neighborhood,
    [address.city, address.state].filter(Boolean).join("/"),
  ].filter(Boolean).join(" · ") || "Endereço não informado";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}
function formatDate(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
}

function paymentMethodLabel(method?:string|null) {
  const labels:Record<string,string>={PIX:'Pix',BOLETO:'Boleto',CREDIT_CARD:'Cartão de crédito'};
  return method ? labels[method]||'Outra forma de pagamento' : 'Não informada';
}
function formatDueDate(value:string) {
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('/');
  return formatDate(value);
}
