import { DescricaoIA } from "./descricao-ia";
import { ProductCheckoutSettings } from './product-checkout-settings';

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValueInput } from "@/components/ui/value-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AlignLeft } from "lucide-react";
import { toast } from "@/lib/toast";
import { Produto } from "../../../types";

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

      </div>
    </TabsContent>
  );
}

