"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

export type ProdutoImagem = {
  id: number;
  produto_id: number;
  url: string;
  ordem: number;
  createdat?: string;
};

export function useProdutoImagens(params: {
  productId: number | undefined;
  onAfterChangeCapa?: () => Promise<void> | void;
}) {
  const { productId, onAfterChangeCapa } = params;

  const [imagens, setImagens] = useState<ProdutoImagem[]>([]);
  const [carregandoImagens, setCarregandoImagens] = useState(false);
  const [subindoImagens, setSubindoImagens] = useState(false);
  const [removendoImagemId, setRemovendoImagemId] = useState<number | null>(null);

  const carregarImagens = useCallback(async () => {
    if (!productId) return;
    setCarregandoImagens(true);
    try {
      const res = await axios.get(`/api/products/${productId}/images`);
      setImagens(res.data?.imagens ?? []);
    } catch (err) {
      console.error("Erro ao carregar imagens:", err);
      toast.error("Erro", { description: "Não foi possível carregar as imagens do produto.", duration: 2500 });
    } finally {
      setCarregandoImagens(false);
    }
  }, [productId]);

  const enviarArquivos = useCallback(async (files: File[]) => {
    if (!productId) return;
    if (files.length === 0) return;

    setSubindoImagens(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));

      await axios.post(`/api/products/${productId}/images`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast.success("Sucesso!", { description: "Imagens enviadas.", duration: 2000 });
      await carregarImagens();
      await onAfterChangeCapa?.();
    } catch (err) {
      console.error("Erro ao enviar imagens:", err);
      toast.error("Erro", { description: "Não foi possível enviar as imagens.", duration: 2500 });
    } finally {
      setSubindoImagens(false);
    }
  }, [carregarImagens, onAfterChangeCapa, productId]);

  const onPick = useCallback((files: File[]) => {
    if (files.length === 0) return;

    void enviarArquivos(files);
  }, [enviarArquivos]);

  const definirImagemPrincipal = useCallback(
    async (imageId: number) => {
      if (!productId) return;
      try {
        await axios.patch(`/api/products/${productId}/images/${imageId}`, { principal: true });
        toast.success("Sucesso!", { description: "Imagem principal atualizada.", duration: 2000 });
        await onAfterChangeCapa?.();
        await carregarImagens();
      } catch (err) {
        console.error("Erro ao definir imagem principal:", err);
        toast.error("Erro", { description: "Não foi possível definir a imagem principal.", duration: 2500 });
      }
    },
    [carregarImagens, onAfterChangeCapa, productId]
  );

  const removerImagem = useCallback(
    async (imageId: number) => {
      if (!productId) return;
      setRemovendoImagemId(imageId);
      try {
        await axios.delete(`/api/products/${productId}/images/${imageId}`);
        toast.success("Sucesso!", { description: "Imagem removida.", duration: 2000 });
        await onAfterChangeCapa?.();
        await carregarImagens();
      } catch (err) {
        console.error("Erro ao remover imagem:", err);
        toast.error("Erro", { description: "Não foi possível remover a imagem.", duration: 2500 });
      } finally {
        setRemovendoImagemId(null);
      }
    },
    [carregarImagens, onAfterChangeCapa, productId]
  );

  useEffect(() => {
    if (productId) carregarImagens();
  }, [carregarImagens, productId]);

  return {
    imagens,
    carregandoImagens,
    subindoImagens,
    removendoImagemId,
    onPick,
    definirImagemPrincipal,
    removerImagem,
    carregarImagens,
  };
}
