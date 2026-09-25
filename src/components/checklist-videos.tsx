"use client";
import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Film, Play, Download, Trash2, ChevronLeft, ChevronRight, MoreVertical, Camera, ImagePlus, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { compressImage } from "@/app/(app)/(pages)/ordens/lib/image-compress";
import { safeUUID } from "@/app/(app)/(pages)/ordens/lib/safe-uuid";
import { ChecklistImagePreview } from "@/app/(app)/(pages)/ordens/components/dialogs/checklist-image-preview";
import { Button } from "@/components/ui/button";
import type { VideoKind } from "@/lib/videos/types";
import { uploadVideo, videoRequest } from "@/lib/videos/client";
import { ChecklistVideoCamera } from "@/components/checklist-video-camera";

export function useVideoEnabled(open: boolean) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch("/api/plano/status").then(r => r.json()).then(j => { if (active) setEnabled(j.data?.videos?.enabled === true && j.data?.access?.allowed === true); }).catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, [open]);
  return enabled;
}

export function PendingVideos({ files, onChange, disabled = false, photoActions }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean; photoActions?: ReactNode }) {
  return <div className="space-y-2 py-2">
    <div className="flex flex-wrap items-center gap-2">
    {photoActions}
    <ChecklistVideoCamera disabled={disabled} onCapture={file => onChange([...files, file])} />
    <VideoGallery disabled={disabled} onFiles={picked => onChange([...files, ...picked])} />
    </div>
    <p className="text-xs text-muted-foreground">Até 2 minutos. O arquivo enviado deve ter até 250 MB após a otimização. Confira o original abaixo; o vídeo será otimizado somente ao salvar.</p>
    <div className="grid gap-3 sm:grid-cols-2">{files.map((file, index) => <PendingVideoPreview key={`${file.name}-${file.lastModified}-${index}`} file={file} disabled={disabled} onRemove={() => onChange(files.filter((_, i) => i !== index))} />)}</div>
  </div>;
}

function VideoGallery({ disabled, onFiles, multiple = true }: { disabled?: boolean; onFiles: (files: File[]) => void; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}><Film className="size-4 shrink-0" />Selecionar vídeo</Button>
    <input ref={input} hidden type="file" accept="video/*" multiple={multiple} disabled={disabled} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (files.length) onFiles(files); }} />
  </>;
}

function PendingVideoPreview({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  const player = useRef<HTMLVideoElement>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    const source = URL.createObjectURL(file);
    const video = player.current;
    if (video) video.src = source;
    return () => { if (video) { video.pause(); video.removeAttribute("src"); video.load(); } URL.revokeObjectURL(source); };
  }, [file]);
  return <div className="min-w-0 overflow-hidden rounded-lg border bg-background">
    <video ref={player} controls playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" onError={() => setError(true)} onLoadedMetadata={event => { const video = event.currentTarget; setError(false); setDetails(`${video.videoWidth} × ${video.videoHeight}${Number.isFinite(video.duration) ? ` · ${Math.round(video.duration)} s` : ""}`); }} />
    <div className="flex items-center gap-2 p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={file.name}>{file.name}</p><p className="text-xs text-muted-foreground">{(file.size / 1e6).toFixed(1)} MB{details ? ` · ${details}` : ""}</p></div><Button type="button" size="icon" variant="ghost" disabled={disabled} aria-label={`Remover vídeo ${file.name}`} onClick={onRemove}><Trash2 className="size-4" /></Button></div>
    {error && <p className="px-2 pb-2 text-xs text-muted-foreground">Este navegador não conseguiu mostrar a prévia deste formato.</p>}
  </div>;
}
type Asset = { id: string; item_id: number; kind: VideoKind; name: string; size_bytes: number; duration_seconds: number };
function VideoThumbnail({ asset, osId, itemId, kind, disabled, onPlay }: { asset: Asset; osId: number; itemId: number; kind: VideoKind; disabled: boolean; onPlay: (signedUrl?: string) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState("");
  const signedAt = useRef(0);
  const [posterReady, setPosterReady] = useState(false);
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      videoRequest({ action: "access", id: asset.id, osId, itemId, kind }).then(result => { if (active) { signedAt.current = Date.now(); setUrl(result.url); } }).catch(() => { if (active) setPosterReady(true); });
    });
    if (button.current) observer.observe(button.current);
    return () => { active = false; observer.disconnect(); };
  }, [asset.id, osId, itemId, kind]);
  return <button ref={button} type="button" disabled={disabled} onClick={() => onPlay(url && Date.now() - signedAt.current < 10 * 60 * 1000 ? url : undefined)} aria-label={`Assistir ${asset.name}`} className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black text-white focus-visible:outline-2 focus-visible:outline-primary">
    {url && <video src={`${url}#t=0.1`} muted playsInline preload="metadata" onLoadedData={() => setPosterReady(true)} onError={() => setPosterReady(true)} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
    <span className="relative rounded-full bg-black/65 p-2">{posterReady ? <Play className="size-5" /> : <Loader2 className="size-5 animate-spin" />}</span>
    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px]">Vídeo</span>
  </button>;
}
type Service = { enabled: boolean; capacityBytes: number; usedBytes: number; reservedBytes: number };
type VideoListing = { items: Asset[]; service: Service; canDelete: boolean; canEdit: boolean };
const listings = new Map<string, { at: number; promise: Promise<VideoListing> }>();
const LoadingContext = createContext<{ report: (message: string) => void; retry: number } | null>(null);
export function ChecklistAttachmentsScope({ children }: { children: ReactNode }) {
  const [error, report] = useState("");
  const [retry, setRetry] = useState(0);
  return <LoadingContext.Provider value={{ report, retry }}>
    {error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"><span>{error} As fotos continuam disponíveis.</span><Button type="button" variant="outline" size="sm" onClick={() => { listings.clear(); report(""); setRetry(value => value + 1); }}>Tentar novamente</Button></div>}
    {children}
  </LoadingContext.Provider>;
}
function loadVideos(osId: number, kind: VideoKind, force = false) {
  const scope = kind === "entrada" || kind === "saida" ? "checklist" : kind;
  const key = `${scope}:${osId}`;
  const cached = listings.get(key);
  if (!force && cached && Date.now() - cached.at < 5000) return cached.promise;
  const promise = fetch(`/api/checklist-videos?osId=${osId}&scope=${scope}`).then(async response => {
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Não foi possível carregar os vídeos.");
    return json as VideoListing;
  });
  if (listings.size > 20) listings.clear();
  listings.set(key, { at: Date.now(), promise });
  return promise;
}
export function VideoUsage({ service }: { service: Service }) {
  const total = service.usedBytes + service.reservedBytes;
  const percent = service.capacityBytes ? total / service.capacityBytes * 100 : 0;
  return <div className="text-sm space-y-1"><p>Vídeos: {(service.usedBytes / 1e9).toFixed(2)} de {(service.capacityBytes / 1e9).toFixed(0)} GB utilizados{service.reservedBytes > 0 ? ` · ${(service.reservedBytes / 1e9).toFixed(2)} GB em envio` : ""}</p>
    {service.capacityBytes > 0 && <>
      <div role="meter" aria-label="Armazenamento de vídeos utilizado" aria-valuemin={0} aria-valuemax={service.capacityBytes} aria-valuenow={Math.min(total, service.capacityBytes)} aria-valuetext={`${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ocupado, incluindo envios em andamento`} className="h-2.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, percent)}%` }} /></div>
      <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ocupado, incluindo envios</span><span>{(Math.max(0, service.capacityBytes - total) / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB disponíveis</span></div>
    </>}
    {percent >= 80 && <p role="status" className="text-amber-700 dark:text-amber-400">{percent >= 100 ? "Armazenamento cheio." : percent >= 90 ? "90% ou mais do armazenamento ocupado." : "80% ou mais do armazenamento ocupado."} Contate o suporte para ampliar seu plano.</p>}
    {!service.enabled && <p>Novos envios não estão liberados.</p>}
  </div>;
}
type ChecklistPhoto = { id: number; url: string; descricao?: string | null };
export function ChecklistVideos({ osId, itemId, kind, images = [], canEdit: requestedEdit = false, onDownloadImage }: { osId: number; itemId: number; kind: VideoKind; images?: ChecklistPhoto[]; canEdit?: boolean; onDownloadImage?: (url: string, name: string) => void | Promise<void> }) {
  const isChecklist = kind === "entrada" || kind === "saida";
  const [serverCanEdit, setServerCanEdit] = useState(false);
  const canEdit = requestedEdit && (isChecklist || serverCanEdit);
  const loadingScope = useContext(LoadingContext);
  const reportLoadingError = loadingScope?.report;
  const retry = loadingScope?.retry;
  const carousel = useRef<HTMLDivElement>(null);
  const photoCamera = useRef<HTMLInputElement>(null);
  const photoGallery = useRef<HTMLInputElement>(null);
  const [addedPhotos, setAddedPhotos] = useState<ChecklistPhoto[]>([]);
  const photos = [...images, ...addedPhotos.filter(photo => !images.some(existing => existing.id === photo.id))];
  const [items, setItems] = useState<Asset[]>([]);
  const [loadedRetry, setLoadedRetry] = useState(-1);
  const loadingVideos = loadedRetry !== (retry ?? 0);
  const [service, setService] = useState<Service | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const refresh = useCallback(async (force = false) => {
    const json = await loadVideos(osId, kind, force);
    setItems(json.items.filter((v: Asset) => v.item_id === itemId && v.kind === kind)); setService(json.service); setCanDelete(json.canDelete); setServerCanEdit(json.canEdit);
  }, [osId, itemId, kind]);
  useEffect(() => {
    let active = true;
    refresh()
      .catch(cause => { if (active) (reportLoadingError ?? setError)(cause instanceof Error ? cause.message : "Não foi possível carregar os vídeos."); })
      .finally(() => { if (active) setLoadedRetry(retry ?? 0); });
    return () => { active = false; };
  }, [refresh, reportLoadingError, retry]);
  async function run(task: () => Promise<void>) { setError(""); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao acessar vídeo."); } finally { setBusy(""); } }
  function uploadPhotos(files: File[]) {
    if (!files.length || !canEdit || !isChecklist || busy) return;
    void run(async () => {
      if (files.length > 10) throw new Error("Selecione até 10 fotos por envio.");
      for (const file of files) {
        setBusy("Preparando foto…");
        const { blob, ext, type } = await compressImage(file, { maxWidth: 1600, maxHeight: 1600, targetMaxBytes: 800 * 1024, minQuality: 0.6, maxQuality: 0.95 });
        const form = new FormData();
        form.append("files", new File([blob], `${safeUUID()}.${ext}`, { type }));
        setBusy("Enviando foto…");
        const endpoint = kind === "entrada" ? `/api/checklists/${itemId}/images/upload` : `/api/ordens/saida-checklist/${itemId}/images`;
        const response = await fetch(endpoint, { method: "POST", body: form });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || "Não foi possível salvar a foto.");
        setAddedPhotos(current => [...current, ...(json.items ?? [])]);
      }
      window.dispatchEvent(new CustomEvent("os:refresh"));
    });
  }
  const photoActions = isChecklist ? <>
    <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => photoCamera.current?.click()}><Camera className="size-4" />Tirar foto</Button>
    <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => photoGallery.current?.click()}><ImagePlus className="size-4" />Selecionar fotos</Button>
    <input ref={photoCamera} hidden type="file" accept="image/*" capture="environment" disabled={!!busy} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; uploadPhotos(files); }} />
    <input ref={photoGallery} hidden type="file" accept="image/*" multiple disabled={!!busy} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; uploadPhotos(files); }} />
  </> : undefined;
  function openVideo(asset: Asset, signedUrl?: string) {
    if (signedUrl) {
      window.open(signedUrl, "_blank", "noopener,noreferrer");
      return;
    }
    // Open during the click gesture so Safari does not block the new tab.
    const tab = window.open("about:blank", "_blank");
    if (!tab) { setError("Permita abrir uma nova aba para assistir ao vídeo."); return; }
    tab.opener = null;
    tab.document.title = "Abrindo vídeo";
    tab.document.body.textContent = "Carregando vídeo…";
    void videoRequest({ action: "access", id: asset.id, osId, itemId, kind })
      .then(result => { if (!tab.closed) tab.location.replace(result.url); })
      .catch(cause => { tab.close(); setError(cause instanceof Error ? cause.message : "Não foi possível abrir o vídeo."); });
  }
  if (isChecklist && loadingVideos) return <div role="status" aria-label="Carregando fotos e vídeos do checklist" className="mt-3 flex min-h-20 items-center gap-2 rounded-lg border border-dashed px-3 text-sm text-muted-foreground">
    <Loader2 className="size-4 animate-spin" aria-hidden="true" />Carregando anexos...
  </div>;
  if (!canEdit && service && !service.enabled && !items.length && !photos.length) return null;
  if (!canEdit && !service && !items.length && !photos.length && reportLoadingError) return null;
  return <section className="mt-3 min-w-0 space-y-3" aria-label="Anexos do item">
    <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-medium"><Film className="size-4" />{isChecklist ? "Anexos" : "Vídeos"} ({photos.length + items.length})</p>
      {photos.length + items.length > 1 && <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" aria-label="Anexos anteriores" onClick={() => carousel.current?.scrollBy({ left: -240, behavior: "smooth" })}><ChevronLeft className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label="Próximos anexos" onClick={() => carousel.current?.scrollBy({ left: 240, behavior: "smooth" })}><ChevronRight className="size-4" /></Button></div>}
    </div>
    <div ref={carousel} tabIndex={0} aria-label="Conteúdo anexado" className="flex w-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
      {photos.map(photo => <div key={`photo-${photo.id}`} className="w-44 shrink-0 snap-start overflow-hidden rounded-lg border bg-background">
        <div className="aspect-video overflow-hidden bg-muted"><ChecklistImagePreview src={photo.url} alt={photo.descricao || "Foto do checklist"} /></div>
        <div className="flex items-center gap-1 p-2"><span className="min-w-0 flex-1 truncate text-xs" title={photo.descricao || "Foto"}>{photo.descricao || "Foto"}</span><Button type="button" variant="ghost" size="icon" aria-label="Baixar foto" onClick={() => { if (onDownloadImage) void onDownloadImage(photo.url, photo.descricao || "foto-checklist"); else window.open(photo.url, "_blank", "noopener,noreferrer"); }}><Download className="size-4" /></Button></div>
      </div>)}
      {items.map(asset => <div key={asset.id} className="w-44 shrink-0 snap-start overflow-hidden rounded-lg border bg-background">
        <VideoThumbnail asset={asset} osId={osId} itemId={itemId} kind={kind} disabled={!!busy} onPlay={signedUrl => openVideo(asset, signedUrl)} />
        <div className="flex items-center gap-1 p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs" title={asset.name}>{asset.name}</p><p className="text-xs text-muted-foreground">{Math.round(asset.duration_seconds)} s · {(asset.size_bytes / 1e6).toFixed(1)} MB</p></div>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={!!busy} aria-label={`Opções do vídeo ${asset.name}`}><MoreVertical className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void run(async () => { setBusy("Preparando download…"); const result = await videoRequest({ action: "access", id: asset.id, osId, itemId, kind, download: true }); const a = document.createElement("a"); a.href = result.url; a.download = "video.mp4"; a.click(); })}><Download className="size-4" />Baixar</DropdownMenuItem>
        {canDelete && canEdit && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => {
          if (window.confirm("Excluir permanentemente este vídeo? Esta ação não pode ser desfeita.")) void run(async () => { setBusy("Excluindo…"); await videoRequest({ action: "delete", id: asset.id, osId, itemId, kind }); await refresh(true); });
        }}><Trash2 className="size-4" />Excluir</DropdownMenuItem>}
        </DropdownMenuContent></DropdownMenu>
        </div>
      </div>)}
    </div>
    {canEdit && !service?.enabled && <div className="flex flex-wrap items-center gap-2">{photoActions}</div>}
    {canEdit && isChecklist && <p className="text-xs text-muted-foreground">As fotos são salvas ao selecionar.{service?.enabled ? " Confira os vídeos antes de clicar em Salvar vídeos." : ""}</p>}
    {canEdit && service?.enabled && <>
      <PendingVideos files={pendingFiles} onChange={setPendingFiles} disabled={!!busy} photoActions={photoActions} />
      {pendingFiles.length > 0 && <Button type="button" size="sm" disabled={!!busy} onClick={() => void run(async () => {
        for (const file of pendingFiles) {
          await uploadVideo(file, { osId, itemId, kind }, setBusy);
          setPendingFiles(current => current.filter(item => item !== file));
        }
        await refresh(true);
      })}>Salvar vídeos</Button>}
    </>}
    {!isChecklist && service && <VideoUsage service={service} />}
    {busy && <p role="status">{busy}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}

  </section>;
}
