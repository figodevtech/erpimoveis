"use client";
import { downloadChecklistFile, ChecklistPhotoCard, PendingVideos, useVideoEnabled } from "@/components/checklist-videos";
import { uploadVideo } from "@/lib/videos/client";

import { useEffect, useMemo, useState, useRef } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { CalendarClock, ClipboardCheck, Loader2, LogOut } from "lucide-react";
import { ChecklistImagePreview } from "./checklist-image-preview";

type TemplateItem = { id: string; titulo: string; descricao?: string | null; categoria?: string | null; obrigatorio?: boolean; ordem?: number | null };
type Template = { id: string; nome: string; itens: TemplateItem[] };
type Mark = { status: "OK" | "ALERTA" | "FALHA" | ""; observacao: string };

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

function LocalImagePreview({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <ChecklistImagePreview src={url} alt={file.name} />;
}

function ChecklistSaidaDialog({ open, onOpenChange, templates, templateId, marks, images, videos, onVideos, videoEnabled, onApply }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: Template[];
  templateId: string;
  marks: Record<string, Mark>;
  images: Record<string, File[]>;
  videos: Record<string, File[]>;
  onVideos: (value: Record<string, File[]>) => void;
  videoEnabled: boolean;
  onApply: (templateId: string, marks: Record<string, Mark>, images: Record<string, File[]>) => void;
}) {
  const [draftTemplateId, setDraftTemplateId] = useState(templateId);
  const [draftMarks, setDraftMarks] = useState<Record<string, Mark>>(marks);
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
    if (!template) return toast.error("Selecione um modelo para o checklist de saída.");
    if (template.itens.some((item) => !draftMarks[item.id]?.status)) {
      return toast.error("Informe a situação de todos os itens do checklist de saída.");
    }
    onApply(draftTemplateId, draftMarks, draftImages);
    onVideos(draftVideos);
    onOpenChange(false);
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Checklist de saída</DialogTitle>
        <DialogDescription>Este checklist é independente da vistoria de entrada.</DialogDescription>
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

export function RegistrarSaidaDialog({ open, onOpenChange, osId, onSuccess }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  osId: number;
  onSuccess?: () => void;
}) {
  const [saidaEm, setSaidaEm] = useState<Date>(() => new Date());
  const [retiradoPor, setRetiradoPor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [imagesByItem, setImagesByItem] = useState<Record<string, File[]>>({});
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const videoEnabled = useVideoEnabled(open);
  const [videosByItem, setVideosByItem] = useState<Record<string, File[]>>({});
  const [videoProgress, setVideoProgress] = useState("");
  const savedExit = useRef<{ checklistCreated: Array<{ titulo: string; id: number }> } | null>(null);
  const template = useMemo(() => templates.find((item) => item.id === templateId), [templates, templateId]);
  const checklistPreenchido = Boolean(templateId && template && template.itens.every((item) => marks[item.id]?.status));

  useEffect(() => {
    if (!open) return;
    setSaidaEm(new Date());
    setRetiradoPor("");
    setObservacao("");
    setTemplateId("");
    setMarks({});
    setImagesByItem({});
    setVideosByItem({});
    savedExit.current = null;
    void fetch("/api/checklist-modelos?ativos=1", { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error || "Falha ao carregar modelos.");
        setTemplates(json?.items ?? []);
      })
      .catch((error) => toast.error(error?.message || "Falha ao carregar modelos de checklist."));
  }, [open]);

  function changeDate(date?: Date) {
    if (!date) return;
    const next = new Date(date);
    next.setHours(saidaEm.getHours(), saidaEm.getMinutes(), 0, 0);
    setSaidaEm(next);
  }

  function changeTime(part: "hour" | "minute", value: string) {
    const next = new Date(saidaEm);
    if (part === "hour") next.setHours(Number(value));
    else next.setMinutes(Number(value));
    next.setSeconds(0, 0);
    setSaidaEm(next);
  }

  async function submit() {
    if (!osId || Number.isNaN(saidaEm.getTime())) return;
    if (Object.values(videosByItem).some(files => files.length) && !checklistPreenchido && !savedExit.current) {
      toast.error("Preencha o checklist antes de anexar vídeos à saída.");
      return;
    }
    setSaving(true);
    try {
      const response = savedExit.current ? null : await fetch(`/api/ordens/${osId}/saida`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saidaEm: saidaEm.toISOString(),
          retiradoPor,
          documentoObservacao: observacao,
          checklistModeloId: checklistPreenchido ? templateId : null,
          checklist: checklistPreenchido ? (template?.itens ?? []).map((item, index) => ({
            modeloItemId: item.id, titulo: item.titulo, descricao: item.descricao, categoria: item.categoria,
            ordem: item.ordem ?? index, status: marks[item.id]?.status, observacao: marks[item.id]?.observacao,
          })) : [],
        }),
      });
      const json = savedExit.current ?? await response!.json().catch(() => ({}));
      if (response && !response.ok) throw new Error(json?.error || "Falha ao registrar saída.");
      savedExit.current = json;
      const idsByTitle = new Map<string, number>((json?.checklistCreated ?? []).map((item: any) => [String(item.titulo), Number(item.id)]));
      for (const [titulo, files] of Object.entries(imagesByItem)) {
        const checklistItemId = idsByTitle.get(titulo);
        if (!checklistItemId || files.length === 0) continue;
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        const upload = await fetch(`/api/ordens/saida-checklist/${checklistItemId}/images`, { method: "POST", body: form });
        const uploadJson = await upload.json().catch(() => ({}));
        if (!upload.ok) throw new Error(uploadJson?.error || `Falha ao enviar imagens de ${titulo}.`);
        setImagesByItem(prev => ({ ...prev, [titulo]: [] }));
      }
      for (const [title, files] of Object.entries(videosByItem)) {
        const itemId = idsByTitle.get(title);
        if (files.length && !itemId) throw new Error(`Preencha o checklist para anexar vídeos em ${title}.`);
        for (const file of files) {
          await uploadVideo(file, { osId, itemId: itemId!, kind: "saida" }, setVideoProgress);
          setVideosByItem(prev => ({ ...prev, [title]: (prev[title] ?? []).filter(f => f !== file) }));
        }
      }
      toast.success(`Saída da OS #${osId} registrada.`);
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error?.message || "Falha ao registrar saída.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LogOut className="h-5 w-5" />Registrar saída da OS #{osId || "-"}</DialogTitle>
          <DialogDescription>A saída física é independente da conclusão do pagamento.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Data e hora da saída</Label>
            <Popover>
              <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal"><CalendarClock className="mr-2 h-4 w-4" />{format(saidaEm, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</Button></PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={saidaEm} onSelect={changeDate} disabled={(date) => date > new Date()} />
                <div className="flex items-center gap-2 border-t p-3">
                  <Label className="mr-auto">Horário</Label>
                  <Select value={String(saidaEm.getHours()).padStart(2, "0")} onValueChange={(value) => changeTime("hour", value)}><SelectTrigger className="w-20"><SelectValue /></SelectTrigger><SelectContent>{HOURS.map((hour) => <SelectItem key={hour} value={hour}>{hour}</SelectItem>)}</SelectContent></Select>
                  <span>:</span>
                  <Select value={String(saidaEm.getMinutes()).padStart(2, "0")} onValueChange={(value) => changeTime("minute", value)}><SelectTrigger className="w-20"><SelectValue /></SelectTrigger><SelectContent>{MINUTES.map((minute) => <SelectItem key={minute} value={minute}>{minute}</SelectItem>)}</SelectContent></Select>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2 sm:col-span-2"><Label>Quem retirou (opcional)</Label><Input value={retiradoPor} onChange={(event) => setRetiradoPor(event.target.value)} placeholder="Nome em texto livre" maxLength={200} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Documento ou observação (opcional)</Label><Textarea value={observacao} onChange={(event) => setObservacao(event.target.value)} maxLength={1000} /></div>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
            <div><p className="text-sm font-medium">Checklist de saída</p><p className="text-xs text-muted-foreground">{checklistPreenchido ? `${template?.nome} · ${template?.itens.length ?? 0} itens preenchidos` : "Opcional e independente do checklist de entrada"}</p></div>
            <Button type="button" variant="outline" disabled={saving || Boolean(savedExit.current)} onClick={() => setChecklistOpen(true)}>{checklistPreenchido ? "Editar checklist" : "Preencher checklist"}</Button>
          </div>
        </div>
        {videoProgress && <p role="status">{videoProgress}</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar saída</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {checklistOpen && <ChecklistSaidaDialog videos={videosByItem} onVideos={setVideosByItem} videoEnabled={videoEnabled} open onOpenChange={setChecklistOpen} templates={templates} templateId={templateId} marks={marks} images={imagesByItem} onApply={(nextTemplateId, nextMarks, nextImages) => { setTemplateId(nextTemplateId); setMarks(nextMarks); setImagesByItem(nextImages); }} />}
  </>;
}
