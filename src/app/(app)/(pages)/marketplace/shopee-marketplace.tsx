"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Link2, Loader2, PackageSearch, RefreshCcw, Settings2, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import { MarketplaceChannelSwitcher } from "./marketplace-channel";

type Dashboard = {
  accounts: Array<{ id: number; shop_id: number; shop_name?: string | null; region: string; expires_at?: string | null; updated_at?: string | null }>;
  orders: Array<{ id: number; venda_id?: number | null; order_sn: string; status?: string | null; buyer_username?: string | null; currency?: string | null; total_amount?: number | null; tracking_number?: string | null; shipping_carrier?: string | null; create_time?: string | null; import_status?: string | null; import_error?: string | null }>;
  links: Array<{ id: number; produto_id: number; item_id: number; model_id?: number | null; title?: string | null; item_sku?: string | null; model_sku?: string | null }>;
  configuration: { ready: boolean; missing: string[] };
};

type Product = { id: number; titulo: string; referencia?: string | null };
type ShopeeTab = "overview" | "orders" | "catalog";

export default function ShopeeMarketplace() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<ShopeeTab>("overview");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [linkForm, setLinkForm] = useState({ produtoId: "", itemId: "", modelId: "", itemSku: "", modelSku: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardResponse, productResponse] = await Promise.all([
        fetch("/api/integracoes/shopee/dashboard", { cache: "no-store" }),
        fetch("/api/products/select?page=1&limit=100", { cache: "no-store" }),
      ]);
      const dashboard = await dashboardResponse.json();
      if (!dashboardResponse.ok) throw new Error(dashboard.error || "Falha ao carregar Shopee.");
      setData(dashboard);
      if (productResponse.ok) setProducts((await productResponse.json()).data ?? []);
    } catch (error: any) {
      toast.error("Erro ao carregar Shopee", { description: error?.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function syncOrders() {
    setSyncing(true);
    try {
      const response = await fetch("/api/integracoes/shopee/sync-orders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 15 }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao sincronizar pedidos.");
      toast.success("Pedidos Shopee sincronizados", { description: `${json.created || 0} nova(s) venda(s) importada(s).` });
      await load();
    } catch (error: any) {
      toast.error("Erro na sincronização Shopee", { description: error?.message });
    } finally {
      setSyncing(false);
    }
  }

  async function saveLink() {
    setSavingLink(true);
    try {
      const product = products.find((row) => String(row.id) === linkForm.produtoId);
      const response = await fetch("/api/integracoes/shopee/product-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...linkForm, title: product?.titulo }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao salvar vínculo.");
      toast.success("Produto vinculado à Shopee");
      setLinkForm({ produtoId: "", itemId: "", modelId: "", itemSku: "", modelSku: "" });
      await load();
    } catch (error: any) {
      toast.error("Erro ao vincular produto", { description: error?.message });
    } finally {
      setSavingLink(false);
    }
  }

  const account = data?.accounts[0];
  const importErrors = useMemo(() => (data?.orders ?? []).filter((order) => order.import_error).length, [data?.orders]);

  return (
    <div className="mx-auto space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-card shadow-sm">
            <ShoppingBag className="h-5 w-5 text-orange-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Marketplace</h1>
            <p className="truncate text-sm text-muted-foreground">Pedidos, catálogo e operação da sua loja Shopee.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <MarketplaceChannelSwitcher />
          <div className="flex min-w-0 items-center gap-3 rounded-md border bg-card px-3 py-2 shadow-sm">
            <span className={`h-2 w-2 shrink-0 rounded-full ${account ? "bg-emerald-500" : "bg-orange-500"}`} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{account?.shop_name || (account ? `Loja ${account.shop_id}` : "Loja desconectada")}</p>
              <p className="truncate text-xs text-muted-foreground">{account ? `Shopee · Shop ID ${account.shop_id}` : "Conecte em Configurações Gerais"}</p>
            </div>
            {account ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
          </div>
        </div>
      </header>

      {!loading && data && (!data.configuration.ready || !account) ? (
        <Card className="overflow-hidden border-orange-300/70 bg-orange-50/50 p-0 dark:bg-orange-950/10">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
              <div>
                <p className="font-medium">{data.configuration.ready ? "Conecte sua loja Shopee" : "Aplicativo Shopee ainda não configurado"}</p>
                <p className="text-sm text-muted-foreground">{data.configuration.ready ? "A autorização da loja é feita em Configurações Gerais." : `Variáveis pendentes: ${data.configuration.missing.join(", ")}.`}</p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0 bg-background"><Link href="/configuracoes/geral"><Settings2 className="mr-2 h-4 w-4" />Abrir configurações</Link></Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-0 overflow-hidden py-2 shadow-sm">
        <section aria-label="Resumo da Shopee" className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <SummaryButton title="Pedidos sincronizados" value={data?.orders.length ?? 0} description="Últimos 100 pedidos" icon={<ClipboardList className="h-4 w-4 text-violet-600" />} iconClass="bg-violet-500/10" onClick={() => setActiveTab("orders")} />
          <SummaryButton title="Produtos vinculados" value={data?.links.length ?? 0} description="Com baixa de estoque" icon={<Link2 className="h-4 w-4 text-blue-600" />} iconClass="bg-blue-500/10" onClick={() => setActiveTab("catalog")} />
          <SummaryButton title="Pendências" value={importErrors} description={importErrors ? "Pedidos que precisam de atenção" : "Operação sem falhas"} icon={<AlertTriangle className={`h-4 w-4 ${importErrors ? "text-rose-600" : "text-emerald-600"}`} />} iconClass={importErrors ? "bg-rose-500/10" : "bg-emerald-500/10"} onClick={() => setActiveTab(importErrors ? "orders" : "overview")} />
        </section>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ShopeeTab)}>
        <Card className="gap-0 overflow-hidden">
          <CardHeader className="gap-3 border-b pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div><CardTitle>Operação Shopee</CardTitle><CardDescription>Gerencie o canal sem sair do fluxo do ERP.</CardDescription></div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
                <Button size="sm" onClick={syncOrders} disabled={!account || syncing}>{syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}Sincronizar pedidos</Button>
              </div>
            </div>
            <TabsList className="h-auto w-full justify-start overflow-x-auto bg-muted/50 p-1 sm:w-fit">
              <TabsTrigger value="overview">Visão geral</TabsTrigger>
              <TabsTrigger value="orders">Pedidos</TabsTrigger>
              <TabsTrigger value="catalog">Catálogo</TabsTrigger>
            </TabsList>
          </CardHeader>

          <TabsContent value="overview" className="m-0">
            <CardContent className="grid gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr] lg:p-6">
              <div className="rounded-lg border bg-muted/10 p-5">
                <p className="text-sm font-semibold">Preparação do canal</p>
                <p className="mt-1 text-sm text-muted-foreground">Complete estes passos antes de operar pedidos reais.</p>
                <div className="mt-5 space-y-4">
                  <ReadinessItem done={data?.configuration.ready ?? false} title="Aplicativo configurado" description="Partner ID, chave e URL de retorno cadastrados." />
                  <ReadinessItem done={Boolean(account)} title="Loja autorizada" description="O vendedor concedeu acesso ao ERP." />
                  <ReadinessItem done={Boolean(data?.links.length)} title="Produtos vinculados" description="Os SKUs da Shopee apontam para o estoque correto." />
                </div>
              </div>
              <div className="rounded-lg border p-5">
                <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Pedidos recentes</p><p className="text-xs text-muted-foreground">Últimas movimentações recebidas</p></div><Button variant="ghost" size="sm" onClick={() => setActiveTab("orders")}>Ver todos<ArrowRight className="ml-1 h-4 w-4" /></Button></div>
                <div className="mt-4 divide-y">{(data?.orders ?? []).slice(0, 5).map((order) => <div key={order.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">#{order.order_sn}</p><p className="truncate text-xs text-muted-foreground">{order.buyer_username || "Comprador Shopee"} · {formatDate(order.create_time)}</p></div><div className="text-right"><p className="text-sm font-medium">{formatMoney(order.total_amount, order.currency)}</p><p className="text-xs text-muted-foreground">{statusLabel(order.status)}</p></div></div>)}
                  {!data?.orders.length ? <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="Nenhum pedido recebido" description="Conecte a loja e execute a primeira sincronização." /> : null}
                </div>
              </div>
            </CardContent>
          </TabsContent>

          <TabsContent value="orders" className="m-0">
            <CardContent className="overflow-x-auto p-0">
              <Table><TableHeader><TableRow><TableHead className="pl-6">Pedido</TableHead><TableHead>Cliente</TableHead><TableHead>Status</TableHead><TableHead>Valor</TableHead><TableHead>Rastreio</TableHead><TableHead className="pr-6">Venda ERP</TableHead></TableRow></TableHeader>
                <TableBody>{(data?.orders ?? []).map((order) => <TableRow key={order.id}><TableCell className="pl-6"><div className="font-medium">{order.order_sn}</div><div className="text-xs text-muted-foreground">{formatDate(order.create_time)}</div></TableCell><TableCell>{order.buyer_username || "Comprador Shopee"}</TableCell><TableCell><Badge variant={order.import_error ? "destructive" : "outline"}>{order.import_error ? "Erro de importação" : statusLabel(order.status)}</Badge>{order.import_error ? <div className="mt-1 max-w-xs text-xs text-destructive">{order.import_error}</div> : null}</TableCell><TableCell>{formatMoney(order.total_amount, order.currency)}</TableCell><TableCell>{order.tracking_number || order.shipping_carrier || "—"}</TableCell><TableCell className="pr-6">{order.venda_id ? <Badge variant="secondary">Venda #{order.venda_id}</Badge> : "Pendente"}</TableCell></TableRow>)}
                  {!loading && !data?.orders.length ? <TableRow><TableCell colSpan={6}><EmptyState icon={<ClipboardList className="h-6 w-6" />} title="Nenhum pedido Shopee" description="Os pedidos aparecerão aqui depois da primeira sincronização." /></TableCell></TableRow> : null}
                </TableBody></Table>
            </CardContent>
          </TabsContent>

          <TabsContent value="catalog" className="m-0">
            <CardContent className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)] lg:p-6">
              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/20 px-4 py-3"><p className="text-sm font-semibold">Produtos vinculados</p><p className="text-xs text-muted-foreground">Relação entre estoque do ERP e Item/Model ID da Shopee.</p></div>
                <Table><TableHeader><TableRow><TableHead>Produto ERP</TableHead><TableHead>Item Shopee</TableHead><TableHead>SKU</TableHead></TableRow></TableHeader><TableBody>{(data?.links ?? []).map((link) => <TableRow key={link.id}><TableCell><p className="font-medium">{link.title || `Produto #${link.produto_id}`}</p><p className="text-xs text-muted-foreground">ERP #{link.produto_id}</p></TableCell><TableCell>{link.item_id}{link.model_id ? <span className="block text-xs text-muted-foreground">Modelo {link.model_id}</span> : null}</TableCell><TableCell>{link.model_sku || link.item_sku || "—"}</TableCell></TableRow>)}{!data?.links.length ? <TableRow><TableCell colSpan={3}><EmptyState icon={<PackageSearch className="h-6 w-6" />} title="Nenhum produto vinculado" description="Crie o primeiro vínculo usando o formulário ao lado." /></TableCell></TableRow> : null}</TableBody></Table>
              </div>
              <div className="h-fit rounded-lg border bg-muted/10 p-5">
                <div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600"><Link2 className="h-4 w-4" /></span><div><p className="font-semibold">Novo vínculo</p><p className="text-xs text-muted-foreground">Use os IDs do produto cadastrado no Seller Center.</p></div></div>
                <div className="mt-5 space-y-4">
                  <div className="space-y-1.5"><Label>Produto do ERP</Label><Select value={linkForm.produtoId} onValueChange={(value) => setLinkForm((current) => ({ ...current, produtoId: value }))}><SelectTrigger><SelectValue placeholder="Selecione um produto" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={product.id} value={String(product.id)}>#{product.id} · {product.titulo}</SelectItem>)}</SelectContent></Select></div>
                  <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>Item ID</Label><Input inputMode="numeric" placeholder="Obrigatório" value={linkForm.itemId} onChange={(event) => setLinkForm((current) => ({ ...current, itemId: event.target.value }))} /></div><div className="space-y-1.5"><Label>Model ID</Label><Input inputMode="numeric" placeholder="Se houver variação" value={linkForm.modelId} onChange={(event) => setLinkForm((current) => ({ ...current, modelId: event.target.value }))} /></div></div>
                  <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label>SKU do item</Label><Input value={linkForm.itemSku} onChange={(event) => setLinkForm((current) => ({ ...current, itemSku: event.target.value }))} /></div><div className="space-y-1.5"><Label>SKU da variação</Label><Input value={linkForm.modelSku} onChange={(event) => setLinkForm((current) => ({ ...current, modelSku: event.target.value }))} /></div></div>
                  <Button className="w-full" onClick={saveLink} disabled={savingLink || !linkForm.produtoId || !linkForm.itemId}>{savingLink ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}Salvar vínculo</Button>
                </div>
              </div>
            </CardContent>
          </TabsContent>
        </Card>
      </Tabs>
    </div>
  );
}

function SummaryButton({ title, value, description, icon, iconClass, onClick }: { title: string; value: number; description: string; icon: React.ReactNode; iconClass: string; onClick: () => void }) {
  return <button type="button" className="group min-w-0 text-left transition-colors hover:bg-muted/30" onClick={onClick}><div className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="text-xl font-bold leading-tight">{value}</p><p className="truncate text-xs text-muted-foreground">{description}</p></div><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconClass}`}>{icon}</span></div></button>;
}

function ReadinessItem({ done, title, description }: { done: boolean; title: string; description: string }) {
  return <div className="flex gap-3"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{done ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs font-semibold">•</span>}</span><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div></div>;
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center text-muted-foreground"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">{icon}</span><p className="text-sm font-medium text-foreground">{title}</p><p className="mt-1 max-w-sm text-xs">{description}</p></div>;
}

function formatMoney(value?: number | null, currency?: string | null) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(Number(value ?? 0));
}

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

function statusLabel(value?: string | null) {
  const labels: Record<string, string> = { UNPAID: "Aguardando pagamento", READY_TO_SHIP: "Pronto para envio", PROCESSED: "Processado", SHIPPED: "Enviado", TO_CONFIRM_RECEIVE: "Aguardando recebimento", COMPLETED: "Concluído", IN_CANCEL: "Cancelamento solicitado", CANCELLED: "Cancelado" };
  return labels[String(value ?? "").toUpperCase()] || value || "Sem status";
}
