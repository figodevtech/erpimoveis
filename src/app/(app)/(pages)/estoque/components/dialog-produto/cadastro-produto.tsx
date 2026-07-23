"use client";

import { TabsTrigger } from "@/components/ui/tabs";
import { Package, FileText, Boxes, Image as ImageIcon, Tag } from "lucide-react";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { Estoque_status, Produto } from "../../types";
import { ProductDialogLayout } from "./tabs/dialog-layout";
import { TabGeral } from "./tabs/tab-geral";
import { TabFiscal } from "./tabs/tab-fiscal";
import { TabEstoque } from "./tabs/tab-estoque";
import { TabImagensCreate } from "./tabs/tab-imagens-create";
import type { ProdutoImagemPendente } from "./tabs/produto-imagens-gallery";
import { TabEtiquetas } from "./tabs/tab-etiquetas";
import { useUnidadesMedida } from "./hooks/use-unidades-medida";
import { useEffect, useRef, useState } from "react";
import { Unidade_medida } from "../../types";
import { useGruposProduto } from "./hooks/use-grupo-produtos";
import type { LoteSelectItem } from "@/app/(app)/components/loteSelect";
import { useConfig } from "../../../config-context";

interface ConteudoCadastroProdutoProps {
  setSelectedProductId?: (value: number | undefined) => void;
  newProduct: Produto;
  setNewProduct: (value: Produto) => void;
  handleSearchFornecedor?: () => void;
  onAfterSaveProduct?: () => void;
  isDesktop?: boolean;
}

const initialNewProduct: Produto = {
  id: 0,
  precovenda: 0,
  status_estoque: Estoque_status.OK,
  unidade: Unidade_medida.UN,
  fornecedor: "DESCONHECIDO",
  grupo_produto_id: 1,
};

export default function CadastroProduto({
  handleSearchFornecedor,
  setSelectedProductId,
  newProduct,
  setNewProduct,
  onAfterSaveProduct,
  isDesktop = true,
}: ConteudoCadastroProdutoProps) {
  const [salvando, setSalvando] = useState(false);
  const [imagensPendentes, setImagensPendentes] = useState<ProdutoImagemPendente[]>([]);
  const imagensPendentesRef = useRef<ProdutoImagemPendente[]>([]);
  const [ordemImagensPendentes, setOrdemImagensPendentes] = useState<string[]>([]);
  const [progressoUploadImagens, setProgressoUploadImagens] = useState<Record<string, number>>({});
  const [currentTab, setCurrentTab] = useState<string>("Geral");
  const [lotePendente, setLotePendente] = useState<LoteSelectItem | null>(null);
  const { unidades, loadingUnidades, errorUnidades } = useUnidadesMedida();
  const { grupos } = useGruposProduto();
  const config = useConfig();
  const precoMedioCompraObrigatorio = config?.produto_preco_medio_compra_obrigatorio === true;

  const tabTheme =
    " group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

  const handleChange = (field: keyof Produto, value: any) => {
    setNewProduct({ ...newProduct, [field]: value });
  };

  useEffect(() => {
    // se não tiver unidade definida ainda, tenta setar uma ativa
    if (!newProduct.unidade && unidades.length > 0) {
      handleChange("unidade", unidades[0].sigla as Unidade_medida);
    }
  }, [unidades]);
  useEffect(() => {
    // se não tiver grupo definido ainda, tenta setar uma ativa
    if (!newProduct.grupo_produto_id && grupos.length > 0) {
      handleChange("grupo_produto_id", grupos[0].id);
    }
  }, [grupos]);

  const handlePickImages = (files: File[]) => {
    if (files.length === 0) return;

    const novas = files.map((file) => ({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    imagensPendentesRef.current = [...imagensPendentesRef.current, ...novas];
    setImagensPendentes(imagensPendentesRef.current);
    setOrdemImagensPendentes((current) => [...current, ...novas.map((img) => `pending-${img.id}`)]);
  };

  const limparImagensSelecionadas = () => {
    imagensPendentesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    imagensPendentesRef.current = [];
    setImagensPendentes([]);
    setOrdemImagensPendentes([]);
    setProgressoUploadImagens({});
  };

  const removerImagemSelecionada = (id: string) => {
    const alvo = imagensPendentesRef.current.find((img) => img.id === id);
    if (alvo) URL.revokeObjectURL(alvo.previewUrl);

    imagensPendentesRef.current = imagensPendentesRef.current.filter((img) => img.id !== id);
    setImagensPendentes(imagensPendentesRef.current);
    setOrdemImagensPendentes((current) => current.filter((key) => key !== `pending-${id}`));
    setProgressoUploadImagens((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  useEffect(() => {
    return () => {
      imagensPendentesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      imagensPendentesRef.current = [];
    };
  }, []);

  const cadastrarProduto = async (registerAgain?: boolean) => {
    if (precoMedioCompraObrigatorio && !(Number(newProduct.precocompra) > 0)) {
      setCurrentTab("Geral");
      toast.error("Valor médio de compra obrigatório", {
        description: "Informe um valor médio de compra maior que zero.",
      });
      return;
    }

    setSalvando(true);

    const payload = { ...newProduct } as any;
    if (!payload.tituloMarketplace) payload.tituloMarketplace = payload.titulo;

    try {
      const response = await axios.post("/api/products", {
        newProduct: payload,
        loteId: lotePendente?.id,
      });

      if (response.status === 201) {
        toast.success("Sucesso!", {
          description: "Produto cadastrado.",
          duration: 2000,
        });

        const produtoId = response.data.data.id as number;

        if (response.data.warning) {
          toast.warning("Cadastro concluído com ressalvas", {
            description: response.data.warning,
            duration: 3500,
          });
        }

        // envia imagens se selecionadas
        if (imagensPendentes.length > 0) {
          try {
            const pendentesPorId = new Map(imagensPendentes.map((img) => [`pending-${img.id}`, img]));
            const ordenadas = ordemImagensPendentes
              .map((key) => pendentesPorId.get(key))
              .filter(Boolean) as ProdutoImagemPendente[];

            for (const img of ordenadas) {
              const fd = new FormData();
              fd.append("files", img.file);

              await axios.post(`/api/products/${produtoId}/images`, fd, {
                headers: { "Content-Type": "multipart/form-data" },
                onUploadProgress: (event) => {
                  const total = event.total ?? img.file.size;
                  const pct = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
                  setProgressoUploadImagens((current) => ({ ...current, [img.id]: pct }));
                },
              });

              setProgressoUploadImagens((current) => ({ ...current, [img.id]: 100 }));
            }
          } catch (err) {
            console.error("Erro ao enviar imagens:", err);
            toast.error("Erro", {
              description:
                "Produto criado, mas não foi possível enviar as imagens.",
              duration: 2500,
            });
          }
        }

        if (registerAgain) {
          setNewProduct(initialNewProduct);
          setSelectedProductId?.(undefined);

          handleSearchFornecedor?.();

          limparImagensSelecionadas();
          setLotePendente(null);
          setCurrentTab("Geral");
          onAfterSaveProduct?.();
        } else {
          setSelectedProductId?.(produtoId);
          handleSearchFornecedor?.();

          limparImagensSelecionadas();
          setLotePendente(null);
          onAfterSaveProduct?.();
        }
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? "Erro ao criar produto",
          duration: 2000,
        });
      } else {
        toast.error("Erro", {
          description: "Erro ao criar produto",
          duration: 2000,
        });
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <ProductDialogLayout
      isDesktop={isDesktop}
      title={
        <>
          Produto
          <span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">| Novo</span>
        </>
      }
      description="Preencha dados para registrar um novo produto"
      defaultTab="Geral"
      submitLabel2="Salvar e Continuar"
      submitLabel="Salvar"
      submitting={salvando}
      onSubmit={cadastrarProduto}
      currentTab={currentTab}
      tabs={
        <>
          <TabsTrigger onClick={() => setCurrentTab("Geral")} value="Geral" className={"hover:cursor-pointer " + tabTheme}>
              <span className="flex items-center gap-2">
                <Package className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                Geral
              </span>
            </TabsTrigger>
          <TabsTrigger onClick={() => setCurrentTab("Fiscal")} value="Fiscal" className={"hover:cursor-pointer " + tabTheme}>
              <span className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                Fiscal
              </span>
            </TabsTrigger>
          <TabsTrigger onClick={() => setCurrentTab("Estoque")} value="Estoque" className={"hover:cursor-pointer " + tabTheme}>
              <span className="flex items-center gap-2">
                <Boxes className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                Estoque
              </span>
            </TabsTrigger>
          <TabsTrigger onClick={() => setCurrentTab("Imagens")} value="Imagens" className={"hover:cursor-pointer " + tabTheme}>
              <span className="flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                Imagens
              </span>
            </TabsTrigger>
          <TabsTrigger onClick={() => setCurrentTab("Etiquetas")} value="Etiquetas" className={"hover:cursor-pointer " + tabTheme}>
              <span className="flex items-center gap-2">
                <Tag className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                Localização
              </span>
            </TabsTrigger>
        </>
      }
    >
      <TabGeral
        mode="create"
        produto={newProduct}
        onChange={handleChange}
        unidades={unidades}
        grupos={grupos}
        loadingUnidades={loadingUnidades}
        errorUnidades={errorUnidades}
        lotePendente={lotePendente}
        onLotePendenteChange={setLotePendente}
        precoMedioCompraObrigatorio={precoMedioCompraObrigatorio}
      />

      <TabFiscal produto={newProduct} onChange={handleChange} />
      <TabEstoque mode="create" produto={newProduct} onChange={handleChange} />
      <TabImagensCreate
        pendentes={imagensPendentes}
        ordemItens={ordemImagensPendentes}
        progressoUpload={progressoUploadImagens}
        saving={salvando}
        onPick={handlePickImages}
        onReordenar={setOrdemImagensPendentes}
        onRemove={removerImagemSelecionada}
      />
      <TabEtiquetas produto={newProduct} onChange={handleChange} />
    </ProductDialogLayout>
  );
}
