"use client";

// Preenchimento de checklist a partir de um modelo, com situação, observação e
// fotos por item. Nasceu dentro da saída da OS e é usado também pelos
// checklists de saída e retorno do aluguel. O dialog só monta o rascunho: quem
// o abre decide quando gravar e para onde enviar as fotos.

import { useEffect, useMemo, useState } from "react";
import { downloadChecklistFile, ChecklistPhotoCard, PendingVideos } from "@/components/checklist-videos";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { ClipboardCheck } from "lucide-react";
import { ChecklistImagePreview } from "@/app/(app)/(pages)/ordens/components/dialogs/checklist-image-preview";

export type ChecklistTemplateItem = { id: string; titulo: string; descricao?: string | null; categoria?: string | null; obrigatorio?: boolean; ordem?: number | null };
export type ChecklistTemplate = { id: string; nome: string; itens: ChecklistTemplateItem[] };
export type ChecklistMark = { status: "OK" | "ALERTA" | "FALHA" | ""; observacao: string };

function LocalImagePreview({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <ChecklistImagePreview src={url} alt={file.name} />;
}

export function ChecklistPreenchimentoDialog({
  open,
  onOpenChange,
  templates,
  templateId,
  marks,
  images,
  videos,
  onVideos,
  videoEnabled,
  onApply,
  titulo = "Checklist de saída",
  descricao = "Este checklist é independente da vistoria de entrada.",
  exigirTodos = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: ChecklistTemplate[];
  templateId: string;
  marks: Record<string, ChecklistMark>;
  images: Record<string, File[]>;
  videos: Record<string, File[]>;
  onVideos: (value: Record<string, File[]>) => void;
  videoEnabled: boolean;
  onApply: (templateId: string, marks: Record<string, ChecklistMark>, images: Record<string, File[]>) => void;
  titulo?: string;
  descricao?: string;
  /** Exige a situação de todos os itens. Desligado, item sem marcação é aceito. */
  exigirTodos?: boolean;
}) {
  const [draftTemplateId, setDraftTemplateId] = useState(templateId);
  const [draftMarks, setDraftMarks] = useState<Record<string, ChecklistMark>>(marks);
  const [draftImages, setDraftImages] = useState<Record<string, File[]>>(images);
  const [draftVideos, setDraftVideos] = useState<Record<string, File[]>>(videos);
  const template = useMemo(() => templates.find((item) => item.id === draftTemplateId), [templates, draftTemplateId]);

  function selectTemplate(value: string) {
    setDraftTemplateId(value);
    const selected = templates.find((item) => item.id === value);
    setDraftMarks(Object.fromEntries((selected?.itens ?? []).map((item) => [item.id, { status: "", observacao: "" }])));
    setDraftImages({});
    setDraftVideos({});
  }

  function apply() {
    if (!template) return toast.error(`Selecione um modelo para o ${titulo.toLowerCase()}.`);
    if (exigirTodos && template.itens.some((item) => !draftMarks[item.id]?.status)) {
      return toast.error(`Informe a situação de todos os itens do ${titulo.toLowerCase()}.`);
    }
    onApply(draftTemplateId, draftMarks, draftImages);
    onVideos(draftVideos);
    onOpenChange(false);
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />{titulo}</DialogTitle>
        <DialogDescription>{descricao}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label>Modelo do checklist</Label>
          <Select value={draftTemplateId} onValueChange={selectTemplate}>
            <SelectTrigger><SelectValue placeholder="Selecione um modelo" /></SelectTrigger>
            <SelectContent>{templates.map((item) => <SelectItem key={item.id} value={item.id}>{item.nome}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {(template?.itens ?? []).map((item) => <div key={item.id} className="min-w-0 rounded-lg border border-border bg-muted/50 p-3 text-foreground">
          <div className="flex items-start justify-between gap-2">
            <div><p className="text-sm font-medium">{item.titulo}</p>{item.descricao && <p className="mt-1 text-xs text-muted-foreground">{item.descricao}</p>}</div>
            {item.obrigatorio && <Badge variant="secondary" className="text-[11px]">Obrigatório</Badge>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["OK", "ALERTA", "FALHA"] as const).map((status) => {
              const selected = draftMarks[item.id]?.status === status;
              const selectedClass = status === "OK"
                ? "border-emerald-600 bg-emerald-600 text-white"
                : status === "ALERTA"
                  ? "border-amber-500 bg-amber-500 text-white"
                  : "border-red-600 bg-red-600 text-white";
              return <button
                key={status}
                type="button"
                onClick={() => setDraftMarks((current) => ({ ...current, [item.id]: { ...current[item.id], status: selected ? "" : status } }))}
                className={`rounded-md border px-3 py-1.5 text-sm transition ${selected ? selectedClass : "border-border bg-background text-foreground hover:bg-muted"}`}
              >{status}</button>;
            })}
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea rows={3} placeholder="Observações sobre o item..." value={draftMarks[item.id]?.observacao ?? ""} onChange={(event) => setDraftMarks((current) => ({ ...current, [item.id]: { ...current[item.id], observacao: event.target.value } }))} />
          </div>
          <div className="mt-3 space-y-2">
            <Label className="text-xs text-muted-foreground">Anexos do item (opcional)</Label>
            <PendingVideos videosEnabled={videoEnabled} files={draftVideos[item.titulo] ?? []} onChange={files => setDraftVideos(current => ({ ...current, [item.titulo]: files }))} onPhotos={selected => setDraftImages((current) => ({ ...current, [item.titulo]: [...(current[item.titulo] ?? []), ...selected].slice(0, 10) }))} photoCount={(draftImages[item.titulo] ?? []).length} photoCards={(draftImages[item.titulo] ?? []).map((file, index) => <ChecklistPhotoCard key={`${file.name}-${file.lastModified}-${index}`} name={file.name} onDownload={() => downloadChecklistFile(file, file.name)} pending onRemove={() => setDraftImages(current => ({ ...current, [item.titulo]: (current[item.titulo] ?? []).filter((_, i) => i !== index) }))}><LocalImagePreview file={file} /></ChecklistPhotoCard>)} />

          </div>
        </div>)}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={apply}>Aplicar checklist</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
