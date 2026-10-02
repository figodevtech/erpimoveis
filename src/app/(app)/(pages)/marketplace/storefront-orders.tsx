"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  ExternalLink,
  Loader2,
  PackageCheck,
  ReceiptText,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MarketplacePagination } from "./marketplace-layout";

type SiteOrder = {
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
  const [orders, setOrders] = useState<SiteOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<SiteOrder | null>(null);
  const [savingShipment, setSavingShipment] = useState(false);
  const [shipment, setShipment] = useState({
    carrier: "Correios",
    trackingCode: "",
    trackingUrl: "",
  });

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/integracoes/site/orders?page=${page}&limit=${pageSize}`,
        { cache: "no-store" },
      );
      const json = await response.json();
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

  const syncOrders = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const response = await fetch("/api/integracoes/site/orders", {
        method: "POST",
      });
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || "Falha ao sincronizar pedidos.");
      toast.success("Pedidos sincronizados", {
        description: `${json.imported || 0} novo(s) pedido(s) importado(s) e ${json.errors || 0} erro(s).`,
      });
      await loadOrders();
    } catch (requestError) {
      toast.error("Erro ao sincronizar pedidos", {
        description:
          requestError instanceof Error
            ? requestError.message
            : "Tente novamente.",
      });
    } finally {
      setSyncing(false);
    }
  }, [loadOrders, syncing]);

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
      carrier: order.venda?.transportadora_rastreio || "Correios",
      trackingCode: order.venda?.codigo_rastreio || "",
      trackingUrl: "",
    });
  }

  async function saveShipment() {
    if (
      !selectedOrder ||
      !shipment.carrier.trim() ||
      !shipment.trackingCode.trim()
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
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || "Falha ao registrar postagem.");
      toast.success("Postagem enviada para a loja", {
        description: json.invoiceSent
          ? "Rastreio e dados da NF-e foram atualizados no pedido."
          : "Rastreio atualizado. A NF-e será enviada quando estiver autorizada.",
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
    (order) => order.venda && !order.venda.codigo_rastreio,
  ).length;
  const invoiced = orders.filter((order) => order.invoice?.chave_acesso).length;

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
          <div className="grid grid-cols-1 overflow-hidden rounded-lg border sm:grid-cols-3">
            <Summary label="Importados" value={imported} icon={PackageCheck} />
            <Summary
              label="Aguardando postagem"
              value={awaitingShipment}
              icon={Truck}
            />
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
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Entrega</TableHead>
                  <TableHead>Nota fiscal</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <p className="font-medium">Site #{order.site_order_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(order.order_created_at)}
                      </p>
                      <ImportBadge status={order.import_status} />
                    </TableCell>
                    <TableCell>
                      <p className="max-w-56 truncate">
                        {order.venda?.cliente?.nomerazaosocial || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Venda ERP{" "}
                        {order.venda?.id ? `#${order.venda.id}` : "pendente"}
                      </p>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatMoney(order.total_amount)}
                    </TableCell>
                    <TableCell>
                      {order.venda?.codigo_rastreio ? (
                        <>
                          <Badge variant="outline">Enviado</Badge>
                          <p className="mt-1 font-mono text-xs">
                            {order.venda.codigo_rastreio}
                          </p>
                        </>
                      ) : (
                        <Badge variant="secondary">Em separação</Badge>
                      )}
                    </TableCell>
                    <TableCell>
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
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="ghost">
                          <Link href="/historicovendas">
                            <ExternalLink className="mr-1 h-4 w-4" /> Venda
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openShipment(order)}
                          disabled={!order.venda?.id}
                        >
                          <Truck className="mr-1 h-4 w-4" /> Postagem
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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
            <DialogTitle>Registrar postagem</DialogTitle>
            <DialogDescription>
              O rastreio será salvo na venda e enviado para o pedido #
              {selectedOrder?.site_order_id} na loja.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="site-carrier">Transportadora</Label>
              <Input
                id="site-carrier"
                value={shipment.carrier}
                onChange={(event) =>
                  setShipment((current) => ({
                    ...current,
                    carrier: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="site-tracking">Código de rastreio/postagem</Label>
              <Input
                id="site-tracking"
                value={shipment.trackingCode}
                onChange={(event) =>
                  setShipment((current) => ({
                    ...current,
                    trackingCode: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="site-tracking-url">
                Link de acompanhamento (opcional)
              </Label>
              <Input
                id="site-tracking-url"
                type="url"
                placeholder="https://..."
                value={shipment.trackingUrl}
                onChange={(event) =>
                  setShipment((current) => ({
                    ...current,
                    trackingUrl: event.target.value,
                  }))
                }
              />
            </div>
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
              Salvar e enviar
            </Button>
          </DialogFooter>
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
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
      <Icon className="h-5 w-5 text-sky-600" />
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
