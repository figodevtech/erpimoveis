"use client";
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
  refund_status?: string | null;
  refund_request_url?: string | null;
  return_requested_at?: string | null;
  return_received_at?: string | null;
  returnItems?: Array<{ productId: number; quantity: number; title: string }>;
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
        `/api/integracoes/site/orders?page=${page}&limit=${pageSize}`,
        { cache: "no-store" },
      );
      const json = await readJsonResponse(response, "ERP");
      if (!response.ok)
        throw new Error(json?.error || "Falha ao carregar pedidos.");
      setOrders(json.data || []);
      setTotal(json.pagination?.total ?? json.count ?? 0);
      setTotalPages(json.pagination?.totalPages ?? 1);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao carregar pedidos.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

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

  async function checkRefund(order: SiteOrder) {
    try {
      const response = await fetch(`/api/integracoes/site/orders/${order.site_order_id}`, {cache:"no-store"});
      const result = await readJsonResponse(response, "ERP");
      if(!response.ok) throw new Error(result.error || "Falha ao consultar estorno.");
      toast.info(result.refundStatus === "AWAITING_CRITICAL_ACTION_AUTHORIZATION" ? "Reembolso aguarda autorizacao na conta Asaas da Demir. Autorize a acao pendente; nao solicite outro estorno." : result.refundStatus === "DENIED" ? `Estorno recusado: ${result.denialReason || "Motivo nao informado"}. Nenhum estoque foi devolvido.` : result.gatewayStatus === "REFUNDED" ? result.requiresPhysicalReturn ? "Estorno confirmado. Estoque aguarda devolução física conferida." : "Estorno confirmado e estoque devolvido." : result.requestedAt && ["RECEIVED", "CONFIRMED"].includes(result.gatewayStatus) ? "Solicitação registrada, mas o pagamento continua recebido. O reembolso precisa de verificação antes de nova tentativa." : result.requestedAt ? `Estorno solicitado. Status Asaas: ${result.gatewayStatus}` : `Nenhum estorno solicitado. Status Asaas: ${result.gatewayStatus}`);
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
    });
  }, [loadOrders, loading, onActionsChange, syncOrders, syncing, total]);

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
                  <TableHead>Entrega</TableHead>
                  <TableHead>Nota fiscal</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="block md:table-row-group">
                {orders.map((order) => {
                  const actionsBlocked = Boolean(order.return_requested_at || order.refund_requested_at) || order.refund_status === "REFUNDED" || order.site_status === "CANCELADO" || ["CANCELADA", "CANCELADO"].includes(order.venda?.status || "");
                  return (
                  <TableRow key={order.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 p-3 md:table-row md:p-0">
                    <TableCell className="block p-0 md:table-cell md:p-2">
                      <p className="font-medium">Site #{order.site_order_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(order.order_created_at)}
                      </p>
                      <ImportBadge status={order.import_status} />
                    </TableCell>
                    <TableCell className="col-span-2 row-start-2 block min-w-0 p-0 md:table-cell md:p-2">
                      <p className="max-w-56 truncate">
                        {order.venda?.cliente?.nomerazaosocial || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Venda ERP{" "}
                        {order.venda?.id ? `#${order.venda.id}` : "pendente"}
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
                    </TableCell>
                    <TableCell className="block p-0 md:table-cell md:p-2">
                      <span className="mr-2 text-xs text-muted-foreground md:hidden">NF-e</span>
                      {order.invoice?.chave_acesso ? (
                        <>
                          <Badge
                            variant="outline"
                            className="border-emerald-600/30 text-emerald-700"
                          >
                            {order.invoice.status || "Emitida"}
                          </Badge>
                          <p className="mt-1 text-xs">
                            NF-e {order.invoice.numero || "—"}
                          </p>
                        </>
                      ) : (
                        <Badge variant="secondary">Pendente</Badge>
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
                          <DropdownMenuItem
                            disabled={!order.venda?.id || Boolean(order.refund_requested_at) || order.refund_status === "REFUNDED" || ["CANCELADA", "CANCELADO"].includes(order.venda?.status || "") || ["ENVIO", "ENVIADO", "ENTREGUE"].includes(order.venda?.status_entrega || "")}
                            onSelect={() => { setCancelOrder(order); setCancelReason(""); }}
                            className="text-destructive"
                          >{["ENVIO", "ENVIADO", "ENTREGUE"].includes(order.venda?.status_entrega || "") ? "Estorno exige devolução conferida" : "Cancelar e estornar"}</DropdownMenuItem>
                            </>
                          ) : null}
                          {order.refund_status === "DENIED" && order.venda?.id && !["CANCELADA", "CANCELADO"].includes(order.venda.status || "") && !["ENVIO", "ENVIADO", "ENTREGUE"].includes(order.venda.status_entrega || "") ? (
                            <DropdownMenuItem className="text-destructive" onSelect={() => { setCancelOrder(order); setCancelReason(""); }}>
                              Tentar estorno novamente
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onSelect={() => void checkRefund(order)}>Consultar estorno</DropdownMenuItem>
                          {order.venda?.id && ["ENVIO", "ENVIADO", "ENTREGUE"].includes(order.venda.status_entrega || "") && !order.return_received_at ? (
                            <DropdownMenuItem onSelect={() => { setReturnOrder(order); setReturnReason(""); setReturnTracking(""); setReturnApproved(false); }}>
                              {order.return_requested_at ? "Conferir recebimento da devolução" : "Solicitar devolução física"}
                            </DropdownMenuItem>
                          ) : null}
                          {order.return_received_at && order.refund_status !== "REFUNDED" && (!order.refund_requested_at || order.refund_status === "DENIED") ? (
                            <DropdownMenuItem onSelect={() => { setCancelOrder(order); setCancelReason("Devolução integral recebida e conferida"); }}>Reembolsar devolução recebida</DropdownMenuItem>
                          ) : null}
                          {order.refund_request_url && order.refund_status !== "REFUNDED" ? (
                            <>
                              <DropdownMenuItem asChild><a href={order.refund_request_url} target="_blank" rel="noopener noreferrer">Abrir formulário de reembolso do boleto</a></DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(order.refund_request_url!).then(() => toast.success("Link copiado. Envie ao cliente para preencher os dados."), () => toast.error("Não foi possível copiar. Abra o formulário e copie o endereço.")); }}>Copiar link para o cliente</DropdownMenuItem>
                            </>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href="/historicovendas">
                              <ExternalLink className="h-4 w-4" /> Abrir histórico de vendas
                            </Link>
                          </DropdownMenuItem>
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
                          Nenhum pedido importado
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
