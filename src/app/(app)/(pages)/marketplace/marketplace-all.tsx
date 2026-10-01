"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Boxes, Globe2, Layers3, Loader2, PackageCheck, ShoppingBag, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import { MarketplaceAttentionCenter, MarketplaceHeader, MarketplaceListToolbar, MarketplaceLoadingLine, MarketplacePagination, MarketplaceSectionNav, useMarketplaceQueryValue, useMarketplaceSection, type MarketplaceAttentionItem } from "./marketplace-layout";

type UnifiedSection = "overview" | "catalog";
type CatalogProduct = {
  id: number;
  titulo: string;
  referencia?: string | null;
  precovenda?: number | null;
  estoque?: number | null;
  status_estoque?: string | null;
  imageUrl?: string | null;
  site?: { status?: string | null; sync_status?: string | null; slug?: string | null } | null;
  mercadolivre?: { ml_item_id: string; status?: string | null; permalink?: string | null } | null;
  shopee?: { item_id: number; model_id?: number | null; status?: string | null } | null;
};
type CatalogResponse = {
  data: CatalogProduct[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: { site: number; mercadolivre: number; shopee: number; allChannels: number; both: number; linked: number };
};

const SECTIONS: readonly UnifiedSection[] = ["overview", "catalog"];
const EMPTY_DATA: CatalogResponse = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 }, summary: { site: 0, mercadolivre: 0, shopee: 0, allChannels: 0, both: 0, linked: 0 } };

export default function MarketplaceAll({ shopeeEnabled }: { shopeeEnabled: boolean }) {
  const [activeSection, setActiveSection] = useMarketplaceSection(SECTIONS, "overview");
  const [search, setSearch] = useMarketplaceQueryValue("catalogo_busca");
  const [status, setStatus] = useMarketplaceQueryValue("catalogo_status", "all");
  const [searchInput, setSearchInput] = useState(search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<CatalogResponse>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize), status });
      if (search) params.set("search", search);
      const response = await fetch(`/api/integracoes/marketplace/catalog?${params.toString()}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao carregar o catálogo.");
      setData(json);
    } catch (error: any) {
      toast.error("Catálogo não carregado", { description: error?.message });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setSearch(searchInput.trim()); }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput, setSearch]);
  useEffect(() => { setSearchInput(search); }, [search]);
  useEffect(() => { setPage(1); }, [status, pageSize]);
  useEffect(() => {
    if (!shopeeEnabled && status === "shopee") setStatus("all");
  }, [shopeeEnabled, status, setStatus]);

  const incompleteCoverage = Math.max(0, data.summary.linked - data.summary.allChannels);
  const attentionItems: MarketplaceAttentionItem[] = incompleteCoverage ? [{
    id: "incomplete-coverage",
    title: "Produtos sem cobertura em todos os canais",
    description: "Avalie se estes produtos também devem ser oferecidos nos demais canais ativos.",
    count: incompleteCoverage,
    actionLabel: "Ver produtos",
    onAction: () => { setStatus("incomplete"); setActiveSection("catalog"); },
  }] : [];

  const header = activeSection === "overview"
    ? { title: "Visão dos canais", description: "Acompanhe a cobertura do catálogo nos canais de venda ativos." }
    : { title: "Catálogo dos canais", description: "Compare o produto do ERP e sua publicação em cada canal." };

  const filterOptions = [
    { value: "all", label: "Todos os produtos" },
    { value: "all_channels", label: "Em todos os canais" },
    { value: "incomplete", label: "Fora de algum canal" },
    { value: "site", label: "Com Site" },
    { value: "mercadolivre", label: "Com Mercado Livre" },
    ...(shopeeEnabled ? [{ value: "shopee", label: "Com Shopee" }] : []),
    { value: "unlinked", label: "Sem publicação" },
  ];

  return (
    <div className="mx-auto space-y-4">
      <MarketplaceHeader icon={Layers3} iconClassName="text-violet-600" description="Produtos e publicações dos canais ativos em uma única operação." connected accountName="Operação consolidada" accountDescription={shopeeEnabled ? "Site, Mercado Livre e Shopee" : "Site e Mercado Livre"} />

      <Tabs value={activeSection} onValueChange={(value) => setActiveSection(value as UnifiedSection)}>
      <Card className="gap-0 overflow-hidden">
        <CardHeader className="border-b-2 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 shrink-0"><CardTitle>{header.title}</CardTitle><CardDescription className="flex items-center gap-2"><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 text-foreground/50 hover:cursor-pointer hover:text-foreground/70 disabled:cursor-wait disabled:opacity-60"><span>Recarregar</span><Loader2 width={12} className={loading ? "animate-spin" : ""} /></button>{activeSection === "catalog" ? <><span aria-hidden="true">·</span><span>{data.pagination.total} produto(s)</span></> : null}</CardDescription></div>
            {activeSection === "catalog" ? <MarketplaceListToolbar compact search={searchInput} onSearchChange={setSearchInput} searchPlaceholder="Buscar produto, referência, fabricante ou código..." filter={status} onFilterChange={setStatus} filterOptions={filterOptions} resultLabel={`${data.pagination.total} produto(s)`} /> : null}
          </div>
        </CardHeader>
        <MarketplaceLoadingLine loading={loading} />
        <MarketplaceSectionNav items={[
          { value: "overview", label: "Visão geral", icon: Layers3 },
          { value: "catalog", label: "Produtos e anúncios", icon: Boxes, count: data.pagination.total },
        ]} />

        {activeSection === "overview" ? <CardContent className="space-y-4 p-4 lg:p-6">
          <div className={`grid grid-cols-2 overflow-hidden rounded-lg border ${shopeeEnabled ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
            <Summary title="Site" value={data.summary.site} description="Produtos configurados" icon={<Globe2 className="h-4 w-4 text-sky-600" />} />
            <Summary title="Mercado Livre" value={data.summary.mercadolivre} description="Produtos com anúncio" icon={<Store className="h-4 w-4 text-amber-600" />} />
            {shopeeEnabled ? <Summary title="Shopee" value={data.summary.shopee} description="Produtos com anúncio" icon={<ShoppingBag className="h-4 w-4 text-orange-600" />} /> : null}
            <Summary title="Todos os canais" value={data.summary.allChannels} description="Cobertura completa" icon={<Layers3 className="h-4 w-4 text-violet-600" />} />
            <Summary title="Produtos vinculados" value={data.summary.linked} description="Ao menos um canal" icon={<PackageCheck className="h-4 w-4 text-emerald-600" />} />
          </div>
          <MarketplaceAttentionCenter items={attentionItems} />
        </CardContent> : null}

        {activeSection === "catalog" ? <CardContent className="p-0">
          <div className="p-4 lg:p-6"><div className="overflow-hidden rounded-md border"><Table>
            <TableHeader className="bg-muted/30"><TableRow><TableHead className="pl-4">Produto ERP</TableHead><TableHead>Preço / estoque</TableHead><TableHead>Site</TableHead><TableHead>Mercado Livre</TableHead>{shopeeEnabled ? <TableHead>Shopee</TableHead> : null}<TableHead className="pr-4 text-right">Ação</TableHead></TableRow></TableHeader>
            <TableBody>{data.data.map((product) => <TableRow key={product.id}>
              <TableCell className="pl-4"><div className="flex items-center gap-3"><ProductThumbnail product={product} /><div className="min-w-0"><p className="max-w-[360px] truncate font-medium">{product.titulo}</p><p className="text-xs text-muted-foreground">#{product.id} · {product.referencia || "Sem referência"}</p></div></div></TableCell>
              <TableCell><p>{formatMoney(product.precovenda)}</p><p className="text-xs text-muted-foreground">{Math.max(0, Math.trunc(Number(product.estoque || 0)))} unidade(s)</p></TableCell>
              <TableCell>{product.site ? <div><Badge variant="outline">{product.site.status || "Configurado"}</Badge><p className="mt-1 text-xs text-muted-foreground">{product.site.sync_status || "Não sincronizado"}</p></div> : <Badge variant="secondary">Não publicado</Badge>}</TableCell>
              <TableCell>{product.mercadolivre ? <div><Badge variant="outline">{product.mercadolivre.status || "Vinculado"}</Badge><p className="mt-1 text-xs text-muted-foreground">{product.mercadolivre.ml_item_id}</p></div> : <Badge variant="secondary">Não publicado</Badge>}</TableCell>
              {shopeeEnabled ? <TableCell>{product.shopee ? <div><Badge variant="outline">{product.shopee.status || "Vinculado"}</Badge><p className="mt-1 text-xs text-muted-foreground">Item {product.shopee.item_id}</p></div> : <Badge variant="secondary">Não publicado</Badge>}</TableCell> : null}
              <TableCell className="pr-4 text-right"><div className="flex justify-end gap-1">{!product.site ? <Button size="sm" variant="outline" asChild><Link href="/marketplace?canal=loja">Site</Link></Button> : null}{!product.mercadolivre ? <Button size="sm" variant="outline" asChild><Link href="/marketplace?canal=mercadolivre&secao=products">Mercado Livre</Link></Button> : null}{shopeeEnabled && !product.shopee ? <Button size="sm" variant="outline" asChild><Link href="/marketplace?canal=shopee&secao=products">Shopee</Link></Button> : null}{product.site && product.mercadolivre && (!shopeeEnabled || product.shopee) ? <Badge className="bg-emerald-600">Todos os canais</Badge> : null}</div></TableCell>
            </TableRow>)}{!loading && !data.data.length ? <TableRow><TableCell colSpan={shopeeEnabled ? 6 : 5}><div className="flex min-h-48 flex-col items-center justify-center text-center"><AlertTriangle className="mb-3 h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">Nenhum produto encontrado</p><p className="text-xs text-muted-foreground">Altere a busca ou o filtro de canais.</p></div></TableCell></TableRow> : null}</TableBody>
          </Table></div></div>
          <MarketplacePagination page={data.pagination.page} totalPages={data.pagination.totalPages} pageSize={data.pagination.limit} total={data.pagination.total} visible={data.data.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </CardContent> : null}
      </Card>
      </Tabs>
    </div>
  );
}

function Summary({ title, value, description, icon }: { title: string; value: number; description: string; icon: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-b border-r px-4 py-3 xl:border-b-0"><div><p className="text-sm font-medium">{title}</p><p className="text-xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{description}</p></div><span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">{icon}</span></div>;
}

function ProductThumbnail({ product }: { product: CatalogProduct }) {
  if (!product.imageUrl) return <span className="flex h-11 w-11 items-center justify-center rounded-md border bg-muted"><Boxes className="h-4 w-4 text-muted-foreground" /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={product.imageUrl} alt="" className="h-11 w-11 rounded-md border object-cover" />;
}

function formatMoney(value?: number | null) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}
