"use client";

import { TabsTrigger } from "@/components/ui/tabs";
import { Upload, Package, Store, Image as ImageIcon, FileText, Boxes, ShoppingCart, ClipboardList, ArrowRightLeft, Tag, Printer } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { Produto } from "../../types";
import { ProductDialogLayout } from "./tabs/dialog-layout";
import { TabGeral } from "./tabs/tab-geral";
import { TabMarketplace } from "./tabs/tab-marketplace";
import { TabImagensEdit } from "./tabs/tab-imagens-edit";
import { TabEtiquetas } from "./tabs/tab-etiquetas";
import { TabFiscal } from "./tabs/tab-fiscal";
import { TabEstoque } from "./tabs/tab-estoque";
import { TabVendas } from "./tabs/tab-vendas";
import { TabOrdens } from "./tabs/tab-ordens";
import { TabFluxo } from "./tabs/tab-fluxo";
import { useUnidadesMedida } from "./hooks/use-unidades-medida";
import { useProdutoImagens } from "./hooks/use-produto-imagens";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useGruposProduto } from "./hooks/use-grupo-produtos";
import { useConfig } from "../../../config-context";

interface EdicaoProdutoProps {
  productId: number;
  onAfterSaveProduct?: () => void;
  isDesktop?: boolean;
  isDrawer?: boolean;
  initialTab?: string;
}

const EDITABLE_PRODUCT_FIELDS: (keyof Produto)[] = [
  "descricao", "precovenda", "precocompra", "ultimovalordecompra", "estoqueminimo",
  "ncm", "cfop", "origem_mercadoria", "unidade", "cest", "csosn", "cst", "aliquotaicms",
  "cst_pis", "aliquota_pis", "modo_pis", "aliquota_por_unidade_pis", "cst_cofins",
  "aliquota_cofins", "modo_cofins", "aliquota_por_unidade_cofins", "rtc_habilitado",
  "cst_ibscbs", "cclass_trib", "aliquota_ibs_uf", "aliquota_ibs_municipio", "aliquota_cbs",
  "codigobarras", "etiqueta", "local", "referencia", "titulo", "fabricante",
  "grupo_produto_id", "exibirPdv", "tituloMarketplace", "descricaoMarketplace", "conservacao",
];

// Campos que formam uma regra conjunta precisam ser comparados e salvos como
// uma unidade. Os demais campos usam concorrência independente por input.
const CONSISTENCY_GROUPS: (keyof Produto)[][] = [
  ["origem_mercadoria", "ncm", "cfop", "cest", "csosn", "cst", "aliquotaicms"],
  ["cst_pis", "modo_pis", "aliquota_pis", "aliquota_por_unidade_pis"],
  ["cst_cofins", "modo_cofins", "aliquota_cofins", "aliquota_por_unidade_cofins"],
  ["rtc_habilitado", "cst_ibscbs", "cclass_trib", "aliquota_ibs_uf", "aliquota_ibs_municipio", "aliquota_cbs"],
  ["grupo_produto_id", "conservacao"],
  ["tituloMarketplace", "descricaoMarketplace"],
];

function fieldsToSave(current: Produto, original: Produto) {
  const dirtyFields = new Set(
    EDITABLE_PRODUCT_FIELDS.filter((field) => !Object.is(current[field], original[field])),
  );

  for (const group of CONSISTENCY_GROUPS) {
    if (group.some((field) => dirtyFields.has(field))) {
      group.forEach((field) => dirtyFields.add(field));
    }
  }

  return [...dirtyFields];
}

export default function EdicaoProduto({
  productId,
  onAfterSaveProduct,
  isDesktop = true,
  isDrawer = false,
  initialTab = "Geral",
}: EdicaoProdutoProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Produto | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<string>(initialTab)

  const reqIdRef = useRef(0);
  const originalProductRef = useRef<Produto | undefined>(undefined);
  const { unidades, loadingUnidades, errorUnidades } = useUnidadesMedida();
  const { grupos, loadingGrupos, adicionarGrupo } = useGruposProduto();
  const config = useConfig();
  const precoMedioCompraObrigatorio = config?.produto_preco_medio_compra_obrigatorio === true;
  const ncmObrigatorio = config?.produto_ncm_obrigatorio === true;

  const handleGetProduct = async (id: number) => {
    const myId = ++reqIdRef.current;

    setIsLoading(true);
    setLoadError(null);
    setSelectedProduct(undefined);

    try {
      const response = await axios.get(`/api/products/${id}`);
      if (myId !== reqIdRef.current) return;

      if (response.status === 200) {
        setSelectedProduct(response.data.data);
        originalProductRef.current = response.data.data;
      } else {
        setLoadError("Não foi possível carregar o produto.");
      }
    } catch (error: any) {
      if (myId !== reqIdRef.current) return;
      setLoadError(error?.response?.data?.error ?? "Erro ao buscar produto.");
    } finally {
      if (myId === reqIdRef.current) setIsLoading(false);
    }
  };

  // Depois de salvar, a tela ja mostra o que o PATCH devolveu; falta so o que
  // ele nao traz (vendas, ordens, movimentos, imagem principal). Busca sem
  // overlay e sem desmontar as abas. Se o usuario voltou a editar enquanto a
  // busca andava, a edicao dele fica e so a base de comparacao e atualizada.
  const handleRefreshSilencioso = async (id: number, exibido: Produto) => {
    const myId = ++reqIdRef.current;
    try {
      const response = await axios.get(`/api/products/${id}`);
      if (myId !== reqIdRef.current || response.status !== 200) return;
      const fresh = response.data.data as Produto;
      originalProductRef.current = fresh;
      setSelectedProduct((current) => (current === exibido ? fresh : current));
    } catch (error) {
      console.error("Erro ao recarregar produto após salvar:", error);
    }
  };

  const handleChange = (field: keyof Produto, value: any) => {
    setSelectedProduct((p) => (p ? ({ ...p, [field]: value } as any) : p));
  };

  const handleRefreshOperationalFields = async (id: number) => {
    try {
      const response = await axios.get(`/api/products/${id}`);
      if (response.status !== 200) return;

      const fresh = response.data.data as Produto;
      const patch: Partial<Produto> = {
        estoque: fresh.estoque,
        status_estoque: fresh.status_estoque,
        ultimovalordecompra: fresh.ultimovalordecompra,
        updatedat: fresh.updatedat,
      };
      setSelectedProduct((current) => current ? { ...current, ...patch } : current);
      if (originalProductRef.current) {
        originalProductRef.current = { ...originalProductRef.current, ...patch };
      }
    } catch (error) {
      console.error("Erro ao atualizar dados operacionais do produto:", error);
    }
  };

  const handleUpdateProduct = async () => {
    if (!selectedProduct) return;

    const originalProduct = originalProductRef.current;
    if (!originalProduct?.updatedat) {
      toast.error("Produto desatualizado", {
        description: "Recarregue o produto antes de salvar.",
      });
      return;
    }

    if (precoMedioCompraObrigatorio && !(Number(selectedProduct.precocompra) > 0)) {
      setCurrentTab("Geral");
      toast.error("Valor médio de compra obrigatório", {
        description: "Informe um valor médio de compra maior que zero.",
      });
      return;
    }

    if (ncmObrigatorio && !/^\d{8}$/.test(String(selectedProduct.ncm ?? "").trim())) {
      setCurrentTab("Fiscal");
      toast.error("NCM obrigatório", {
        description: "Informe o NCM do produto com 8 dígitos.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const changedFields = fieldsToSave(selectedProduct, originalProduct);
      const changes = Object.fromEntries(
        changedFields.map((field) => [
          field,
          {
            // JSON remove propriedades com undefined. Null preserva tanto a
            // comparação quanto a intenção de limpar um campo opcional.
            original: originalProduct[field] ?? null,
            value: selectedProduct[field] ?? null,
          },
        ]),
      );

      if (Object.keys(changes).length === 0) {
        if (imagensHook.imagensPendentes.length > 0) {
          await imagensHook.uploadPendentes();
          return;
        }
        if (imagensHook.ordemAlterada) {
          await imagensHook.salvarOrdem();
          return;
        }
        toast.info("Nenhuma alteração para salvar.");
        return;
      }

      const response = await axios.patch("/api/products/" + productId, {
        changes,
      });
      if (response.status === 200) {
        const { data } = response;
        setSelectedProduct(data.data);
        originalProductRef.current = data.data;
        if (imagensHook.imagensPendentes.length > 0) {
          await imagensHook.uploadPendentes();
        } else if (imagensHook.ordemAlterada) {
          await imagensHook.salvarOrdem();
        }
        await handleRefreshSilencioso(data.data.id, data.data);
        onAfterSaveProduct?.();
        toast.success("Sucesso!", { description: "Produto atualizado.", duration: 1500 });
      }
    } catch (error) {
      console.log("Erro ao atualizar produto:", error);
      const apiMessage = isAxiosError(error) ? String(error.response?.data?.error ?? "") : "";
      const concurrencyConflict = isAxiosError(error)
        && error.response?.status === 409
        && /alterado por outro|recarregue/i.test(apiMessage);
      toast.error("Erro", {
        description: concurrencyConflict
          ? "Um dos campos alterados foi modificado por outra pessoa. Feche e abra o cadastro novamente antes de salvar."
          : isAxiosError(error)
          ? apiMessage || "Não foi possível salvar o produto."
          : "Não foi possível salvar o produto.",
        duration: 2500,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const imagensHook = useProdutoImagens({
    productId,
    currentCoverUrl: selectedProduct?.imgUrl ?? null,
    onAfterChangeCapa: async (patch) => {
      setSelectedProduct((current) => current ? { ...current, ...patch } : current);
      if (originalProductRef.current) {
        originalProductRef.current = { ...originalProductRef.current, ...patch };
      }
    },
  });

  useEffect(() => {
    if (productId) handleGetProduct(productId);
  }, [productId]);

  // A rota de impressão lê a etiqueta salva no banco; imprimir com o campo
  // sujo geraria um QR com o código antigo parecendo o novo.
  const etiquetaSalva = String(originalProductRef.current?.etiqueta ?? "").trim();
  const etiquetaEditada = String(selectedProduct?.etiqueta ?? "").trim() !== etiquetaSalva;
  const podeImprimirEtiqueta = Boolean(etiquetaSalva) && !etiquetaEditada;
  const motivoEtiqueta = etiquetaEditada
    ? "Salve a etiqueta antes de imprimir"
    : etiquetaSalva
      ? "Imprimir etiqueta"
      : "Defina uma etiqueta do produto antes de imprimir";

  const headerActions = (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* O span mantém o hover quando o botão está desabilitado — é
            justamente aí que o tooltip precisa explicar o motivo. */}
        <span className="inline-flex">
          <button
            type="button"
            aria-label={motivoEtiqueta}
            disabled={!podeImprimirEtiqueta}
            onClick={() => window.open(`/print/produto/${productId}/etiqueta`, "_blank")}
            className="flex size-6 items-center justify-center rounded transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 enabled:hover:cursor-pointer"
          >
            <Printer className="h-4 w-4 text-muted-foreground" />
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{motivoEtiqueta}</TooltipContent>
    </Tooltip>
  );

  const tabTheme =
    " group !flex-none shrink-0 whitespace-nowrap h-11 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow,transform] hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm sm:h-8";

  const tabs = (
    <>
      <TabsTrigger onClick={()=>setCurrentTab("Geral")} value="Geral" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          Geral
        </span>
      </TabsTrigger>
      <TabsTrigger onClick={()=>setCurrentTab("MarketPlace")} value="MarketPlace" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <Store className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          MarketPlace
        </span>
      </TabsTrigger>
      <TabsTrigger onClick={()=>setCurrentTab("Imagens")} value="Imagens" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <ImageIcon className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          Fotos e vídeos
        </span>
      </TabsTrigger>
      <TabsTrigger onClick={()=>setCurrentTab("Etiquetas")} value="Etiquetas" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <Tag className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          Localização
        </span>
      </TabsTrigger>
      <TabsTrigger onClick={()=>setCurrentTab("Fiscal")} value="Fiscal" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          Fiscal
        </span>
      </TabsTrigger>
      <TabsTrigger onClick={()=>setCurrentTab("Estoque")} value="Estoque" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <Boxes className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          Estoque
        </span>
      </TabsTrigger>
      <TabsTrigger onClick={()=>setCurrentTab("Vendas")} value="Vendas" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <ShoppingCart className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          Vendas
        </span>
      </TabsTrigger>
      <TabsTrigger onClick={()=>setCurrentTab("Ordens")} value="Ordens" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <ClipboardList className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          Ordens
        </span>
      </TabsTrigger>
      <TabsTrigger onClick={()=>setCurrentTab("Fluxo")} value="Fluxo" className={"hover:cursor-pointer" + tabTheme}>
        <span className="flex items-center gap-2">
          <ArrowRightLeft className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
          Movimentação
        </span>
      </TabsTrigger>
    </>
  );

  return (
    <ProductDialogLayout
      title={
        <>
          {selectedProduct ? `Produto #${(selectedProduct as any).id}` : `Produto #${productId}`}
          <span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">| Edição</span>
        </>
      }
      description="Preencha dados para editar um produto"
      isDesktop={isDesktop}
      isDrawer={isDrawer}
      defaultTab={initialTab}
      currentTab={currentTab}
      loading={isLoading}

      submitLabel="Salvar"
      submitIcon={<Upload className="h-4 w-4" />}
      submitting={isSubmitting}
      onSubmit={handleUpdateProduct}
      tabs={tabs}
      headerActions={selectedProduct && !loadError ? headerActions : undefined}
      submitDisabled={isLoading || !!loadError || !selectedProduct}
    >
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* CONTEÚDO */}
        {selectedProduct && !loadError && (
          <>
            <TabGeral
              mode="edit"
              produto={selectedProduct}
              onChange={handleChange}
              unidades={unidades}
              grupos={grupos}
              loadingGrupos={loadingGrupos}
              onGrupoCriado={adicionarGrupo}
              loadingUnidades={loadingUnidades}
              errorUnidades={errorUnidades}
              showDates
              onLoteVinculoAlterado={onAfterSaveProduct}
              precoMedioCompraObrigatorio={precoMedioCompraObrigatorio}
            />

            <TabMarketplace
              produto={selectedProduct}
              onChange={handleChange}
              onSiteVisibilityChange={onAfterSaveProduct}
            />

            <TabImagensEdit
              productId={productId}
              carregando={imagensHook.carregandoImagens}
              subindo={imagensHook.subindoImagens}
              salvandoOrdem={imagensHook.salvandoOrdem}
              removendoImagemId={imagensHook.removendoImagemId}
              definindoCapaImagemId={imagensHook.definindoCapaImagemId}
              imagens={imagensHook.imagens}
              pendentes={imagensHook.imagensPendentes}
              ordemItens={imagensHook.ordemItens}
              progressoUpload={imagensHook.uploadProgressByPendingId}
              imgUrlPrincipal={(selectedProduct as any).imgUrl ?? null}
              onPick={imagensHook.onPick}
              onUpload={imagensHook.uploadPendentes}
              onReordenar={imagensHook.reordenarItens}
              onRemoverPendente={imagensHook.removerImagemPendente}
              onDefinirPrincipal={imagensHook.definirImagemPrincipal}
              onRemover={imagensHook.removerImagem}
            />

            <TabEtiquetas produto={selectedProduct} onChange={handleChange} />
            <TabFiscal produto={selectedProduct} onChange={handleChange} ncmObrigatorio={ncmObrigatorio} />
            <TabEstoque mode="edit" produto={selectedProduct} onChange={handleChange} />
            <TabVendas produto={selectedProduct} />
            <TabOrdens produto={selectedProduct} />
            <TabFluxo
              produto={selectedProduct}
              onAfterChange={async () => {
                await handleRefreshOperationalFields(productId);
                onAfterSaveProduct?.();
              }}
            />
          </>
        )}

        {/* OVERLAY (sem remontar modal / sem piscar tabs) */}
        {(isLoading || loadError || !selectedProduct) && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/95">
            {isLoading ? (
              <>
                <div className="size-8 border-t-2 border-primary rounded-t-full animate-spin" />
                <span className="text-primary">Carregando...</span>
              </>
            ) : loadError ? (
              <>
                <p className="font-medium text-destructive">Falha ao carregar</p>
                <p className="text-sm text-muted-foreground max-w-[520px] text-center">{loadError}</p>
                <Button variant="outline" onClick={() => handleGetProduct(productId)} className="hover:cursor-pointer">
                  Tentar novamente
                </Button>
              </>
            ) : (
              <span className="text-muted-foreground">Produto não encontrado.</span>
            )}
          </div>
        )}
      </div>
    </ProductDialogLayout>
  );
}
