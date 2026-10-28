import { DescricaoIA } from "./descricao-ia";
import { ProductCheckoutSettings } from './product-checkout-settings';
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValueInput } from "@/components/ui/value-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Store,
  AlignLeft,
  AlertTriangle,
  ExternalLink,
  TrendingUp,
  Pencil,
  Eye,
  ShoppingBag,
  Percent,
  ImageIcon,
  Sparkles,
  ArrowUpRight,
  Handshake,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Produto } from "../../../types";
import { MercadoLivreEditListingDialog } from "@/app/(app)/(pages)/marketplace/mercadolivre/edit-listing/edit-listing-dialog";
import { MercadoLivrePublishProductDialog } from "@/app/(app)/(pages)/marketplace/mercadolivre/create-listing/publish-product-dialog";

type Props = {
  produto: Produto;
  onChange: (field: keyof Produto, value: any) => void;
  onSiteVisibilityChange?: () => void;
};

export function TabMarketplace({ produto, onChange, onSiteVisibilityChange }: Props) {
  const LIMITE_TITULO = 100;
  const LIMITE_DESCRICAO = 300;

  const tituloQtd = (produto.tituloMarketplace || "").length;
  const descricaoQtd = (produto.descricaoMarketplace || "").length;
  const produtoId = Number((produto as any).id);
  const [loadingIntegration, setLoadingIntegration] = useState(true);
  const [integration, setIntegration] = useState<any>(null);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [editListingOpen, setEditListingOpen] = useState(false);
  const [createListingOpen, setCreateListingOpen] = useState(false);
  const loadIntegration = useCallback(() => {
    if (!produtoId) return;
    setLoadingIntegration(true);
    setIntegrationError(null);

    fetch(`/api/integracoes/mercadolivre/products/${produtoId}/performance`, { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || "Falha ao consultar o Mercado Livre.");
        setIntegration(json?.linked ? json.data : null);
      })
      .catch((error) => {
        setIntegrationError(error?.message || "Falha ao consultar o Mercado Livre.");
      })
      .finally(() => {
        setLoadingIntegration(false);
      });
  }, [produtoId]);

  useEffect(() => {
    loadIntegration();
  }, [loadIntegration]);

  // "Exibir no site" e a publicacao do produto na loja (site_product_link), nao
  // um campo de produto: por isso grava na hora, fora do botao Salvar.
  const [siteVisible, setSiteVisible] = useState<boolean | null>(null);
  const [savingSiteVisible, setSavingSiteVisible] = useState(false);
  const [sitePrice, setSitePrice] = useState(0);
  const [savingSitePrice, setSavingSitePrice] = useState(false);

  useEffect(() => {
    if (!produtoId) return;
    let cancelled = false;
    setSiteVisible(null);
    fetch(`/api/integracoes/site/products/${produtoId}`, { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || "Falha ao consultar a publicação no site.");
        if (!cancelled) {
          setSiteVisible(Boolean(json?.data?.visible));
          setSitePrice(Number(json?.data?.sitePrice ?? 0));
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error(error?.message || "Falha ao consultar a publicação no site.");
      });
    return () => {
      cancelled = true;
    };
  }, [produtoId]);

  async function changeSiteVisible(visible: boolean) {
    setSavingSiteVisible(true);
    try {
      const response = await fetch(`/api/integracoes/site/products/${produtoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao alterar a exibição no site.");
      setSiteVisible(Boolean(json?.data?.visible));
      onSiteVisibilityChange?.();

      const sync = await fetch("/api/integracoes/site/catalog/sync", { method: "POST" });
      if (sync.ok) {
        toast.success(visible ? "Produto exibido no site." : "Produto ocultado do site.");
      } else {
        toast.warning("Alteração salva, mas a sincronização com o site falhou.", {
          description: "Sincronize o catálogo no módulo Marketplace.",
        });
      }
    } catch (error: any) {
      toast.error(error?.message || "Falha ao alterar a exibição no site.");
    } finally {
      setSavingSiteVisible(false);
    }
  }

  async function saveSitePrice() {
    const price = sitePrice;
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Informe um preço válido para o site.");
      return;
    }
    setSavingSitePrice(true);
    try {
      const response = await fetch(`/api/integracoes/site/products/${produtoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sitePrice: price }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao salvar o preço do site.");
      setSitePrice(Number(json.data.sitePrice));
      onSiteVisibilityChange?.();
      const sync = await fetch("/api/integracoes/site/catalog/sync", { method: "POST" });
      if (!sync.ok) {
        toast.warning("Preço salvo, mas a sincronização com o site falhou.", {
          description: "Sincronize o catálogo no módulo Marketplace.",
        });
      } else {
        toast.success("Preço salvo e sincronizado com o site.");
      }
    } catch (error: any) {
      toast.error(error?.message || "Falha ao atualizar o preço do site.");
    } finally {
      setSavingSitePrice(false);
    }
  }

  const isListingActive = String(integration?.status).toLowerCase() === "active";
  const isListingPaused = String(integration?.status).toLowerCase() === "paused";
  const qualityScore = integration?.quality?.score != null ? Math.round(integration.quality.score) : null;

  return (
    <TabsContent value="MarketPlace" className="h-full min-h-0 w-full min-w-0 max-w-full space-y-4 overflow-x-hidden overflow-y-auto bg-muted-foreground/5 px-3 py-3 md:px-6 md:py-6">
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="exibirMarketplace" className="text-sm font-semibold">Exibir no PDV</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Exibe o produto na busca do PDV.
            </p>
          </div>
          <Switch
            id="exibirMarketplace"
            className="shrink-0"
            checked={!!(produto as any).exibirPdv}
            onCheckedChange={(value) => onChange("exibirPdv" as any, value)}
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4">
          <div className="min-w-0">
            <Label htmlFor="exibirSite" className="text-sm font-semibold">Exibir no site</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Publica o produto na loja online. A alteração é aplicada na hora, sem precisar salvar.
            </p>
          </div>
          <Switch
            id="exibirSite"
            className="shrink-0"
            checked={siteVisible === true}
            disabled={!produtoId || siteVisible === null || savingSiteVisible}
            onCheckedChange={changeSiteVisible}
          />
        </div>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3 border-b pb-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <AlignLeft className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Conteúdo comercial</h3>
            <p className="text-xs text-muted-foreground">Dados usados nos canais de venda online.</p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
        <Label htmlFor="precoSite">Preço de venda no site (R$)</Label>
        <p className="text-xs text-muted-foreground">
          Começa com o valor de venda do ERP. Depois, só muda neste campo.
          Salvar preço envia a alteração ao site imediatamente.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ValueInput
            id="precoSite"
            decimals={2}
            allowNegative={false}
            value={produtoId ? sitePrice : (produto.precovenda ?? 0)}
            onValueChange={setSitePrice}
            disabled={!produtoId || siteVisible === null || savingSitePrice}
            className="bg-background text-right tabular-nums sm:max-w-56"
          />
          <Button type="button" onClick={saveSitePrice} disabled={!produtoId || siteVisible === null || savingSitePrice}>
            {savingSitePrice ? "Sincronizando..." : "Salvar preço"}
          </Button>
        </div>
        {!produtoId && <p className="text-xs text-muted-foreground">Salve o produto para ajustar o preço do site.</p>}
      </div>

        <ProductCheckoutSettings key={`${produtoId}:${produto.grupo_produto_id||0}`} productId={produtoId} assignedGroupId={Number(produto.grupo_produto_id)||0} price={Number(produtoId ? sitePrice : produto.precovenda)||0}/>

        <div className="grid gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="tituloMarketplace">Título</Label>
              <span
                className={`text-xs font-medium ${tituloQtd >= LIMITE_TITULO ? "text-destructive" : "text-muted-foreground"}`}
              >
                {tituloQtd}/{LIMITE_TITULO}
              </span>
            </div>
            <Input
              id="tituloMarketplace"
              value={(produto as any).tituloMarketplace || ""}
              onChange={(e) => onChange("tituloMarketplace" as any, e.target.value)}
              placeholder="Ex: Pneu Aro 14"
              maxLength={LIMITE_TITULO}
              className="bg-background"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="descricaoMarketplace">Descrição</Label>
              <span
                className={`text-xs font-medium ${descricaoQtd >= LIMITE_DESCRICAO ? "text-destructive" : "text-muted-foreground"}`}
              >
                {descricaoQtd}/{LIMITE_DESCRICAO}
              </span>
            </div>
            <Textarea
              id="descricaoMarketplace"
              value={(produto as any).descricaoMarketplace || ""}
              onChange={(e) => onChange("descricaoMarketplace" as any, e.target.value)}
              placeholder="Descreva os detalhes do produto, compatibilidade, marca, etc..."
              className="min-h-[104px] resize-y bg-background"
              maxLength={LIMITE_DESCRICAO}
            />
            <DescricaoIA produto={produto} onChange={onChange} field="descricaoMarketplace" />
          </div>
        </div>

        {/* Card Mercado Livre */}
        <div className="rounded-xl border bg-card/90 shadow-sm overflow-hidden transition-all">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/20 text-amber-600 dark:text-amber-400">
                <Handshake className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  Mercado Livre
                  {integration && (
                    <Badge variant="outline" className="text-[10px] font-mono py-0 h-4 border-muted-foreground/30">
                      MLB
                    </Badge>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground">Vínculo, desempenho e qualidade do anúncio.</p>
              </div>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/marketplace?canal=mercadolivre&secao=products">
                Gerenciar marketplace <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>

          <div className="p-4">
            {loadingIntegration ? (
              <div className="flex h-28 flex-col items-center justify-center gap-2.5">
                <div className="size-7 animate-spin rounded-t-full border-t-2 border-primary" />
                <span className="text-xs font-medium text-muted-foreground">Carregando dados do anúncio...</span>
              </div>
            ) : integrationError ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-0.5">
                  <p className="font-medium text-xs">Erro ao consultar o anúncio</p>
                  <p className="text-xs opacity-90">{integrationError}</p>
                </div>
              </div>
            ) : !integration ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-dashed border-muted-foreground/25 bg-muted/15 p-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">Este produto ainda não possui anúncio no Mercado Livre</p>
                    <Badge variant="secondary" className="text-[11px]">Não anunciado</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground max-w-xl">
                    Publique este item no Mercado Livre com fotos, ficha técnica, preço exclusivo do marketplace e Mercado Envios.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0 gap-2 font-medium shadow-sm"
                  onClick={() => setCreateListingOpen(true)}
                >
                  <Store className="h-4 w-4" />
                  Anunciar no Mercado Livre
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Header do Anúncio com Ações Rápidas */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border bg-muted/10 p-3.5">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-background rounded border shadow-2xs">
                        {integration.ml_item_id}
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          isListingActive
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1.5 py-0.5"
                            : isListingPaused
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1.5 py-0.5"
                              : "gap-1.5 py-0.5"
                        }
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            isListingActive ? "bg-emerald-500 animate-pulse" : isListingPaused ? "bg-amber-500" : "bg-muted-foreground"
                          }`}
                        />
                        {isListingActive ? "Anúncio Ativo" : isListingPaused ? "Anúncio Pausado" : String(integration.status || "Status indefinido")}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold truncate text-foreground" title={integration.title}>
                      {integration.title || "Anúncio Mercado Livre"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      className="gap-1.5 font-medium shadow-2xs"
                      onClick={() => setEditListingOpen(true)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar anúncio
                    </Button>
                    {integration.permalink && (
                      <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <a href={integration.permalink} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Ver no ML
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Métricas / KPIs */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  <div className="rounded-lg border bg-card p-3 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-xs font-medium">Visualizações</span>
                      <Eye className="h-3.5 w-3.5 text-blue-500" />
                    </div>
                    <p className="text-lg font-bold tracking-tight">
                      {Number(integration.period?.visits ?? 0).toLocaleString("pt-BR")}
                    </p>
                  </div>

                  <div className="rounded-lg border bg-card p-3 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-xs font-medium">Pedidos</span>
                      <ShoppingBag className="h-3.5 w-3.5 text-emerald-500" />
                    </div>
                    <p className="text-lg font-bold tracking-tight">
                      {Number(integration.period?.orders ?? 0).toLocaleString("pt-BR")}
                    </p>
                  </div>

                  <div className="rounded-lg border bg-card p-3 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-xs font-medium">Conversão</span>
                      <Percent className="h-3.5 w-3.5 text-amber-500" />
                    </div>
                    <p className="text-lg font-bold tracking-tight">
                      {Number(integration.period?.conversionRate ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                    </p>
                  </div>

                  <div className="rounded-lg border bg-card p-3 shadow-2xs space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-xs font-medium">Fotos</span>
                      <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <p className="text-lg font-bold tracking-tight">
                      {integration.picturesCount ?? 0}
                    </p>
                  </div>

                  <div className="rounded-lg border bg-card p-3 shadow-2xs space-y-1 col-span-2 sm:col-span-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-xs font-medium">Qualidade</span>
                      <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                    </div>
                    <div className="flex items-baseline gap-2">
                      <p className="text-lg font-bold tracking-tight">
                        {qualityScore != null ? `${qualityScore}%` : "-"}
                      </p>
                    </div>
                    {qualityScore != null && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted mt-1">
                        <div
                          className={`h-full rounded-full transition-all ${
                            qualityScore >= 70 ? "bg-emerald-500" : qualityScore >= 40 ? "bg-amber-500" : "bg-destructive"
                          }`}
                          style={{ width: `${Math.min(qualityScore, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Melhorias sugeridas */}
                {integration.quality?.actions?.length > 0 && (
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                        <TrendingUp className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        Melhorias recomendadas pelo Mercado Livre
                      </div>
                      <span className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                        {integration.quality.actions.length} sugestão(ões)
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {integration.quality.actions.slice(0, 6).map((action: any) => (
                        <Badge key={`${action.id}:${action.title}`} variant="outline" className="border-amber-500/30 bg-background/80 text-[11px] text-foreground">
                          {action.title || action.id}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {(integration.permissions?.familyControlled || integration.permissions?.catalogControlled) && (
                  <p className="text-xs text-muted-foreground bg-muted/20 px-3 py-2 rounded border">
                    {integration.permissions.catalogControlled
                      ? "Este anúncio pertence ao catálogo do Mercado Livre e suas características principais são geridas pela plataforma."
                      : "Este anúncio faz parte de uma família de produtos (User Products) no Mercado Livre."}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Diálogo com Stepper de Edição do Anúncio */}
      {integration?.ml_item_id && editListingOpen ? (
        <MercadoLivreEditListingDialog
          open={editListingOpen}
          onOpenChange={setEditListingOpen}
          itemId={integration.ml_item_id}
          produtoId={produtoId}
          initialProduct={produto}
          onAfterSave={loadIntegration}
        />
      ) : null}

      {/* Diálogo com Stepper de Cadastro/Publicação de Anúncio */}
      {createListingOpen ? (
        <MercadoLivrePublishProductDialog
          open={createListingOpen}
          onOpenChange={setCreateListingOpen}
          produto={produto}
          onAfterPublish={() => {
            loadIntegration();
            onChange("temAnuncioMercadoLivre" as any, true);
          }}
        />
      ) : null}
    </TabsContent>
  );
}

