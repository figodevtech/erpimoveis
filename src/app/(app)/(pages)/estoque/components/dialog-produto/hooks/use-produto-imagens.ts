"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import type { ProdutoImagemPendente } from "../tabs/produto-imagens-gallery";

export type ProdutoImagem = {
  id: number;
  produto_id: number;
  url: string;
  ordem: number;
  createdat?: string;
};

function imageKey(id: number) {
  return `img-${id}`;
}

function pendingKey(id: string) {
  return `pending-${id}`;
}

function isImageKey(key: string) {
  return key.startsWith("img-");
}

function idFromImageKey(key: string) {
  return Number(key.replace("img-", ""));
}

export function useProdutoImagens(params: {
  productId: number | undefined;
  onAfterChangeCapa?: () => Promise<void> | void;
}) {
  const { productId, onAfterChangeCapa } = params;

  const [imagens, setImagens] = useState<ProdutoImagem[]>([]);
  const [imagensPendentes, setImagensPendentes] = useState<ProdutoImagemPendente[]>([]);
  const [ordemItens, setOrdemItens] = useState<string[]>([]);
  const [ordemAlterada, setOrdemAlterada] = useState(false);
  const imagensPendentesRef = useRef<ProdutoImagemPendente[]>([]);
  const ordemItensRef = useRef<string[]>([]);
  const [uploadProgressByPendingId, setUploadProgressByPendingId] = useState<Record<string, number>>({});
  const [carregandoImagens, setCarregandoImagens] = useState(false);
  const [subindoImagens, setSubindoImagens] = useState(false);
  const [salvandoOrdem, setSalvandoOrdem] = useState(false);
  const [removendoImagemId, setRemovendoImagemId] = useState<number | null>(null);
  const [definindoCapaImagemId, setDefinindoCapaImagemId] = useState<number | null>(null);
  const definindoCapaRef = useRef<number | null>(null);

  const setOrdem = useCallback((keys: string[], markDirty = false) => {
    ordemItensRef.current = keys;
    setOrdemItens(keys);
    if (markDirty) setOrdemAlterada(true);
  }, []);

  const reconcileOrder = useCallback((nextImages: ProdutoImagem[]) => {
    const imageKeys = new Set(nextImages.map((img) => imageKey(img.id)));
    const pendingKeys = new Set(imagensPendentesRef.current.map((img) => pendingKey(img.id)));
    const validCurrent = ordemItensRef.current.filter((key) => imageKeys.has(key) || pendingKeys.has(key));
    const missingImages = nextImages.map((img) => imageKey(img.id)).filter((key) => !validCurrent.includes(key));
    const missingPending = imagensPendentesRef.current
      .map((img) => pendingKey(img.id))
      .filter((key) => !validCurrent.includes(key));

    setOrdem([...validCurrent, ...missingImages, ...missingPending]);
  }, [setOrdem]);

  const carregarImagens = useCallback(async (options?: { silent?: boolean }) => {
    if (!productId) return;
    if (!options?.silent) setCarregandoImagens(true);
    try {
      const res = await axios.get(`/api/products/${productId}/images`);
      const nextImages = (res.data?.imagens ?? []) as ProdutoImagem[];
      setImagens(nextImages);
      reconcileOrder(nextImages);
    } catch (err) {
      console.error("Erro ao carregar imagens:", err);
      toast.error("Erro", { description: "Nao foi possivel carregar as imagens do produto.", duration: 2500 });
    } finally {
      if (!options?.silent) setCarregandoImagens(false);
    }
  }, [productId, reconcileOrder]);

  const salvarOrdem = useCallback(async (keys = ordemItensRef.current) => {
    if (!productId) return;
    const imageIds = keys.filter(isImageKey).map(idFromImageKey);
    if (imageIds.length === 0) {
      setOrdemAlterada(false);
      return;
    }

    setSalvandoOrdem(true);
    try {
      const res = await axios.patch(`/api/products/${productId}/images`, { imageIds });
      const nextImages = (res.data?.imagens ?? []) as ProdutoImagem[];
      setImagens(nextImages);
      setOrdem(nextImages.map((img) => imageKey(img.id)));
      setOrdemAlterada(false);
      await onAfterChangeCapa?.();
    } catch (err) {
      console.error("Erro ao salvar ordem das imagens:", err);
      if (isAxiosError(err)) {
        console.error("Resposta ao salvar ordem das imagens:", err.response?.data);
      }
      toast.error("Erro", { description: "Nao foi possivel salvar a ordem das imagens.", duration: 2500 });
    } finally {
      setSalvandoOrdem(false);
    }
  }, [onAfterChangeCapa, productId, setOrdem]);

  const onPick = useCallback((files: File[]) => {
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
    setOrdem([...ordemItensRef.current, ...novas.map((img) => pendingKey(img.id))], true);
  }, [setOrdem]);

  const removerImagemPendente = useCallback((id: string) => {
    const alvo = imagensPendentesRef.current.find((img) => img.id === id);
    if (alvo) URL.revokeObjectURL(alvo.previewUrl);
    imagensPendentesRef.current = imagensPendentesRef.current.filter((img) => img.id !== id);
    setImagensPendentes(imagensPendentesRef.current);
    setUploadProgressByPendingId((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setOrdem(ordemItensRef.current.filter((key) => key !== pendingKey(id)), true);
  }, [setOrdem]);

  const reordenarItens = useCallback((keys: string[]) => {
    setOrdem(keys, true);
  }, [setOrdem]);

  const uploadPendentes = useCallback(async () => {
    if (!productId) return;
    const pendingByKey = new Map(imagensPendentesRef.current.map((img) => [pendingKey(img.id), img]));
    const pendingKeysInOrder = ordemItensRef.current.filter((key) => pendingByKey.has(key));

    if (pendingKeysInOrder.length === 0) {
      await salvarOrdem();
      return;
    }

    setSubindoImagens(true);
    let nextOrder = [...ordemItensRef.current];
    const uploadedImages: ProdutoImagem[] = [];

    try {
      for (const key of pendingKeysInOrder) {
        const pending = pendingByKey.get(key);
        if (!pending) continue;

        const fd = new FormData();
        fd.append("files", pending.file);

        const res = await axios.post(`/api/products/${productId}/images`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (event) => {
            const total = event.total ?? pending.file.size;
            const pct = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
            setUploadProgressByPendingId((current) => ({ ...current, [pending.id]: pct }));
          },
        });

        const saved = (res.data?.imagens?.[0] ?? null) as ProdutoImagem | null;
        if (!saved) throw new Error("Upload concluido sem retorno da imagem.");

        URL.revokeObjectURL(pending.previewUrl);
        uploadedImages.push(saved);
        imagensPendentesRef.current = imagensPendentesRef.current.filter((img) => img.id !== pending.id);
        setImagensPendentes(imagensPendentesRef.current);
        setImagens((current) => [...current, saved]);
        nextOrder = nextOrder.map((itemKey) => (itemKey === key ? imageKey(saved.id) : itemKey));
        setOrdem(nextOrder, true);
        setUploadProgressByPendingId((current) => ({ ...current, [pending.id]: 100 }));
      }

      setUploadProgressByPendingId({});
      await salvarOrdem(nextOrder);
      toast.success("Sucesso!", { description: "Imagens enviadas e ordem atualizada.", duration: 2000 });
    } catch (err) {
      console.error("Erro ao enviar imagens:", err);
      toast.error("Erro", { description: "Nao foi possivel enviar todas as imagens.", duration: 2500 });
      if (uploadedImages.length > 0) await salvarOrdem(nextOrder);
    } finally {
      setSubindoImagens(false);
    }
  }, [productId, salvarOrdem, setOrdem]);

  const definirImagemPrincipal = useCallback(
    async (imageId: number) => {
      if (!productId) return;
      if (definindoCapaRef.current != null) return;

      definindoCapaRef.current = imageId;
      setDefinindoCapaImagemId(imageId);
      try {
        await axios.patch(`/api/products/${productId}/images/${imageId}`, { principal: true });
        toast.success("Sucesso!", { description: "Imagem principal atualizada.", duration: 2000 });
        await onAfterChangeCapa?.();
        await carregarImagens({ silent: true });
      } catch (err) {
        console.error("Erro ao definir imagem principal:", err);
        toast.error("Erro", { description: "Nao foi possivel definir a imagem principal.", duration: 2500 });
      } finally {
        definindoCapaRef.current = null;
        setDefinindoCapaImagemId(null);
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
        setOrdem(ordemItensRef.current.filter((key) => key !== imageKey(imageId)));
        await onAfterChangeCapa?.();
        await carregarImagens({ silent: true });
      } catch (err) {
        console.error("Erro ao remover imagem:", err);
        toast.error("Erro", { description: "Nao foi possivel remover a imagem.", duration: 2500 });
      } finally {
        setRemovendoImagemId(null);
      }
    },
    [carregarImagens, onAfterChangeCapa, productId, setOrdem]
  );

  useEffect(() => {
    if (productId) carregarImagens();
  }, [carregarImagens, productId]);

  useEffect(() => {
    return () => {
      imagensPendentesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      imagensPendentesRef.current = [];
    };
  }, []);

  return {
    imagens,
    imagensPendentes,
    ordemItens,
    ordemAlterada,
    uploadProgressByPendingId,
    carregandoImagens,
    subindoImagens,
    salvandoOrdem,
    removendoImagemId,
    definindoCapaImagemId,
    onPick,
    removerImagemPendente,
    reordenarItens,
    uploadPendentes,
    salvarOrdem,
    definirImagemPrincipal,
    removerImagem,
    carregarImagens,
  };
}
