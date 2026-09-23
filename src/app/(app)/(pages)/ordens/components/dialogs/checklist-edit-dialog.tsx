"use client";
import { PendingVideos, useVideoEnabled } from "@/components/checklist-videos";
import { uploadVideo } from "@/lib/videos/client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogShell } from "./dialog-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, X, CarFront, ClipboardList, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { uploadChecklistImages } from "../../lib/upload-checklist-images";
import { listarChecklistModelos, type ChecklistTemplateModel } from "../../lib/api";
import { ChecklistImagePreview } from "./checklist-image-preview";

// Dialog de edicao: carrega checklist/modelo existente e permite editar ate EM_ANDAMENTO.
// Nao tenta avancar status automaticamente (isso fica para o fluxo "primeira vez").

const CHECK_OPTIONS = ["OK", "ALERTA", "FALHA"] as const;
type Marcacao = (typeof CHECK_OPTIONS)[number] | "";

const toDbStatus = (sel: Marcacao): "OK" | "ALERTA" | "FALHA" | null =>
  sel === "OK" || sel === "ALERTA" || sel === "FALHA" ? sel : null;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId: number;
};

type ExistingImage = {
  id: number;
  url: string;
  descricao?: string | null;
};

export function ChecklistEditDialog({ open, onOpenChange, osId }: Props) {
  const [saving, setSaving] = useState(false);
  const videoEnabled = useVideoEnabled(open);
  const [videosByItem, setVideosByItem] = useState<Record<string, File[]>>({});
  const [videoProgress, setVideoProgress] = useState("");
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingError, setExistingError] = useState<string | null>(null);

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
  const [existingImagesByItem, setExistingImagesByItem] = useState<Record<string, ExistingImage[]>>({});

  const initialSnapshotRef = useRef<string>("");
  const checklistIdByItemRef = useRef<Record<string, number>>({});
  const pendingApplyRef = useRef<null | {
    templateId: string;
    statusByItem: Record<string, Marcacao>;
    obsByItem: Record<string, string>;
  }>(null);

  const [pendingApply, setPendingApply] = useState(false);

  const titulo = useMemo(
    () => (
      <span className="inline-flex items-center gap-2">
        <CarFront className="h-4 w-4 text-primary" />
        Editar checklist da OS #{osId || "-"}
      </span>
    ),
    [osId]
  );

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

  // se trocar de OS com o dialog aberto, limpa para nao "herdar" dados
  useEffect(() => {
    if (!open) return;
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osId]);

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

  // Carrega checklist existente (se houver) para abrir para edicao
  useEffect(() => {
    if (!open || !osId) return;

    (async () => {
      try {
        setLoadingExisting(true);
        setExistingError(null);

        const r = await fetch(`/api/ordens/${osId}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as any)?.error || "Falha ao carregar dados da OS");

        const osObj = (j as any)?.os ?? j;
        const existingChecklist: Array<any> = Array.isArray((j as any)?.checklist) ? (j as any).checklist : [];
        const modelId =
          (osObj as any)?.checklist_modelo_id ??
          (osObj as any)?.checklistModeloId ??
          (osObj as any)?.checklistTemplateId ??
          (osObj as any)?.checklist_template_id ??
          null;
        const templateFromOs = modelId ? String(modelId) : "";

        const statusByItem: Record<string, Marcacao> = {};
        const obsMap: Record<string, string> = {};
        const imgsByItem: Record<string, ExistingImage[]> = {};
        const ckIdByItem: Record<string, number> = {};
        for (const row of existingChecklist) {
          const item = String(row?.item ?? "").trim();
          if (!item) continue;
          const s = String(row?.status ?? "").toUpperCase();
          statusByItem[item] = (s === "OK" || s === "ALERTA" || s === "FALHA" ? (s as any) : "") as Marcacao;
          obsMap[item] = String(row?.observacao ?? row?.obs ?? "").trim();

          const ckId = Number(row?.id);
          if (Number.isFinite(ckId) && ckId > 0) ckIdByItem[item] = ckId;

          const imgs: any[] = Array.isArray(row?.imagens) ? row.imagens : [];
          imgsByItem[item] = imgs
            .map((im) => ({
              id: Number(im?.id),
              url: String(im?.url ?? ""),
              descricao: (im?.descricao ?? null) as string | null,
            }))
            .filter((im) => Number.isFinite(im.id) && im.id > 0 && !!im.url);
        }

        checklistIdByItemRef.current = ckIdByItem;
        setExistingImagesByItem(imgsByItem);

        if (templateFromOs) {
          setTemplateId(templateFromOs);
          initialSnapshotRef.current = computeSnapshot({
            templateId: templateFromOs,
            templateItems: [],
            checklist: {},
            obsByItem: {},
          });

          if (templates.length) {
            applyTemplate(templateFromOs, { statusByItem, obsByItem: obsMap });
          } else {
            pendingApplyRef.current = { templateId: templateFromOs, statusByItem, obsByItem: obsMap };
            setPendingApply(true);
          }
          return;
        }

        // Sem modelo vinculado: se existir checklist, mostra os itens existentes como "template" editavel.
        if (existingChecklist.length) {
          const itens = existingChecklist
            .map((r: any) => ({ titulo: String(r?.item ?? "").trim(), descricao: null, obrigatorio: false }))
            .filter((x: any) => x.titulo);

          setTemplateId("");
          setTemplateItems(itens as any);
          setChecklist(statusByItem);
          setObsByItem(obsMap);
          setImagesByItem(Object.fromEntries(itens.map((it: any) => [it.titulo, []])));
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
        setExistingError(e?.message ?? "Nao foi possivel carregar o checklist existente.");
      } finally {
        setLoadingExisting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, osId]);

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
    if (!osId) return "OS invalida.";
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

  const onPickFiles = (itemTitle: string, files: FileList | null) => {
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

    // otimista
    setExistingImagesByItem((prev) => ({
      ...prev,
      [itemTitle]: (prev[itemTitle] ?? []).filter((im) => im.id !== imageId),
    }));

    try {
      const r = await fetch(`/api/checklists/${checklistId}/images/${imageId}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as any)?.error || "Falha ao excluir imagem");
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

    const shouldSaveChecklist = isDirty || hasAnyNewImage;
    if (!shouldSaveChecklist) {
      toast.message("Nenhuma alteracao para salvar.");
      return;
    }

    setSaving(true);
    try {
      const checklistArray = templateItems
        .map((it) => {
          const sel = checklist[it.titulo] ?? "";
          const db = toDbStatus(sel as Marcacao);
          if (!db) return null;
          return {
            item: it.titulo,
            status: db,
            observacao: (obsByItem[it.titulo] || "").trim() || null,
          };
        })
        .filter(Boolean) as Array<{
        item: string;
        status: "OK" | "ALERTA" | "FALHA";
        observacao: string | null;
      }>;

      const payload: any = {
        checklistTemplateId: templateId || null,
        checklist: checklistArray,
      };

      // 1) Salva checklist
      const r1 = await fetch(`/api/ordens/${osId}/checklist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok) throw new Error((j1 as any)?.error || "Falha ao salvar checklist");

      const created: Array<{ id: number; item: string }> = (j1 as any)?.checklistCreated ?? [];
      const mapItemToChecklistId: Record<string, number> = {};
      for (const row of created) {
        if (row?.item && row?.id) mapItemToChecklistId[row.item] = row.id;
      }

      // 2) Upload de imagens
      const hasAnyImage = Object.values(imagesByItem).some((arr) => (arr?.length ?? 0) > 0);
      if (hasAnyImage) {
        await uploadChecklistImages(osId, imagesByItem, mapItemToChecklistId, {
          concurrency: 3,
          compress: {
            maxWidth: 1600,
            maxHeight: 1600,
            targetMaxBytes: 800 * 1024,
            minQuality: 0.6,
            maxQuality: 0.95,
          },
        });
      }

      setImagesByItem({});
      // Checklist is already saved. Successful files are removed from the retry queue.
      for (const [title, files] of Object.entries(videosByItem)) {
        const itemId = mapItemToChecklistId[title];
        if (files.length && !itemId) throw new Error(`Marque o item ${title} para anexar vídeos.`);
        for (const file of files) {
          await uploadVideo(file, { osId, itemId, kind: "entrada" }, setVideoProgress);
          setVideosByItem(prev => ({ ...prev, [title]: (prev[title] ?? []).filter(f => f !== file) }));
        }
      }
      toast.success("Checklist atualizado com sucesso.");
      window.dispatchEvent(new CustomEvent("os:refresh"));

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
      description="Edite o checklist salvo desta OS."
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
              !osId ||
              (templateItems.length === 0 && !templateId) ||
              (!isDirty && !hasAnyNewImage) ||
              loadingExisting ||
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
        {(loadingExisting || pendingApply) ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando checklist...
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
        {templateItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {templateItems.map((it) => {
              const key = it.titulo ?? "";
              const marcado = checklist[key] ?? "";
              const files = imagesByItem[key] ?? [];
              const previewUrls = previewUrlsByItem[key] ?? [];
              const existingImgs = existingImagesByItem[key] ?? [];
              const obs = obsByItem[key] ?? "";

              return (
                <div key={key} className="p-3 rounded-lg border bg-muted/50 border-border text-foreground">
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
                    <Label className="text-xs text-muted-foreground">Imagens do item (opcional)</Label>
                    {videoEnabled && <PendingVideos disabled={saving} files={videosByItem[key] ?? []} onChange={files => setVideosByItem(prev => ({ ...prev, [key]: files }))} />}
                    {videoProgress && <p role="status" className="text-sm">{videoProgress}</p>}

                    {(existingImgs.length > 0 || files.length > 0) && (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {existingImgs.map((im) => (
                          <div key={im.id} className="relative overflow-hidden rounded-md border bg-muted/20">
                            <div className="aspect-square w-full overflow-hidden bg-muted">
                              <ChecklistImagePreview
                                src={im.url}
                                alt={im.descricao ?? "Imagem"}
                              />
                            </div>
                            <div className="truncate px-2 py-1.5 text-[11px] text-muted-foreground">
                              {im.descricao || "Imagem salva"}
                            </div>
                            <button
                              type="button"
                              className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-background/90 shadow-sm hover:bg-background"
                              onClick={() => removeExistingImage(key, im.id)}
                              title="Remover imagem"
                              disabled={saving}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        {files.map((f, idx) => (
                          <div
                            key={`${f.name}-${idx}`}
                            className="relative overflow-hidden rounded-md border border-primary/70 bg-primary/5 ring-1 ring-primary/25"
                          >
                            <Badge className="absolute left-1.5 top-1.5 z-10 bg-primary text-primary-foreground text-[10px]">
                              Nova
                            </Badge>
                            <div className="aspect-square w-full overflow-hidden bg-muted">
                              {previewUrls[idx] ? (
                                <ChecklistImagePreview
                                  src={previewUrls[idx]}
                                  alt={f.name}
                                />
                              ) : null}
                            </div>
                            <div className="truncate px-2 py-1.5 text-[11px] text-muted-foreground">{f.name}</div>
                            <button
                              type="button"
                              className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-background/90 shadow-sm hover:bg-background"
                              onClick={() => removeFile(key, idx)}
                              title="Remover"
                              disabled={saving}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                        <UploadCloud className="h-4 w-4" />
                        Adicionar imagens
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => onPickFiles(key, e.target.files)}
                          disabled={saving}
                        />
                      </label>

                      {files.length > 0 && (
                        <span className="text-xs text-muted-foreground">{files.length} nova(s) imagem(ns)</span>
                      )}
                    </div>
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
