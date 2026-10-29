"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "@/lib/toast";
import { prepareProductImageForUpload, productImageUploadError } from "@/lib/product-image-upload";
import { imageKey, pendingKey, type GaleriaImagem, type ImagemPendente } from "./galeria-midia";

const isImageKey = (key: string) => key.startsWith("img-");
const idFromImageKey = (key: string) => Number(key.replace("img-", ""));
const isImageFile = (file: File) => file.type.startsWith("image/") || /\.hei[cf]$/i.test(file.name);

function apiError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) return String(error.response?.data?.error ?? "").trim() || fallback;
  return error instanceof Error ? error.message : fallback;
}

/**
 * Galeria do anúncio do imóvel. Mesmo fluxo da galeria de produtos: as fotos
 * escolhidas ficam pendentes (dá para reordenar e descartar antes do envio) e
 * sobem uma a uma, na ordem da tela. A posição é gravada no banco e o site
 * exibe a galeria nessa ordem, com a primeira foto como capa.
 *
 * Sem `imovelId` (cadastro novo) as fotos só ficam pendentes; o diálogo chama
 * `uploadPendentes(id)` assim que o imóvel é criado.
 */
export function useImovelMidia(imovelId: number | undefined) {
  const [imagens, setImagens] = useState<GaleriaImagem[]>([]);
  const [imagensPendentes, setImagensPendentes] = useState<ImagemPendente[]>([]);
  const [ordemItens, setOrdemItens] = useState<string[]>([]);
  const imagensPendentesRef = useRef<ImagemPendente[]>([]);
  const ordemItensRef = useRef<string[]>([]);
  const ordemSalvaRef = useRef<string>("");
  const subindoRef = useRef(false);
  // Cada alteração avança a geração; leitura iniciada antes dela chega velha e é descartada.
  const geracaoRef = useRef(0);
  const [uploadProgressByPendingId, setUploadProgressByPendingId] = useState<Record<string, number>>({});
  const [carregandoImagens, setCarregandoImagens] = useState(false);
  const [subindoImagens, setSubindoImagens] = useState(false);
  const [salvandoOrdem, setSalvandoOrdem] = useState(false);
  const [removendoImagemId, setRemovendoImagemId] = useState<number | null>(null);
  const [definindoCapaImagemId, setDefinindoCapaImagemId] = useState<number | null>(null);

  const setOrdem = useCallback((keys: string[]) => {
    ordemItensRef.current = keys;
    setOrdemItens(keys);
  }, []);

  /** Aplica a galeria do servidor mantendo a posição das pendentes na tela. */
  const aplicarGaleria = useCallback(
    (nextImages: GaleriaImagem[]) => {
      setImagens(nextImages);
      ordemSalvaRef.current = nextImages.map((img) => img.id).join(",");
      const imageKeys = new Set(nextImages.map((img) => imageKey(img.id)));
      const pendingKeys = new Set(imagensPendentesRef.current.map((img) => pendingKey(img.id)));
      const savedInServerOrder = nextImages.map((img) => imageKey(img.id));
      // Fotos salvas seguem a ordem do servidor; pendentes ficam onde o usuário as pôs.
      let saved = 0;
      const merged = ordemItensRef.current
        .filter((key) => imageKeys.has(key) || pendingKeys.has(key))
        .map((key) => (isImageKey(key) ? savedInServerOrder[saved++] : key));
      const missingSaved = savedInServerOrder.slice(saved);
      const missingPending = [...pendingKeys].filter((key) => !merged.includes(key));
      setOrdem([...merged, ...missingSaved, ...missingPending]);
    },
    [setOrdem]
  );

  const carregarImagens = useCallback(
    async (id = imovelId) => {
      if (!id) return;
      const geracao = geracaoRef.current;
      setCarregandoImagens(true);
      try {
        const res = await axios.get(`/api/imoveis/${id}/arquivos`, { params: { tipo: "FOTO" } });
        // Um envio ou reordenação em andamento é dono do estado; a resposta dele traz a galeria final.
        if (subindoRef.current || geracao !== geracaoRef.current) return;
        aplicarGaleria(((res.data?.items ?? []) as any[]).filter((row) => row.publico && row.url));
      } catch (error) {
        toast.error("Erro", { description: apiError(error, "Não foi possível carregar as fotos do imóvel.") });
      } finally {
        setCarregandoImagens(false);
      }
    },
    [aplicarGaleria, imovelId]
  );

  /** Grava a sequência das fotos já enviadas; pendentes entram depois do envio. */
  const salvarOrdem = useCallback(
    async (keys = ordemItensRef.current, id = imovelId) => {
      if (!id) return;
      const ids = keys.filter(isImageKey).map(idFromImageKey);
      if (ids.length === 0 || ids.join(",") === ordemSalvaRef.current) return;

      geracaoRef.current += 1;
      setSalvandoOrdem(true);
      try {
        const res = await axios.patch(`/api/imoveis/${id}/arquivos`, { ids });
        aplicarGaleria((res.data?.items ?? []) as GaleriaImagem[]);
      } catch (error) {
        toast.error("Ordem não salva", { description: apiError(error, "Não foi possível salvar a ordem das fotos.") });
        // Volta para o que está gravado: a tela não pode prometer uma ordem que o site não tem.
        await carregarImagens(id);
      } finally {
        setSalvandoOrdem(false);
      }
    },
    [aplicarGaleria, carregarImagens, imovelId]
  );

  const onPick = useCallback(
    (files: File[]) => {
      const aceitas = files.filter(isImageFile);
      const recusadas = files.length - aceitas.length;
      if (recusadas > 0) {
        toast.error("Arquivo ignorado", {
          description: `${recusadas} arquivo(s) não são imagens. Documentos vão na aba Anexos.`,
        });
      }
      if (aceitas.length === 0) return;

      const novas = aceitas.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      imagensPendentesRef.current = [...imagensPendentesRef.current, ...novas];
      setImagensPendentes(imagensPendentesRef.current);
      setOrdem([...ordemItensRef.current, ...novas.map((img) => pendingKey(img.id))]);
    },
    [setOrdem]
  );

  const removerImagemPendente = useCallback(
    (id: string) => {
      const alvo = imagensPendentesRef.current.find((img) => img.id === id);
      if (alvo) URL.revokeObjectURL(alvo.previewUrl);
      imagensPendentesRef.current = imagensPendentesRef.current.filter((img) => img.id !== id);
      setImagensPendentes(imagensPendentesRef.current);
      setUploadProgressByPendingId((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setOrdem(ordemItensRef.current.filter((key) => key !== pendingKey(id)));
    },
    [setOrdem]
  );

  const reordenarItens = useCallback((keys: string[]) => setOrdem(keys), [setOrdem]);

  /** Ao soltar o card: grava na hora, a menos que haja pendentes (aí grava junto com o envio). */
  const finalizarReordenacao = useCallback(
    (keys: string[]) => {
      setOrdem(keys);
      if (imagensPendentesRef.current.length === 0) void salvarOrdem(keys);
    },
    [salvarOrdem, setOrdem]
  );

  const uploadPendentes = useCallback(
    async (idOverride?: number) => {
      const id = idOverride ?? imovelId;
      if (!id || subindoRef.current) return;
      const pendingByKey = new Map(imagensPendentesRef.current.map((img) => [pendingKey(img.id), img]));
      const pendingKeysInOrder = ordemItensRef.current.filter((key) => pendingByKey.has(key));
      if (pendingKeysInOrder.length === 0) {
        await salvarOrdem(ordemItensRef.current, id);
        return;
      }

      subindoRef.current = true;
      geracaoRef.current += 1;
      setSubindoImagens(true);
      let nextOrder = [...ordemItensRef.current];
      const uploadErrors: string[] = [];
      let enviadas = 0;

      try {
        for (const key of pendingKeysInOrder) {
          const pending = pendingByKey.get(key);
          if (!pending) continue;
          try {
            const arquivo = await prepareProductImageForUpload(pending.file);
            const fd = new FormData();
            fd.append("file", arquivo);
            fd.append("tipo", "FOTO");
            fd.append("titulo", pending.file.name);
            const res = await axios.post(`/api/imoveis/${id}/arquivos`, fd, {
              onUploadProgress: (event) => {
                const total = event.total ?? arquivo.size;
                // 95%: o servidor ainda converte a foto depois de receber os bytes.
                const pct = total > 0 ? Math.min(95, Math.round((event.loaded / total) * 95)) : 0;
                setUploadProgressByPendingId((current) => ({ ...current, [pending.id]: pct }));
              },
            });
            const saved = res.data?.item as GaleriaImagem | undefined;
            if (!saved?.id || !saved.url) throw new Error("Envio concluído sem retorno da imagem.");

            enviadas += 1;
            URL.revokeObjectURL(pending.previewUrl);
            imagensPendentesRef.current = imagensPendentesRef.current.filter((img) => img.id !== pending.id);
            setImagensPendentes(imagensPendentesRef.current);
            setImagens((current) => [...current, saved]);
            nextOrder = nextOrder.map((itemKey) => (itemKey === key ? imageKey(saved.id) : itemKey));
            setOrdem(nextOrder);
          } catch (error) {
            uploadErrors.push(productImageUploadError(error, pending.file.name));
            setUploadProgressByPendingId((current) => ({ ...current, [pending.id]: 0 }));
          }
        }
      } finally {
        subindoRef.current = false;
        setSubindoImagens(false);
      }

      if (enviadas > 0) {
        // A posição na tela vira a posição no site.
        ordemSalvaRef.current = "";
        await salvarOrdem(nextOrder, id);
      }
      if (uploadErrors.length > 0) {
        toast.error("Algumas imagens não foram enviadas", {
          description: `${uploadErrors.length} imagem(ns) continuam pendentes. ${uploadErrors[0]}`,
          duration: 6000,
        });
      } else {
        setUploadProgressByPendingId({});
        toast.success("Fotos enviadas", { description: "A galeria do site segue a ordem mostrada aqui." });
      }
    },
    [imovelId, salvarOrdem, setOrdem]
  );

  /** A capa do site é a primeira foto: definir capa é levar a foto para o início. */
  const definirCapa = useCallback(
    async (imageId: number) => {
      if (!imovelId || definindoCapaImagemId != null) return;
      const key = imageKey(imageId);
      const keys = [key, ...ordemItensRef.current.filter((item) => item !== key)];
      setOrdem(keys);
      setDefinindoCapaImagemId(imageId);
      try {
        await salvarOrdem(keys);
      } finally {
        setDefinindoCapaImagemId(null);
      }
    },
    [definindoCapaImagemId, imovelId, salvarOrdem, setOrdem]
  );

  const removerImagem = useCallback(
    async (imageId: number) => {
      if (!imovelId) return;
      setRemovendoImagemId(imageId);
      try {
        await axios.delete(`/api/imoveis/${imovelId}/arquivos/${imageId}`);
        setOrdem(ordemItensRef.current.filter((key) => key !== imageKey(imageId)));
        toast.success("Imagem removida");
        await carregarImagens();
      } catch (error) {
        toast.error("Erro", { description: apiError(error, "Não foi possível remover a imagem.") });
      } finally {
        setRemovendoImagemId(null);
      }
    },
    [carregarImagens, imovelId, setOrdem]
  );

  useEffect(() => {
    if (imovelId) void carregarImagens(imovelId);
  }, [carregarImagens, imovelId]);

  useEffect(() => {
    return () => {
      imagensPendentesRef.current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      imagensPendentesRef.current = [];
    };
  }, []);

  const capaKey = ordemItens.find(isImageKey);
  const capaUrl = capaKey ? imagens.find((img) => imageKey(img.id) === capaKey)?.url ?? null : null;

  return {
    imagens,
    imagensPendentes,
    ordemItens,
    capaUrl,
    uploadProgressByPendingId,
    carregandoImagens,
    subindoImagens,
    salvandoOrdem,
    removendoImagemId,
    definindoCapaImagemId,
    onPick,
    removerImagemPendente,
    reordenarItens,
    finalizarReordenacao,
    uploadPendentes,
    salvarOrdem,
    definirCapa,
    removerImagem,
    carregarImagens,
  };
}

export type ImovelMidia = ReturnType<typeof useImovelMidia>;
