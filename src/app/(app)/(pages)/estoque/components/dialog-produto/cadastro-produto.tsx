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
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Unidade_medida } from "../../types";
import { useGruposProduto } from "./hooks/use-grupo-produtos";
import type { LoteSelectItem } from "@/app/(app)/components/loteSelect";
import { useConfig } from "../../../config-context";
import {
  prepareProductImageForUpload,
  productImageUploadError,
} from "@/lib/product-image-upload";

interface ConteudoCadastroProdutoProps {
  setSelectedProductId?: (value: number | undefined) => void;
  newProduct: Produto;
  setNewProduct: Dispatch<SetStateAction<Produto>>;
  handleSearchFornecedor?: () => void;
  onAfterSaveProduct?: () => void | Promise<void>;
  isDesktop?: boolean;
}

const initialNewProduct: Produto = {
  id: 0,
  precovenda: 0,
  estoque: 0,
  estoqueminimo: 0,
  exibirPdv: true,
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

  // Atualizacao funcional: campos fiscais como CST PIS/COFINS e a classificacao
  // do IBS/CBS disparam varios onChange no mesmo evento. Espalhando um
  // `newProduct` lido do closure, cada chamada partia do mesmo estado e so a
  // ultima sobrevivia — o CST escolhido voltava a ficar em branco.
  const handleChange = useCallback(
    (field: keyof Produto, value: any) => {
      setNewProduct((current) => ({ ...current, [field]: value }));
    },
    [setNewProduct],
  );

  useEffect(() => {
    // se não tiver unidade definida ainda, tenta setar uma ativa
    if (!newProduct.unidade && unidades.length > 0) {
      handleChange("unidade", unidades[0].sigla as Unidade_medida);
    }
  }, [handleChange, newProduct.unidade, unidades]);
  useEffect(() => {
    // se não tiver grupo definido ainda, tenta setar uma ativa
    if (!newProduct.grupo_produto_id && grupos.length > 0) {
      handleChange("grupo_produto_id", grupos[0].id);
    }
  }, [grupos, handleChange, newProduct.grupo_produto_id]);

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
    // Só há uma ida à rede aqui: o POST. A etiqueta duplicada é detectada pelo
    // trigger validar_etiqueta_inventario_global, que responde 409 — conferir
    // antes custava uma consulta inteira e ainda deixava janela de corrida.
    setSalvando(true);

    try {
      if (precoMedioCompraObrigatorio && !(Number(newProduct.precocompra) > 0)) {
        setCurrentTab("Geral");
        toast.error("Valor médio de compra obrigatório", {
          description: "Informe um valor médio de compra maior que zero.",
        });
        return;
      }

      // Valida e reduz todas as imagens antes de criar o produto. Assim um
      // arquivo inválido não deixa um cadastro novo sem as imagens escolhidas.
      const imagensPreparadas = new Map<string, File>();
      try {
        for (const imagem of imagensPendentes) {
          imagensPreparadas.set(
            imagem.id,
            await prepareProductImageForUpload(imagem.file),
          );
        }
      } catch (imageError) {
        setCurrentTab("Imagens");
        toast.error("Revise as imagens selecionadas", {
          description: productImageUploadError(imageError),
          duration: 6000,
        });
        return;
      }

      const payload = { ...newProduct } as any;
      if (!payload.tituloMarketplace) payload.tituloMarketplace = payload.titulo;

      const response = await axios.post("/api/products", {
        newProduct: payload,
        loteId: lotePendente?.id,
      });

      if (response.status === 201) {
        const produtoId = response.data.data.id as number;
        const falhasNoEnvio: string[] = [];

        // envia imagens se selecionadas
        if (imagensPendentes.length > 0) {
          const pendentesPorId = new Map(imagensPendentes.map((img) => [`pending-${img.id}`, img]));
          const ordenadas = ordemImagensPendentes
            .map((key) => pendentesPorId.get(key))
            .filter(Boolean) as ProdutoImagemPendente[];

          for (const img of ordenadas) {
            try {
              const arquivoPreparado = imagensPreparadas.get(img.id) ?? img.file;
              const fd = new FormData();
              fd.append("files", arquivoPreparado);

              await axios.post(`/api/products/${produtoId}/images`, fd, {
                onUploadProgress: (event) => {
                  const total = event.total ?? arquivoPreparado.size;
                  const pct = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
                  setProgressoUploadImagens((current) => ({ ...current, [img.id]: pct }));
                },
              });

              setProgressoUploadImagens((current) => ({ ...current, [img.id]: 100 }));
            } catch (error) {
              console.error(`Erro ao enviar a imagem ${img.file.name}:`, error);
              falhasNoEnvio.push(productImageUploadError(error, img.file.name));
            }
          }
        }

        if (registerAgain) {
          setNewProduct(initialNewProduct);
          setSelectedProductId?.(undefined);

          handleSearchFornecedor?.();

          limparImagensSelecionadas();
          setLotePendente(null);
          setCurrentTab("Geral");
          await onAfterSaveProduct?.();
        } else {
          setSelectedProductId?.(produtoId);
          handleSearchFornecedor?.();

          limparImagensSelecionadas();
          setLotePendente(null);
          await onAfterSaveProduct?.();
        }

        if (falhasNoEnvio.length > 0) {
          toast.error("Produto criado; imagens pendentes", {
            description: `${falhasNoEnvio.length} imagem(ns) falharam. ${falhasNoEnvio[0]}`,
            duration: 6000,
          });
        } else if (response.data.warning) {
          toast.warning("Cadastro concluído com ressalvas", {
            description: response.data.warning,
            duration: 3500,
          });
        } else {
          toast.success("Sucesso!", {
            description: "Produto cadastrado com sucesso.",
            duration: 2000,
          });
        }
      }
    } catch (error) {
      if (isAxiosError(error)) {
        const apiMessage = String(error.response?.data?.error ?? "");
        // 409 de etiqueta vem do trigger com a mensagem já pronta ("Já existe um
        // produto/item de uso e consumo com esta etiqueta"). Abrir a aba deixa o
        // campo à vista, como fazia a checagem que rodava antes do POST.
        const etiquetaEmUso = error.response?.status === 409 && /etiqueta/i.test(apiMessage);
        if (etiquetaEmUso) setCurrentTab("Etiquetas");
        toast.error(etiquetaEmUso ? "Etiqueta já utilizada" : "Erro", {
          description: apiMessage || "Erro ao criar produto",
          duration: etiquetaEmUso ? 3500 : 2000,
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
