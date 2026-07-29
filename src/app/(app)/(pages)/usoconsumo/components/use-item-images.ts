"use client";

import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import type { UsoConsumoImagem } from "@/types/usoconsumo";
import type { ProdutoImagemPendente } from "../../estoque/components/dialog-produto/tabs/produto-imagens-gallery";

function imageKey(id: number) {
  return `img-${id}`;
}

function pendingKey(id: string) {
  return `pending-${id}`;
}

function imageId(key: string) {
  return Number(key.replace("img-", ""));
}

export function useItemImages({
  itemId,
  onAfterMutation,
}: {
  itemId?: number;
  onAfterMutation?: () => Promise<void> | void;
}) {
  const [images, setImages] = useState<UsoConsumoImagem[]>([]);
  const [pending, setPending] = useState<ProdutoImagemPendente[]>([]);
  const [orderKeys, setOrderKeys] = useState<string[]>([]);
  const [orderChanged, setOrderChanged] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [definingMainId, setDefiningMainId] = useState<number | null>(null);
  const pendingRef = useRef<ProdutoImagemPendente[]>([]);
  const orderRef = useRef<string[]>([]);

  const setOrder = useCallback((keys: string[], changed = false) => {
    orderRef.current = keys;
    setOrderKeys(keys);
    if (changed) setOrderChanged(true);
  }, []);

  const reconcile = useCallback((nextImages: UsoConsumoImagem[]) => {
    const validImages = new Set(nextImages.map((image) => imageKey(image.id)));
    const validPending = new Set(pendingRef.current.map((image) => pendingKey(image.id)));
    const current = orderRef.current.filter((key) => validImages.has(key) || validPending.has(key));
    const missingImages = nextImages.map((image) => imageKey(image.id)).filter((key) => !current.includes(key));
    const missingPending = pendingRef.current.map((image) => pendingKey(image.id)).filter((key) => !current.includes(key));
    setOrder([...current, ...missingImages, ...missingPending]);
  }, [setOrder]);

  const load = useCallback(async (silent = false) => {
    if (!itemId) return;
    if (!silent) setLoading(true);
    try {
      const { data } = await axios.get(`/api/usoconsumo/itens/${itemId}/images`);
      const nextImages = (data.imagens ?? []) as UsoConsumoImagem[];
      setImages(nextImages);
      reconcile(nextImages);
    } catch {
      toast.error("Não foi possível carregar as imagens do item.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [itemId, reconcile]);

  const pick = useCallback((files: File[]) => {
    if (!files.length) return;
    const next = files.map((file) => ({
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    pendingRef.current = [...pendingRef.current, ...next];
    setPending(pendingRef.current);
    setOrder([...orderRef.current, ...next.map((image) => pendingKey(image.id))], true);
  }, [setOrder]);

  const removePending = useCallback((id: string) => {
    const target = pendingRef.current.find((image) => image.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    pendingRef.current = pendingRef.current.filter((image) => image.id !== id);
    setPending(pendingRef.current);
    setProgress((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setOrder(orderRef.current.filter((key) => key !== pendingKey(id)), true);
  }, [setOrder]);

  const reorder = useCallback((keys: string[]) => setOrder(keys, true), [setOrder]);

  const persistOrder = useCallback(async (keys = orderRef.current, targetItemId = itemId) => {
    if (!targetItemId) return;
    const ids = keys.filter((key) => key.startsWith("img-")).map(imageId);
    if (!ids.length) {
      setOrderChanged(false);
      return;
    }
    setSavingOrder(true);
    try {
      const { data } = await axios.patch(`/api/usoconsumo/itens/${targetItemId}/images`, { imageIds: ids });
      const nextImages = (data.imagens ?? []) as UsoConsumoImagem[];
      setImages(nextImages);
      setOrder(nextImages.map((image) => imageKey(image.id)));
      setOrderChanged(false);
    } finally {
      setSavingOrder(false);
    }
  }, [itemId, setOrder]);

  const upload = useCallback(async (targetItemId = itemId) => {
    if (!targetItemId) return;
    const byKey = new Map(pendingRef.current.map((image) => [pendingKey(image.id), image]));
    const keys = orderRef.current.filter((key) => byKey.has(key));
    if (!keys.length) {
      if (orderChanged) await persistOrder();
      return;
    }

    setUploading(true);
    let nextOrder = [...orderRef.current];
    try {
      for (const key of keys) {
        const selected = byKey.get(key);
        if (!selected) continue;
        const body = new FormData();
        body.append("files", selected.file);
        const { data } = await axios.post(`/api/usoconsumo/itens/${targetItemId}/images`, body, {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (event) => {
            const total = event.total ?? selected.file.size;
            const percentage = total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
            setProgress((current) => ({ ...current, [selected.id]: percentage }));
          },
        });
        const saved = (data.imagens?.[0] ?? null) as UsoConsumoImagem | null;
        if (!saved) throw new Error("Upload concluído sem retorno da imagem.");
        URL.revokeObjectURL(selected.previewUrl);
        pendingRef.current = pendingRef.current.filter((image) => image.id !== selected.id);
        setPending(pendingRef.current);
        setImages((current) => [...current, saved]);
        nextOrder = nextOrder.map((itemKey) => itemKey === key ? imageKey(saved.id) : itemKey);
        setOrder(nextOrder, true);
        setProgress((current) => ({ ...current, [selected.id]: 100 }));
      }
      setProgress({});
      await persistOrder(nextOrder, targetItemId);
      await onAfterMutation?.();
      toast.success("Imagens enviadas e ordem atualizada.");
    } catch {
      toast.error("Não foi possível enviar todas as imagens.");
      await load(true);
    } finally {
      setUploading(false);
    }
  }, [itemId, load, onAfterMutation, orderChanged, persistOrder, setOrder]);

  const defineMain = useCallback(async (id: number) => {
    if (!itemId || definingMainId != null) return;
    setDefiningMainId(id);
    try {
      await axios.patch(`/api/usoconsumo/itens/${itemId}/images/${id}`, { principal: true });
      await onAfterMutation?.();
      await load(true);
      toast.success("Imagem principal atualizada.");
    } catch {
      toast.error("Não foi possível definir a imagem principal.");
    } finally {
      setDefiningMainId(null);
    }
  }, [definingMainId, itemId, load, onAfterMutation]);

  const remove = useCallback(async (id: number) => {
    if (!itemId) return;
    setRemovingId(id);
    try {
      await axios.delete(`/api/usoconsumo/itens/${itemId}/images/${id}`);
      setOrder(orderRef.current.filter((key) => key !== imageKey(id)));
      await onAfterMutation?.();
      await load(true);
      toast.success("Imagem removida.");
    } catch {
      toast.error("Não foi possível remover a imagem.");
    } finally {
      setRemovingId(null);
    }
  }, [itemId, load, onAfterMutation, setOrder]);

  useEffect(() => {
    if (itemId) void load();
  }, [itemId, load]);

  useEffect(() => () => {
    pendingRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    pendingRef.current = [];
  }, []);

  return {
    images,
    pending,
    orderKeys,
    orderChanged,
    progress,
    loading,
    uploading,
    savingOrder,
    removingId,
    definingMainId,
    pick,
    removePending,
    reorder,
    upload,
    persistOrder,
    defineMain,
    remove,
  };
}
