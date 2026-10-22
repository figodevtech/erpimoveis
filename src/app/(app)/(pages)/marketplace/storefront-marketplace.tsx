"use client";


import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ClipboardList,
  Grid2X2,
  Globe2,
  ImageIcon,
  List,
  Loader2,
  MoreHorizontal,
  PackageCheck,
  PauseCircle,
  Pencil,
  Search,
  Send,
  Upload,
  X,
  Filter,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  MarketplaceHeader,
  MarketplaceLoadingLine,
  MarketplacePagination,
  MarketplaceSectionNav,
} from "./marketplace-layout";
import {
  StorefrontOrders,
  type StorefrontOrderActions,
} from "./storefront-orders";
import {
  EMPTY_STOREFRONT_FILTERS,
  StorefrontProductFiltersSheet,
  type StorefrontProductFilters,
} from "./storefront-product-filters";
import { DialogProduto } from "@/app/(app)/(pages)/estoque/components/dialog-produto/dialog-produto";

type StorefrontProduct = {
  product_link_id: number | null;
  produto_id: number;
  titulo: string;
  preco: number | null;
  estoque: number;
  status: "RASCUNHO" | "PUBLICADO" | "PAUSADO" | "ERRO";
  sync_status: "NAO_SINCRONIZADO" | "PENDENTE" | "SINCRONIZADO" | "ERRO";
  referencia?: string | null;
  fabricante?: string | null;
  imagem_principal?: string | null;
  has_image: boolean;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  visible: boolean;
};

type StorefrontResponse = {
  data: StorefrontProduct[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    published: number;
    paused: number;
    pending: number;
    errors: number;
  };
};

const EMPTY_RESPONSE: StorefrontResponse = {
  data: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
  summary: { published: 0, paused: 0, pending: 0, errors: 0 },
};

export default function StorefrontMarketplace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab =
    searchParams.get("secao") === "orders" ? "orders" : "products";
  const [response, setResponse] = useState<StorefrontResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [viewMode, setViewMode] = useState<"list" | "cards">("list");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<StorefrontProductFilters>(
    EMPTY_STOREFRONT_FILTERS,
  );
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [publishingAll, setPublishingAll] = useState(false);
  const [changingProductId, setChangingProductId] = useState<number | null>(null);
  const [editProductId, setEditProductId] = useState<number | null>(null);
  const [photoProductId, setPhotoProductId] = useState<number | null>(null);
  const [orderActions, setOrderActions] =
    useState<StorefrontOrderActions | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      setSearch(nextSearch);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
    });
    if (search) params.set("search", search);
    Object.entries(filters).forEach(([key, value]) => {
      if (value && !((key === "status" || key === "syncStatus") && value === "all")) params.set(key, value);
    });
    setLoading(true);

    fetch(`/api/integracoes/site/products?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (request) => {
        const json = await request.json();
        if (!request.ok)
          throw new Error(json?.error || "Falha ao carregar o canal Site.");
        return json as StorefrontResponse;
      })
      .then((data) => {
        if (!active) return;
        setResponse(data);
        setError(null);
      })
      .catch((requestError: unknown) => {
        // Cleanup and filter changes cancel the previous request intentionally.
        // Checking the signal also covers abort errors from another JS realm.
        if (!active || controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Falha ao carregar o canal Site.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort(new DOMException("Carregamento substituído ou tela fechada.", "AbortError"));
    };
  }, [filters, page, pageSize, reloadKey, search]);

  function reload() {
    setLoading(true);
    setReloadKey((current) => current + 1);
  }

  function handleProductSaved() {
    reload();
    void syncCatalog(false).catch(() => reload());
  }

  function changeTab(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("canal", "loja");
    params.set("secao", value === "orders" ? "orders" : "products");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function syncCatalog(showEmptyMessage = true, showError = true) {
    setSyncingCatalog(true);
    try {
      const result = await postJson("/api/integracoes/site/catalog/sync");
      if (result.processed > 0) {
        toast.success(`${result.products} produto(s) sincronizado(s) com a loja.`);
      } else if (showEmptyMessage) {
        toast.info("Não há alterações pendentes para sincronizar.");
      }
      reload();
      return result;
    } catch (syncError) {
      if (showError) {
        toast.error(
          syncError instanceof Error ? syncError.message : "Falha ao sincronizar o catálogo.",
        );
      }
      throw syncError;
    } finally {
      setSyncingCatalog(false);
    }
  }

  async function changePublication(product: StorefrontProduct) {
    const publish = product.status !== "PUBLICADO";
    setChangingProductId(product.produto_id);
    try {
      await sendJson(`/api/integracoes/site/products/${product.produto_id}`, { visible: publish }, "PATCH");
      await syncCatalog(false, false);
      toast.success(publish ? "Produto publicado na loja." : "Produto pausado na loja.");
    } catch (publicationError) {
      toast.error(
        publicationError instanceof Error
          ? publicationError.message
          : "Falha ao alterar a publicação.",
      );
      reload();
    } finally {
      setChangingProductId(null);
    }
  }

  async function publishAllWithImages() {
    setPublishingAll(true);
    try {
      const result = await postJson("/api/integracoes/site/products/publish-all");
      await syncCatalog(false, false);
      toast.success(
        `${result.published} produto(s) com imagem publicados. ${result.skippedWithoutImage} sem imagem ignorado(s).`,
      );
    } catch (publishError) {
      toast.error(
        publishError instanceof Error ? publishError.message : "Falha ao publicar o catálogo.",
      );
      reload();
    } finally {
      setPublishingAll(false);
    }
  }

  const productToolbar = (
    <div className="flex min-w-0 w-full items-center gap-2 sm:justify-end">
      <form
        role="search"
        className="relative min-w-0 flex-1 sm:w-[320px] sm:flex-none"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchInput.trim());
          setPage(1);
        }}
      >
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="absolute left-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2 text-muted-foreground"
          aria-label="Buscar produtos"
        >
          <Search className="h-4 w-4" />
        </Button>
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Código, título, referência..."
          className="h-9 bg-background pl-10 pr-10"
        />
        {searchInput ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
            aria-label="Limpar busca"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </form>
      <div className="flex shrink-0 items-center gap-2">
      <StorefrontProductFiltersSheet
        filters={filters}
        onApply={(nextFilters) => {
          setFilters(nextFilters);
          setPage(1);
        }}
      />
      <div className="flex rounded-xl border bg-muted/40 p-1">
        <Button
          title="Visualização em lista"
          aria-label="Visualização em lista"
          aria-pressed={viewMode === "list"}
          size="sm"
          variant={viewMode === "list" ? "secondary" : "ghost"}
          className="h-8 w-8 rounded-lg p-0"
          onClick={() => setViewMode("list")}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          title="Visualização em grade"
          aria-label="Visualização em grade"
          aria-pressed={viewMode === "cards"}
          size="sm"
          variant={viewMode === "cards" ? "secondary" : "ghost"}
          className="h-8 w-8 rounded-lg p-0"
          onClick={() => setViewMode("cards")}
        >
          <Grid2X2 className="h-4 w-4" />
        </Button>
      </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto min-w-0 space-y-4">
      <MarketplaceHeader
        icon={Globe2}
        iconClassName="text-sky-600"
        description="Publicação, preço, estoque e sincronização do site."
        connected={!error}
        accountName="Site"
        accountDescription="Catálogo conectado ao ERP"
      />

      <Tabs value={activeTab} onValueChange={changeTab}>
        <Card className="gap-0 overflow-hidden">
          <CardHeader className="border-b-2 px-4 pb-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>
                  {activeTab === "orders" ? "Pedidos do Site" : "Operação do Site"}
                </CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      activeTab === "orders" ? orderActions?.reload() : reload()
                    }
                    className="h-auto gap-1 rounded-none p-0 has-[>svg]:px-0 text-foreground/50 hover:bg-transparent hover:text-foreground/70 disabled:cursor-wait disabled:opacity-60"
                    disabled={
                      activeTab === "orders"
                        ? !orderActions || orderActions.loading
                        : loading
                    }
                  >
                  <span>Recarregar</span>
                    <Loader2
                      className={`h-3 w-3 ${
                        activeTab === "orders"
                          ? orderActions?.loading
                            ? "animate-spin"
                            : ""
                          : loading
                            ? "animate-spin"
                            : ""
                      }`}
                    />
                  </Button>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeTab === "orders"
                      ? `${orderActions?.total ?? 0} pedido(s)`
                      : `${response.pagination.total} produto(s)`}
                  </span>
                </CardDescription>
              </div>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">

                {activeTab === "orders" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 w-auto sm:h-9"
                  onClick={() => orderActions?.sync()}
                  disabled={!orderActions || orderActions.syncing}
                >
                  {orderActions?.syncing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardList className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar pedidos
                </Button>
              ) : (
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void publishAllWithImages()}
                    disabled={publishingAll || syncingCatalog || loading}
                  >
                    {publishingAll ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <PackageCheck className="mr-2 h-4 w-4" />
                    )}
                    <span className="sm:hidden">Publicar com imagem</span>
                    <span className="hidden sm:inline">Publicar todos com imagem</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void syncCatalog()}
                    disabled={syncingCatalog || publishingAll || loading}
                  >
                    {syncingCatalog ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    <span className="sm:hidden">Sincronizar</span>
                    <span className="hidden sm:inline">Sincronizar catálogo</span>
                  </Button>
                </div>
              )}
              </div>
            </div>
          </CardHeader>
          <MarketplaceLoadingLine
            loading={
              activeTab === "orders"
                ? Boolean(orderActions?.loading || orderActions?.syncing)
                : loading || syncingCatalog
            }
          />

          <MarketplaceSectionNav
            inlineTrailing={activeTab === "orders"}
            items={[
              {
                value: "products",
                label: "Produtos",
                icon: PackageCheck,
                count: response.pagination.total,
              },
              {
                value: "orders",
                label: "Pedidos",
                icon: ClipboardList,
                count: orderActions?.total ?? 0,
              },
            ]}
            trailing={
              activeTab === "products" ? productToolbar : <Button variant="outline" size="sm" onClick={() => orderActions?.openFilters()} disabled={!orderActions}><Filter className="h-4 w-4" />Filtros{orderActions?.activeFilters ? <Badge variant="secondary">{orderActions.activeFilters}</Badge> : null}</Button>
            }
          />

          <TabsContent value="products" className="m-0">
            <CardContent className="space-y-5 p-4 lg:p-6">
                  <div className="grid grid-cols-2 overflow-hidden rounded-lg border lg:grid-cols-4">
                    <Summary
                      label="Publicados"
                      value={response.summary.published}
                      icon={PackageCheck}
                      tone="text-emerald-600"
                    />
                    <Summary
                      label="Pausados"
                      value={response.summary.paused}
                      icon={PauseCircle}
                      tone="text-slate-600"
                    />
                    <Summary
                      label="Na fila"
                      value={response.summary.pending}
                      icon={Send}
                      tone="text-sky-600"
                    />
                    <Summary
                      label="Com erro"
                      value={response.summary.errors}
                      icon={AlertTriangle}
                      tone="text-rose-600"
                    />
                  </div>

                  {error ? (
                    <div
                      role="alert"
                      className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4"
                    >
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                      <div>
                        <p className="text-sm font-medium">
                          Canal Site ainda não está disponível
                        </p>
                        <p className="text-xs text-muted-foreground">{error}</p>
                      </div>
                    </div>
                  ) : null}

              {viewMode === "list" ? (
                <div className="overflow-hidden rounded-lg border">
                  <Table className="block md:table">
                    <TableHeader className="hidden bg-muted/30 md:table-header-group">
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead>Preço / estoque</TableHead>
                        <TableHead>Publicação</TableHead>
                        <TableHead>Sincronização</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="block md:table-row-group">
                      {response.data.map((product) => (
                        <TableRow key={product.produto_id} className="grid min-w-0 grid-cols-2 gap-2 p-3 md:table-row md:p-0">
                          <TableCell className="col-span-2 block min-w-0 whitespace-normal p-0 md:table-cell md:p-2">
                            <p className="line-clamp-2 font-medium md:max-w-[380px] md:truncate">
                              {product.titulo}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              #{product.produto_id} ·{" "}
                              {product.referencia || "Sem referência"}
                            </p>
                            {!product.has_image ? (
                              <Badge variant="destructive" className="mt-1">Sem imagem</Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="block whitespace-normal p-0 md:table-cell md:p-2">
                            <p>{formatMoney(product.preco)}</p>
                            <p className="text-xs text-muted-foreground">
                              {product.estoque} unidade(s) publicáveis
                            </p>
                          </TableCell>
                          <TableCell className="block whitespace-normal p-0 md:table-cell md:p-2">
                            <PublicationBadge
                              status={product.status}
                              linked={product.product_link_id !== null}
                            />
                          </TableCell>
                          <TableCell className="col-span-2 block min-w-0 whitespace-normal p-0 md:table-cell md:p-2">
                            <SyncBadge status={product.sync_status} />
                            {product.last_sync_error ? (
                              <p
                                className="mt-1 max-w-64 truncate text-xs text-rose-600"
                                title={product.last_sync_error}
                              >
                                {product.last_sync_error}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="col-span-2 block p-0 pt-2 text-right md:table-cell md:p-2">
                            <div className="md:hidden">
                              <ProductActionsMenu product={product} loading={changingProductId === product.produto_id} publicationDisabled={syncingCatalog || changingProductId !== null || (!product.has_image && product.status !== "PUBLICADO")} onEdit={() => setEditProductId(product.produto_id)} onPhoto={() => setPhotoProductId(product.produto_id)} onPublication={() => void changePublication(product)} />
                            </div>
                            <div className="hidden flex-wrap justify-end gap-2 md:flex">
                              <EditProductAction
                                onClick={() => setEditProductId(product.produto_id)}
                              />
                              {!product.has_image ? (
                                <PhotoAction onClick={() => setPhotoProductId(product.produto_id)} />
                              ) : null}
                              <PublicationAction
                                product={product}
                                loading={changingProductId === product.produto_id}
                                disabled={syncingCatalog || changingProductId !== null || (!product.has_image && product.status !== "PUBLICADO")}
                                onClick={() => void changePublication(product)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!loading && !response.data.length ? (
                        <TableRow>
                          <TableCell colSpan={5}>
                            <ProductEmptyState />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
                  {response.data.map((product) => (
                    <div
                      key={product.produto_id}
                      className="overflow-hidden rounded-md border bg-background"
                    >
                      <div className="relative flex aspect-[16/9] items-center justify-center border-b bg-muted/60">
                        {product.imagem_principal ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.imagem_principal}
                            alt={product.titulo}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-muted-foreground" />
                        )}
                        {!product.has_image ? (
                          <Badge variant="destructive" className="absolute left-2 top-2">Sem imagem</Badge>
                        ) : null}
                      </div>
                      <div className="space-y-2 p-3">
                        <div>
                          <p
                            className="line-clamp-2 min-h-10 text-sm font-medium"
                            title={product.titulo}
                          >
                            {product.titulo}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            #{product.produto_id} ·{" "}
                            {product.referencia || "Sem referência"}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          <div className="rounded-md border bg-muted/30 px-2 py-1">
                            <p className="text-[11px] text-muted-foreground">
                              Estoque
                            </p>
                            <p className="text-sm font-semibold">
                              {product.estoque}
                            </p>
                          </div>
                          <div className="rounded-md border bg-muted/30 px-2 py-1">
                            <p className="text-[11px] text-muted-foreground">
                              Preço
                            </p>
                            <p className="truncate text-sm font-semibold">
                              {formatMoney(product.preco)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                          <PublicationBadge
                            status={product.status}
                            linked={product.product_link_id !== null}
                          />
                          <SyncBadge status={product.sync_status} />
                        </div>
                        <div className="flex justify-end md:hidden">
                          <ProductActionsMenu product={product} loading={changingProductId === product.produto_id} publicationDisabled={syncingCatalog || changingProductId !== null || (!product.has_image && product.status !== "PUBLICADO")} onEdit={() => setEditProductId(product.produto_id)} onPhoto={() => setPhotoProductId(product.produto_id)} onPublication={() => void changePublication(product)} />
                        </div>
                        <div className="hidden space-y-2 md:block">
                        <PublicationAction
                          product={product}
                          loading={changingProductId === product.produto_id}
                          disabled={syncingCatalog || changingProductId !== null || (!product.has_image && product.status !== "PUBLICADO")}
                          onClick={() => void changePublication(product)}
                          fullWidth
                        />
                        <EditProductAction
                          onClick={() => setEditProductId(product.produto_id)}
                          fullWidth
                        />
                        {!product.has_image ? (
                          <PhotoAction onClick={() => setPhotoProductId(product.produto_id)} fullWidth />
                        ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!loading && !response.data.length ? (
                    <div className="col-span-full rounded-lg border">
                      <ProductEmptyState />
                    </div>
                  ) : null}
                </div>
              )}

              <MarketplacePagination
                page={page}
                totalPages={response.pagination.totalPages}
                pageSize={pageSize}
                total={response.pagination.total}
                visible={response.data.length}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                  setPageSize(value);
                  setPage(1);
                }}
              />
            </CardContent>
          </TabsContent>

          <TabsContent value="orders" className="m-0 space-y-4">
            <StorefrontOrders
              embedded
              onActionsChange={setOrderActions}
            />
          </TabsContent>
          {editProductId ? (
            <DialogProduto
              productId={editProductId}
              initialTab="MarketPlace"
              isOpen
              setIsOpen={(open) => {
                if (!open) {
                  setEditProductId(null);
                  reload();
                }
              }}
              onAfterSaveProduct={handleProductSaved}
            />
          ) : null}
          {photoProductId ? (
            <DialogProduto
              productId={photoProductId}
              initialTab="Imagens"
              isOpen
              setIsOpen={(open) => {
                if (!open) {
                  setPhotoProductId(null);
                  void syncCatalog(false, false).catch(() => reload());
                }
              }}
              onAfterSaveProduct={handleProductSaved}
            />
          ) : null}
        </Card>
      </Tabs>
    </div>
  );
}

function Summary({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Globe2;
  tone: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-r px-4 py-3 lg:border-b-0">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
      <Icon className={`h-5 w-5 ${tone}`} />
    </div>
  );
}

function ProductEmptyState() {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center p-4 text-center">
      <Globe2 className="mb-3 h-7 w-7 text-muted-foreground" />
      <p className="text-sm font-medium">
        Nenhum produto encontrado no catálogo
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        Publique produtos do catálogo para disponibilizá-los neste canal.
      </p>
    </div>
  );
}

function PublicationBadge({
  status,
  linked,
}: {
  status: StorefrontProduct["status"];
  linked: boolean;
}) {
  if (!linked) return <Badge variant="outline">Não publicado</Badge>;
  if (status === "PUBLICADO")
    return <Badge className="bg-emerald-600">Publicado</Badge>;
  if (status === "PAUSADO") return <Badge variant="secondary">Pausado</Badge>;
  if (status === "ERRO") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="outline">Rascunho · não publicado</Badge>;
}

function SyncBadge({ status }: { status: StorefrontProduct["sync_status"] }) {
  if (status === "SINCRONIZADO")
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/30 text-emerald-700"
      >
        Dados sincronizados
      </Badge>
    );
  if (status === "PENDENTE")
    return (
      <Badge variant="outline" className="border-sky-600/30 text-sky-700">
        Envio pendente
      </Badge>
    );
  if (status === "ERRO") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">Dados não enviados</Badge>;
}

function ProductActionsMenu({ product, loading, publicationDisabled, onEdit, onPhoto, onPublication }: {
  product: StorefrontProduct;
  loading: boolean;
  publicationDisabled: boolean;
  onEdit: () => void;
  onPhoto: () => void;
  onPublication: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-10 gap-2" disabled={loading} aria-label={`Ações do produto ${product.produto_id}`}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          Ações
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem className="min-h-10" onSelect={onEdit}><Pencil className="h-4 w-4" />Editar produto</DropdownMenuItem>
        <DropdownMenuItem className="min-h-10" onSelect={onPhoto}><Upload className="h-4 w-4" />{product.has_image ? "Alterar foto" : "Enviar foto"}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-10" disabled={publicationDisabled} onSelect={onPublication}>
          {product.status === "PUBLICADO" ? <PauseCircle className="h-4 w-4" /> : <PackageCheck className="h-4 w-4" />}
          {product.status === "PUBLICADO" ? "Pausar publicação" : "Publicar na loja"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PublicationAction({
  product,
  loading,
  disabled,
  onClick,
  fullWidth = false,
}: {
  product: StorefrontProduct;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  fullWidth?: boolean;
}) {
  const published = product.status === "PUBLICADO";
  return (
    <Button
      type="button"
      size="sm"
      variant={published ? "outline" : "default"}
      className={fullWidth ? "w-full" : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {published ? "Pausar" : "Publicar"}
    </Button>
  );
}

function PhotoAction({ onClick, fullWidth = false }: { onClick: () => void; fullWidth?: boolean }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={fullWidth ? "w-full" : undefined}
      onClick={onClick}
    >
      <Upload className="mr-2 h-4 w-4" />
      Enviar foto
    </Button>
  );
}

function EditProductAction({ onClick, fullWidth = false }: { onClick: () => void; fullWidth?: boolean }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={fullWidth ? "w-full" : undefined}
      onClick={onClick}
    >
      <Pencil className="mr-2 h-4 w-4" />
      Editar produto
    </Button>
  );
}

function postJson(url: string, body?: unknown) {
  return sendJson(url, body, "POST");
}

async function sendJson(url: string, body: unknown, method: "POST" | "PATCH") {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "A operação não pôde ser concluída.");
  return data;
}

function formatMoney(value: number | null) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}
