"use client";

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

// Dialog "original": usado para salvar checklist pela primeira vez (AGUARDANDO_CHECKLIST).
// Nao carrega checklist existente; depois de salvar, a OS avanca para ORCAMENTO no backend.

const CHECK_OPTIONS = ["OK", "ALERTA", "FALHA"] as const;
type Marcacao = (typeof CHECK_OPTIONS)[number] | "";

const toDbStatus = (sel: Marcacao): "OK" | "ALERTA" | "FALHA" | null =>
  sel === "OK" || sel === "ALERTA" || sel === "FALHA" ? sel : null;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId: number;
};

export function ChecklistDialog({ open, onOpenChange, osId }: Props) {
  const [saving, setSaving] = useState(false);

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

  const submitDoneRef = useRef(false);

  const titulo = useMemo(
    () => (
      <span className="inline-flex items-center gap-2">
        <CarFront className="h-4 w-4 text-primary" />
        Checklist da OS #{osId || "-"}
      </span>
    ),
    [osId]
  );

  const resetForm = useCallback(() => {
    setSaving(false);
    setTemplatesError(null);
    setTemplateId("");
    setTemplateItems([]);
    setChecklist({});
    setObsByItem({});
    setImagesByItem({});
    setPreviewUrlsByItem((prev) => {
      Object.values(prev).flat().forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
    submitDoneRef.current = false;
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
    (id: string) => {
      setTemplateId(id);

      const itens = (templates.find((t) => t.id === id)?.itens ?? []).filter(Boolean);
      setTemplateItems(itens);

      const novoChecklist: Record<string, Marcacao> = {};
      const novoObs: Record<string, string> = {};
      const novoImgs: Record<string, File[]> = {};

      itens.forEach((it) => {
        if (!it.titulo) return;
        novoChecklist[it.titulo] = "";
        novoObs[it.titulo] = "";
        novoImgs[it.titulo] = [];
      });

      setChecklist(novoChecklist);
      setObsByItem(novoObs);
      setImagesByItem(novoImgs);
      setPreviewUrlsByItem((prev) => {
        Object.values(prev).flat().forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
    },
    [templates]
  );

  const validateAll = (): string | null => {
    if (!osId) return "OS invalida.";
    if (!templateId) return "Selecione um modelo de checklist.";
    if (!templateItems.length) return "Este modelo nao possui itens.";

    const faltando = templateItems.filter((it) => it.obrigatorio).filter((it) => !checklist[it.titulo]);
    if (faltando.length) {
      const nomes = faltando
        .slice(0, 3)
        .map((f) => f.titulo)
        .join(", ");
      return `Marque todos os itens obrigatorios do checklist. Ex.: ${nomes}${faltando.length > 3 ? "..." : ""}`;
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

  const salvar = async () => {
    if (saving || submitDoneRef.current) return;

    const err = validateAll();
    if (err) {
      toast.error(err);
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

      // 1) Salva checklist (backend avanca status se estiver em AGUARDANDO_CHECKLIST)
      const r1 = await fetch(`/api/ordens/${osId}/checklist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok) throw new Error(j1?.error || "Falha ao salvar checklist");

      const created: Array<{ id: number; item: string }> = j1?.checklistCreated ?? [];
      const mapItemToChecklistId: Record<string, number> = {};
      for (const row of created) {
        if (row?.item && row?.id) mapItemToChecklistId[row.item] = row.id;
      }

      // 2) Upload de imagens (se houver)
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

      submitDoneRef.current = true;
      toast.success("Checklist salvo com sucesso.");
      window.dispatchEvent(new CustomEvent("os:refresh"));

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
      description="Preencha o checklist de inspecao antes de seguir para orcamento."
      maxW="md:max-w-[1100px]"
      mobileFull
      fixedHeight
      footer={
        <>
          <Button variant="outline" className="bg-transparent" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={saving || !osId || !templateId || loadingTemplates}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar checklist"
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {templatesError ? <p className="text-sm text-red-500">{templatesError}</p> : null}

        {/* MODELO DE CHECKLIST */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <Label className="font-medium">Modelo de checklist</Label>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <Select value={templateId} onValueChange={(id) => applyTemplate(id)} disabled={loadingTemplates || saving}>
              <SelectTrigger className="h-10 w-full sm:w-[380px] min-w-[220px] truncate relative pr-9">
                <SelectValue
                  placeholder={
                    loadingTemplates
                      ? "Carregando..."
                      : templates.length
                      ? "Selecione um modelo"
                      : "Nenhum modelo disponivel"
                  }
                />
                {loadingTemplates && (
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

            {templateId && (
              <Button variant="outline" className="w-full sm:w-auto" onClick={resetForm} disabled={saving}>
                Limpar
              </Button>
            )}
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
                        <span className="text-xs text-muted-foreground">{files.length} arquivo(s) selecionado(s)</span>
                      )}
                    </div>

                    {files.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {files.map((f, idx) => (
                          <div
                            key={`${f.name}-${idx}`}
                            className="relative overflow-hidden rounded-md border bg-muted/20"
                          >
                            <div className="aspect-square w-full overflow-hidden bg-muted">
                              {previewUrls[idx] ? (
                                <img
                                  src={previewUrls[idx]}
                                  alt={f.name}
                                  className="h-full w-full object-cover"
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

