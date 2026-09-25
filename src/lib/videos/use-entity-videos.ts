"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadVideo, videoRequest } from "./client";

export type EntityKind = "os" | "produto" | "venda";
export type EntityVideo = { id: string; name: string; size_bytes: number; duration_seconds: number; created_at: string; category?: string | null };

export function useEntityVideos(entityId: number | null | undefined, kind: EntityKind, active = true) {
  const [videos, setVideos] = useState<EntityVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);
  const requestId = useRef(0);
  const signedUrls = useRef(new Map<string, { url: string; at: number }>());
  const target = entityId ? { osId: entityId, itemId: entityId, kind } : null;

  const refresh = useCallback(async () => {
    if (!entityId || !active) return;
    const current = ++requestId.current;
    const response = await fetch(`/api/checklist-videos?osId=${entityId}&scope=${kind}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Não foi possível carregar os vídeos.");
    if (current === requestId.current) {
      setVideos(json.items ?? []);
      setEnabled(json.service?.enabled === true);
      setCanEdit(json.canEdit === true);
      setCanDelete(json.canDelete === true);
    }
  }, [entityId, kind, active]);

  useEffect(() => {
    let mounted = true;
    setLoading(Boolean(entityId && active));
    signedUrls.current.clear();
    setVideos([]);
    setEnabled(false);
    setCanEdit(false);
    setCanDelete(false);
    setError("");
    setViewing(null);
    void refresh()
      .catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : "Falha ao carregar vídeos."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; requestId.current += 1; };
  }, [refresh, entityId, active]);

  const upload = async (file: File, category?: string) => {
    if (!target || !enabled || !canEdit) throw new Error("Envio de vídeos não liberado para este cadastro.");
    if (busy) throw new Error("Aguarde o envio atual terminar.");
    setError("");
    try {
      await uploadVideo(file, { ...target, category }, setBusy);
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha no envio do vídeo.";
      setError(message);
      throw cause;
    } finally { setBusy(""); }
  };

  const remove = async (id: string) => {
    if (!target || !canDelete || !canEdit) throw new Error("Sem permissão para excluir o vídeo.");
    setBusy("Excluindo vídeo...");
    try {
      await videoRequest({ action: "delete", id, ...target });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao excluir o vídeo.");
      throw cause;
    } finally { setBusy(""); }
  };

  const access = useCallback((id: string, download = false) => {
    if (!entityId) throw new Error("Cadastro indisponível.");
    const cached = signedUrls.current.get(id);
    if (!download && cached && Date.now() - cached.at < 10 * 60 * 1000) return Promise.resolve({ url: cached.url });
    return (videoRequest({ action: "access", id, osId: entityId, itemId: entityId, kind, download }) as Promise<{ url: string }>)
      .then(result => {
        if (!download) signedUrls.current.set(id, { url: result.url, at: Date.now() });
        return result;
      });
  }, [entityId, kind]);

  const open = useCallback((id: string) => {
    setViewing({ id, name: videos.find((video) => video.id === id)?.name ?? "Vídeo" });
  }, [videos]);

  const download = async (id: string) => {
    const { url } = await access(id, true);
    const link = document.createElement("a");
    link.href = url;
    link.download = "video.mp4";
    link.click();
  };

  return { videos, loading, enabled, canEdit, canDelete, busy, error, viewing, closeViewer: () => setViewing(null), refresh, upload, remove, access, open, download };
}
