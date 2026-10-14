"use client";
import { downloadChecklistFile, ChecklistPhotoCard, PendingVideos, useVideoEnabled } from "@/components/checklist-videos";
import { uploadVideo } from "@/lib/videos/client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DialogShell } from "./dialog-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { listarChecklistModelos, type ChecklistTemplateModel } from "../../lib/api";
import { ChecklistImagePreview } from "./checklist-image-preview";

// Registro de checklist com modelo, marcação OK/ALERTA/FALHA, observação e fotos
// por item. É a tela de "Checklist" das ações da OS; quem usa entrega uma
// `FonteChecklist` com o que muda entre os módulos: onde carregar, onde gravar e
// para onde vão as fotos. Os itens são casados pelo título, como na OS.

const CHECK_OPTIONS = ["OK", "ALERTA", "FALHA"] as const;
type Marcacao = (typeof CHECK_OPTIONS)[number] | "";
export type StatusChecklist = (typeof CHECK_OPTIONS)[number];

const toDbStatus = (sel: Marcacao): StatusChecklist | null =>
  sel === "OK" || sel === "ALERTA" || sel === "FALHA" ? sel : null;

export type FotoChecklistGravada = {
  id: number;
  url: string;
  descricao?: string | null;
};

export type ItemChecklistGravado = {
  /** Id do item gravado; é o alvo das fotos. */
  id: number;
  titulo: string;
  status?: string | null;
  observacao?: string | null;
  imagens?: FotoChecklistGravada[];
};

export type ChecklistGravado = {
  modeloId: string | null;
  itens: ItemChecklistGravado[];
};

/** Um item por item do modelo, na ordem do modelo. Sem marcação: status null. */
export type ItemChecklistEnvio = {
  titulo: string;
  descricao: string | null;
  status: StatusChecklist | null;
  observacao: string | null;
};

export type FonteChecklist = {
  /** Identidade do checklist aberto; mudou, o formulário recomeça. */
  chave: string;
  carregar: () => Promise<ChecklistGravado>;
  /** Grava e devolve o id de cada item gravado, pelo título. */
  salvar: (dados: { modeloId: string | null; itens: ItemChecklistEnvio[] }) => Promise<Record<string, number>>;
  enviarFotos: (fotosPorTitulo: Record<string, File[]>, idPorTitulo: Record<string, number>) => Promise<void>;
  excluirFoto: (itemId: number, fotoId: number) => Promise<void>;
  /** Vídeos só existem na OS: o armazenamento é por OS. */
  videos?: { osId: number };
  aoSalvar?: () => void;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fonte: FonteChecklist;
  titulo: ReactNode;
  descricao: string;
  mensagemSucesso?: string;
};

type SavedVideo = { id: string; item_id: number; kind: "entrada"; name: string; size_bytes: number; duration_seconds: number };

export function ChecklistRegistroDialog({
  open,
  onOpenChange,
  fonte,
  titulo,
  descricao,
  mensagemSucesso = "Checklist atualizado com sucesso.",
}: Props) {
  // A fonte costuma ser recriada a cada render do pai; os effects leem a última.
  const fonteRef = useRef(fonte);
  useEffect(() => {
    fonteRef.current = fonte;
  });
  const chave = fonte.chave;
  const videoOsId = fonte.videos?.osId ?? 0;

  const [saving, setSaving] = useState(false);
  const planoComVideo = useVideoEnabled(open && Boolean(videoOsId));
  const videoEnabled = Boolean(videoOsId) && planoComVideo;
  const [videosByItem, setVideosByItem] = useState<Record<string, File[]>>({});
  const [videoProgress, setVideoProgress] = useState("");
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingError, setExistingError] = useState<string | null>(null);
  const [jaGravado, setJaGravado] = useState(false);

  // modelos
  const [templates, setTemplates] = useState<ChecklistTemplateModel[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  // selecao do modelo e itens
  const [templateId, setTemplateId] = useState("");
  const [templateItems, setTemplateItems] = useState<ChecklistTemplateModel["itens"]>([]);

  // marcacoes
  const [checklist, setChecklist] = useState<Record<string, Marcacao>>({});
  const [obsByItem, setObsByItem] = useState<Record<string, string>>({});
  const [imagesByItem, setImagesByItem] = useState<Record<string, File[]>>({});
  const [previewUrlsByItem, setPreviewUrlsByItem] = useState<Record<string, string[]>>({});
  const [existingImagesByItem, setExistingImagesByItem] = useState<Record<string, FotoChecklistGravada[]>>({});
  const [existingChecklistIds, setExistingChecklistIds] = useState<Record<string, number>>({});
  const [savedVideos, setSavedVideos] = useState<SavedVideo[]>([]);
  const [canDeleteSavedVideos, setCanDeleteSavedVideos] = useState(false);
  const [savedVideosLoading, setSavedVideosLoading] = useState(false);
  const [savedVideosError, setSavedVideosError] = useState("");

  const initialSnapshotRef = useRef<string>("");
  const checklistIdByItemRef = useRef<Record<string, number>>({});
  const pendingApplyRef = useRef<null | {
    templateId: string;
    statusByItem: Record<string, Marcacao>;
    obsByItem: Record<string, string>;
  }>(null);

  const [pendingApply, setPendingApply] = useState(false);

  const computeSnapshot = useCallback(
    (next?: {
      templateId?: string;
      templateItems?: ChecklistTemplateModel["itens"];
      checklist?: Record<string, Marcacao>;
      obsByItem?: Record<string, string>;
    }) => {
      const tId = next?.templateId ?? templateId;
      const items = next?.templateItems ?? templateItems;
      const chk = next?.checklist ?? checklist;
      const obs = next?.obsByItem ?? obsByItem;

      const keys = (items ?? []).map((it) => it?.titulo ?? "").filter(Boolean);
      return JSON.stringify({
        templateId: tId || null,
        keys,
        checklist: Object.fromEntries(keys.map((k) => [k, chk[k] ?? ""])),
        obs: Object.fromEntries(keys.map((k) => [k, (obs[k] ?? "").trim()])),
      });
    },
    [checklist, obsByItem, templateId, templateItems]
  );

  const hasAnyNewImage = useMemo(() => [...Object.values(imagesByItem), ...Object.values(videosByItem)].some(arr => arr.length > 0), [imagesByItem, videosByItem]);
  const isDirty = useMemo(() => computeSnapshot() !== initialSnapshotRef.current, [computeSnapshot]);
  // Checklist ainda não gravado: escolher o modelo já basta para salvar.
  const primeiroRegistro = !jaGravado && Boolean(templateId);

  const resetForm = useCallback(() => {
    setSaving(false);
    setTemplatesError(null);
    setTemplateId("");
    setTemplateItems([]);
    setChecklist({});
    setObsByItem({});
    setImagesByItem({});
    setVideosByItem({});
    setVideoProgress("");
    setPreviewUrlsByItem((prev) => {
      Object.values(prev).flat().forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    setExistingImagesByItem({});
    setExistingError(null);
    setJaGravado(false);
    setPendingApply(false);
    pendingApplyRef.current = null;
    checklistIdByItemRef.current = {};
    initialSnapshotRef.current = "";
  }, []);

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!v) resetForm();
      onOpenChange(v);
    },
    [onOpenChange, resetForm]
  );

  // carrega modelos quando o dialog abre
  useEffect(() => {
    if (!open) return;

    (async () => {
      try {
        setLoadingTemplates(true);
        setTemplatesError(null);

        const list = await listarChecklistModelos(true);
        setTemplates(list);
      } catch (e: any) {
        setTemplatesError(e?.message ?? "Nao foi possivel carregar os modelos de checklist.");
        setTemplates([]);
      } finally {
        setLoadingTemplates(false);
      }
    })();
  }, [open]);

  // se trocar de checklist com o dialog aberto, limpa para nao "herdar" dados
  useEffect(() => {
    if (!open) return;
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const applyTemplate = useCallback(
    (
      id: string,
      opts?: {
        statusByItem?: Record<string, Marcacao>;
        obsByItem?: Record<string, string>;
      }
    ) => {
      setTemplateId(id);

      const itens = (templates.find((t) => t.id === id)?.itens ?? []).filter(Boolean);
      setTemplateItems(itens);

      const novoChecklist: Record<string, Marcacao> = {};
      const novoObs: Record<string, string> = {};
      const novoImgs: Record<string, File[]> = {};

      itens.forEach((it) => {
        if (!it.titulo) return;
        novoChecklist[it.titulo] = opts?.statusByItem?.[it.titulo] ?? "";
        novoObs[it.titulo] = opts?.obsByItem?.[it.titulo] ?? "";
        novoImgs[it.titulo] = [];
      });

      setChecklist(novoChecklist);
      setObsByItem(novoObs);
      setImagesByItem(novoImgs);
      setVideosByItem({});
      setPreviewUrlsByItem((prev) => {
        Object.values(prev).flat().forEach((url) => URL.revokeObjectURL(url));
        return {};
      });

      initialSnapshotRef.current = computeSnapshot({
        templateId: id,
        templateItems: itens,
        checklist: novoChecklist,
        obsByItem: novoObs,
      });
    },
    [templates, computeSnapshot]
  );

  // Vídeos já gravados (só OS)
  useEffect(() => {
    if (!open || !videoOsId) return;
    let active = true;
    setSavedVideos([]);
    setSavedVideosError("");
    setSavedVideosLoading(true);
    void fetch(`/api/checklist-videos?osId=${videoOsId}&scope=checklist`, { cache: "no-store" })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível carregar os vídeos."); return body; })
      .then(body => { if (active) { setCanDeleteSavedVideos(body.canDelete === true); setSavedVideos((body.items ?? []).filter((item: { kind: string }) => item.kind === "entrada")); } })
      .catch(cause => { if (active) setSavedVideosError(cause instanceof Error ? cause.message : "Não foi possível carregar os vídeos."); })
      .finally(() => { if (active) setSavedVideosLoading(false); });
    return () => { active = false; };
  }, [open, videoOsId]);

  // Carrega checklist existente (se houver) para abrir para edicao
  useEffect(() => {
    if (!open || !chave) return;
    let active = true;

    (async () => {
      try {
        setLoadingExisting(true);
        setExistingError(null);
        setExistingChecklistIds({});

        const gravado = await fonteRef.current.carregar();
        if (!active) return;

        const templateFromSaved = gravado.modeloId ? String(gravado.modeloId) : "";
        setJaGravado(Boolean(templateFromSaved) || gravado.itens.length > 0);

        const statusByItem: Record<string, Marcacao> = {};
        const obsMap: Record<string, string> = {};
        const imgsByItem: Record<string, FotoChecklistGravada[]> = {};
        const ckIdByItem: Record<string, number> = {};
        for (const row of gravado.itens) {
          const item = String(row?.titulo ?? "").trim();
          if (!item) continue;
          const s = String(row?.status ?? "").toUpperCase();
          statusByItem[item] = (s === "OK" || s === "ALERTA" || s === "FALHA" ? s : "") as Marcacao;
          obsMap[item] = String(row?.observacao ?? "").trim();

          const ckId = Number(row?.id);
          if (Number.isFinite(ckId) && ckId > 0) ckIdByItem[item] = ckId;

          imgsByItem[item] = (row.imagens ?? [])
            .map((im) => ({
              id: Number(im?.id),
              url: String(im?.url ?? ""),
              descricao: (im?.descricao ?? null) as string | null,
            }))
            .filter((im) => Number.isFinite(im.id) && im.id > 0 && !!im.url);
        }

        checklistIdByItemRef.current = ckIdByItem;
        setExistingChecklistIds(ckIdByItem);
        setExistingImagesByItem(imgsByItem);

        if (templateFromSaved) {
          setTemplateId(templateFromSaved);
          initialSnapshotRef.current = computeSnapshot({
            templateId: templateFromSaved,
            templateItems: [],
            checklist: {},
            obsByItem: {},
          });

          if (templates.length) {
            applyTemplate(templateFromSaved, { statusByItem, obsByItem: obsMap });
          } else {
            pendingApplyRef.current = { templateId: templateFromSaved, statusByItem, obsByItem: obsMap };
            setPendingApply(true);
          }
          return;
        }

        // Sem modelo vinculado: se existir checklist, mostra os itens existentes como "template" editavel.
        if (gravado.itens.length) {
          const itens = gravado.itens
            .map((r) => ({ titulo: String(r?.titulo ?? "").trim(), descricao: null, obrigatorio: false }))
            .filter((x) => x.titulo);

          setTemplateId("");
          setTemplateItems(itens as any);
          setChecklist(statusByItem);
          setObsByItem(obsMap);
          setImagesByItem(Object.fromEntries(itens.map((it) => [it.titulo, []])));
          setPreviewUrlsByItem({});
          setExistingImagesByItem(imgsByItem);
          checklistIdByItemRef.current = ckIdByItem;

          initialSnapshotRef.current = computeSnapshot({
            templateId: "",
            templateItems: itens as any,
            checklist: statusByItem,
            obsByItem: obsMap,
          });
        }
      } catch (e: any) {
        if (active) setExistingError(e?.message ?? "Nao foi possivel carregar o checklist existente.");
      } finally {
        if (active) setLoadingExisting(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chave]);

  // Se carregamos os templates depois, aplica o prefill pendente (se existir)
  useEffect(() => {
    if (!open) return;
    const p = pendingApplyRef.current;
    if (!p) return;
    if (!templates.length) return;

    pendingApplyRef.current = null;
    applyTemplate(p.templateId, { statusByItem: p.statusByItem, obsByItem: p.obsByItem });
    setPendingApply(false);
  }, [open, templates.length, applyTemplate]);

  const validateAll = (): string | null => {
    if (!chave) return "Registro invalido.";
    if (!templateId && templateItems.length === 0) return "Selecione um modelo de checklist.";

    // valida obrigatorios apenas quando temos modelo (itens com `obrigatorio`)
    if (templateId && templateItems?.length) {
      const faltando = templateItems.filter((it) => it.obrigatorio).filter((it) => !checklist[it.titulo]);
      if (faltando.length) {
        const nomes = faltando
          .slice(0, 3)
          .map((f) => f.titulo)
          .join(", ");
        return `Marque todos os itens obrigatorios do checklist. Ex.: ${nomes}${faltando.length > 3 ? "..." : ""}`;
      }
    }

    const semStatusComImagem = Object.keys(imagesByItem).filter(
      (k) => (imagesByItem[k]?.length ?? 0) > 0 && !toDbStatus(checklist[k] as Marcacao)
    );
    if (semStatusComImagem.length) {
      return `Ha imagens em itens sem status: ${semStatusComImagem.slice(0, 3).join(", ")}${
        semStatusComImagem.length > 3 ? "..." : ""
      }. Marque OK/ALERTA/FALHA antes de anexar imagens.`;
    }

    return null;
  };

  const onPickFiles = (itemTitle: string, files: FileList | File[] | null) => {
    if (!files?.length) return;
    const picked = Array.from(files);
    setImagesByItem((prev) => ({
      ...prev,
      [itemTitle]: [...(prev[itemTitle] ?? []), ...picked],
    }));
    setPreviewUrlsByItem((prev) => ({
      ...prev,
      [itemTitle]: [...(prev[itemTitle] ?? []), ...picked.map((file) => URL.createObjectURL(file))],
    }));
  };

  const removeFile = (itemTitle: string, idx: number) => {
    setImagesByItem((prev) => {
      const list = [...(prev[itemTitle] ?? [])];
      list.splice(idx, 1);
      return { ...prev, [itemTitle]: list };
    });
    setPreviewUrlsByItem((prev) => {
      const list = [...(prev[itemTitle] ?? [])];
      const [removed] = list.splice(idx, 1);
      if (removed) URL.revokeObjectURL(removed);
      return { ...prev, [itemTitle]: list };
    });
  };

  const removeExistingImage = async (itemTitle: string, imageId: number) => {
    const checklistId = checklistIdByItemRef.current[itemTitle];
    if (!checklistId) {
      toast.error("Nao foi possivel identificar o checklist deste item.");
      return;
    }

    if (!window.confirm("Excluir permanentemente esta foto?")) return;

    try {
      await fonteRef.current.excluirFoto(checklistId, imageId);
      setExistingImagesByItem((prev) => ({
        ...prev,
        [itemTitle]: (prev[itemTitle] ?? []).filter((im) => im.id !== imageId),
      }));

      toast.success("Imagem removida.");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao excluir imagem");
      // reverter: recarrega do backend na proxima abertura; aqui evitamos duplicar chamada.
    }
  };

  const salvar = async () => {
    if (saving) return;
    const unmarkedVideo = Object.entries(videosByItem).find(([title, files]) => files.length && !toDbStatus(checklist[title]));
    if (unmarkedVideo) { toast.error(`Marque o item ${unmarkedVideo[0]} antes de enviar o vídeo.`); return; }

    const err = validateAll();
    if (err) {
      toast.error(err);
      return;
    }

    const shouldSaveChecklist = isDirty || hasAnyNewImage || primeiroRegistro;
    if (!shouldSaveChecklist) {
      toast.message("Nenhuma alteracao para salvar.");
      return;
    }

    setSaving(true);
    try {
      const fonteAtual = fonteRef.current;
      const itens: ItemChecklistEnvio[] = templateItems
        .filter((it) => it.titulo)
        .map((it) => ({
          titulo: it.titulo,
          descricao: it.descricao ?? null,
          status: toDbStatus((checklist[it.titulo] ?? "") as Marcacao),
          observacao: (obsByItem[it.titulo] || "").trim() || null,
        }));

      // 1) Salva checklist
      const mapItemToChecklistId = await fonteAtual.salvar({ modeloId: templateId || null, itens });

      // 2) Upload de imagens
      const hasAnyImage = Object.values(imagesByItem).some((arr) => (arr?.length ?? 0) > 0);
      if (hasAnyImage) {
        await fonteAtual.enviarFotos(imagesByItem, mapItemToChecklistId);
      }

      setImagesByItem({});
      // Checklist is already saved. Successful files are removed from the retry queue.
      for (const [title, files] of Object.entries(videosByItem)) {
        const itemId = mapItemToChecklistId[title];
        if (files.length && !itemId) throw new Error(`Marque o item ${title} para anexar vídeos.`);
        for (const file of files) {
          await uploadVideo(file, { osId: videoOsId, itemId, kind: "entrada" }, setVideoProgress);
          setVideosByItem(prev => ({ ...prev, [title]: (prev[title] ?? []).filter(f => f !== file) }));
        }
      }
      toast.success(mensagemSucesso);
      fonteAtual.aoSalvar?.();

      initialSnapshotRef.current = computeSnapshot();

      resetForm();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar checklist");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title={titulo}
      description={descricao}
      maxW="md:max-w-[1100px]"
      mobileFull
      fixedHeight
      footer={
        <>
          <Button variant="outline" className="bg-transparent" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={salvar}
            disabled={
              saving ||
              !chave ||
              (templateItems.length === 0 && !templateId) ||
              (!isDirty && !hasAnyNewImage && !primeiroRegistro) ||
              loadingExisting ||
              savedVideosLoading ||
              pendingApply
            }
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar alterações"
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {existingError ? <p className="text-sm text-red-500">{existingError}</p> : null}
        {savedVideosError ? <p role="alert" className="text-sm text-destructive">{savedVideosError}</p> : null}
        {(loadingExisting || savedVideosLoading || pendingApply) ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando checklist e anexos...
          </div>
        ) : null}

        {/* MODELO DE CHECKLIST */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <Label className="font-medium">Modelo de checklist</Label>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <Select
              value={templateId}
              onValueChange={(id) => applyTemplate(id)}
              disabled={loadingTemplates || (!!templatesError && templates.length === 0) || saving || loadingExisting || pendingApply}
            >
              <SelectTrigger className="h-10 w-full sm:w-[380px] min-w-[220px] truncate relative pr-9">
                <SelectValue
                  placeholder={
                    loadingTemplates ? "Carregando..." : templates.length ? "Selecione um modelo" : "Nenhum modelo disponivel"
                  }
                />
                {(loadingTemplates || loadingExisting || pendingApply) && (
                  <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 opacity-70" />
                )}
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={6} className="w-[var(--radix-select-trigger-width)]">
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="truncate">
                    {t.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {templatesError && <p className="text-sm text-red-500">{templatesError}</p>}
          </div>
        </div>

        {/* ITENS DO CHECKLIST */}
        {loadingExisting || savedVideosLoading || pendingApply ? null : templateItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {templateItems.map((it) => {
              const key = it.titulo ?? "";
              const marcado = checklist[key] ?? "";
              const files = imagesByItem[key] ?? [];
              const previewUrls = previewUrlsByItem[key] ?? [];
              const existingImgs = existingImagesByItem[key] ?? [];
              const obs = obsByItem[key] ?? "";

              return (
                <div key={key} className="min-w-0 p-3 rounded-lg border bg-muted/50 border-border text-foreground">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{it.titulo}</div>
                      {it.descricao ? <div className="text-xs text-muted-foreground mt-1">{it.descricao}</div> : null}
                    </div>
                    {it.obrigatorio && (
                      <Badge variant="secondary" className="text-[11px]">
                        Obrigatorio
                      </Badge>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {CHECK_OPTIONS.map((status) => {
                      const selected = marcado === status;
                      const base = "px-3 py-1.5 rounded-md text-sm border transition";
                      const selectedClass =
                        status === "OK"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : status === "ALERTA"
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-red-600 text-white border-red-600";
                      const unselectedClass = "bg-background hover:bg-muted border-border text-foreground";

                      return (
                        <button
                          key={status}
                          type="button"
                          onClick={() =>
                            setChecklist((prev) => ({
                              ...prev,
                              [key]: selected ? "" : status,
                            }))
                          }
                          className={[base, selected ? selectedClass : unselectedClass].join(" ")}
                          disabled={saving}
                        >
                          {status}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <Label className="text-xs">Observacao (opcional)</Label>
                    <Textarea
                      value={obs}
                      onChange={(e) => setObsByItem((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder="Observacoes sobre o item..."
                      rows={3}
                      disabled={saving}
                    />
                  </div>

                  <div className="mt-3 space-y-2">
                    <Label className="text-xs text-muted-foreground">Anexos do item (opcional)</Label>
                    <PendingVideos disabled={saving} videosEnabled={videoEnabled} files={videosByItem[key] ?? []} onChange={files => setVideosByItem(prev => ({ ...prev, [key]: files }))} onPhotos={selected => onPickFiles(key, selected)} canDeleteSaved={canDeleteSavedVideos} onSavedRemoved={id => setSavedVideos(current => current.filter(video => video.id !== id))} saved={savedVideos.filter(video => Number(video.item_id) === existingChecklistIds[key])} savedTarget={videoOsId && existingChecklistIds[key] ? { osId: videoOsId, itemId: existingChecklistIds[key], kind: "entrada" } : undefined} photoCount={existingImgs.length + files.length} photoCards={<>{existingImgs.map(image => <ChecklistPhotoCard key={`saved-${image.id}`} name={image.descricao || "Foto salva"} onDownload={() => downloadChecklistFile(image.url, image.descricao || "foto")} disabled={saving} onRemove={() => void removeExistingImage(key, image.id)}><ChecklistImagePreview src={image.url} alt={image.descricao || "Foto salva"} /></ChecklistPhotoCard>)}{files.map((file, index) => <ChecklistPhotoCard key={`${file.name}-${index}`} name={file.name} onDownload={() => downloadChecklistFile(file, file.name)} pending disabled={saving} onRemove={() => removeFile(key, index)}>{previewUrls[index] && <ChecklistImagePreview src={previewUrls[index]} alt={file.name} />}</ChecklistPhotoCard>)}</>} />
                    {videoProgress && <p role="status" className="text-sm">{videoProgress}</p>}

                    {files.length > 0 && <p className="text-xs text-muted-foreground">{files.length} nova(s) imagem(ns)</p>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {templateId ? "Este modelo nao possui itens." : "Selecione um modelo para exibir os itens do checklist."}
          </p>
        )}
      </div>
    </DialogShell>
  );
}
