"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Store, AlignLeft, AlertTriangle, ExternalLink, TrendingUp } from "lucide-react";
import { Produto } from "../../../types";

type Props = {
  produto: Produto;
  onChange: (field: keyof Produto, value: any) => void;
};

export function TabMarketplace({ produto, onChange }: Props) {
  const LIMITE_TITULO = 100;
  const LIMITE_DESCRICAO = 300;

  const tituloQtd = (produto.tituloMarketplace || "").length;
  const descricaoQtd = (produto.descricaoMarketplace || "").length;
  const produtoId = Number((produto as any).id);
  const [loadingIntegration, setLoadingIntegration] = useState(true);
  const [integration, setIntegration] = useState<any>(null);
  const [integrationError, setIntegrationError] = useState<string | null>(null);

  useEffect(() => {
    if (!produtoId) return;
    let active = true;

    fetch(`/api/integracoes/mercadolivre/products/${produtoId}/performance`, { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || "Falha ao consultar o Mercado Livre.");
        if (active) setIntegration(json?.linked ? json.data : null);
      })
      .catch((error) => {
        if (active) setIntegrationError(error?.message || "Falha ao consultar o Mercado Livre.");
      })
      .finally(() => {
        if (active) setLoadingIntegration(false);
      });
    return () => {
      active = false;
    };
  }, [produtoId]);

  return (
    <TabsContent value="MarketPlace" className="h-full min-h-0 w-full min-w-0 max-w-full space-y-4 overflow-x-hidden overflow-y-auto bg-muted-foreground/5 px-3 py-3 md:px-6 md:py-6">
      

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="exibirMarketplace" className="text-sm font-semibold">Exibir no catálogo</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Exibe o produto no catálogo online do PDV/Site.
            </p>
          </div>
          <Switch
            id="exibirMarketplace"
            className="shrink-0"
            checked={!!(produto as any).exibirPdv}
            onCheckedChange={(value) => onChange("exibirPdv" as any, value)}
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
            
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Store className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Mercado Livre</h3>
              <p className="text-xs text-muted-foreground">Vínculo, desempenho e qualidade do anúncio.</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="bg-transparent">
            <Link href="/marketplace">Gerenciar marketplace</Link>
          </Button>
        </div>

        {loadingIntegration ? (
          <div className="flex h-24 flex-col items-center justify-center gap-3">
            <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
            <span className="text-sm text-primary">Carregando anúncio...</span>
          </div>
        ) : integrationError ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {integrationError}
          </div>
        ) : !integration ? (
          <div className="flex min-h-20 items-center rounded-md border border-dashed bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
            Este produto ainda não possui anúncio do Mercado Livre vinculado.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{integration.ml_item_id}</span>
                  <Badge variant={String(integration.status).toLowerCase() === "active" ? "default" : "outline"}>
                    {String(integration.status).toLowerCase() === "active" ? "Ativo" : String(integration.status || "Não informado")}
                  </Badge>
                </div>
                <p className="mt-1 text-sm font-medium">{integration.title || "Anúncio Mercado Livre"}</p>
              </div>
              {integration.permalink && (
                <Button asChild variant="ghost" size="sm">
                  <a href={integration.permalink} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> Abrir anúncio
                  </a>
                </Button>
              )}
            </div>

            <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              {[
                ["Visualizações", integration.period?.visits ?? 0],
                ["Pedidos", integration.period?.orders ?? 0],
                ["Conversão", `${Number(integration.period?.conversionRate ?? 0).toLocaleString("pt-BR")} %`],
                ["Imagens", integration.picturesCount ?? 0],
                ["Qualidade", integration.quality?.score != null ? `${Math.round(integration.quality.score)}%` : "-"],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-md border bg-muted/15 px-3 py-1.5">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="font-semibold leading-tight">{value}</p>
                </div>
              ))}
            </div>

            {integration.quality?.actions?.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <TrendingUp className="h-4 w-4 text-amber-600" /> Melhorias sugeridas
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {integration.quality.actions.slice(0, 6).map((action: any) => (
                    <Badge key={`${action.id}:${action.title}`} variant="outline">{action.title || action.id}</Badge>
                  ))}
                </div>
              </div>
            )}

            {(integration.permissions?.familyControlled || integration.permissions?.catalogControlled) && (
              <p className="text-xs text-muted-foreground">
                {integration.permissions.catalogControlled
                  ? "O anúncio pertence ao catálogo e alguns dados são controlados pelo Mercado Livre."
                  : "O anúncio usa User Products e os dados da família podem ter edição limitada."}
              </p>
            )}
          </div>
        )}
      </div>
      </div>
    </TabsContent>
  );
}
