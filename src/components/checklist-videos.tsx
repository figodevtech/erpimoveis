"use client";
import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Film, Play, Download, Trash2, ChevronLeft, ChevronRight, MoreVertical, ImagePlus, Loader2, Camera } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { compressImage } from "@/app/(app)/(pages)/ordens/lib/image-compress";
import { safeUUID } from "@/app/(app)/(pages)/ordens/lib/safe-uuid";
import { ChecklistImagePreview } from "@/app/(app)/(pages)/ordens/components/dialogs/checklist-image-preview";
import { Button } from "@/components/ui/button";
import { VideoViewerDialog } from "@/components/video-viewer-dialog";
import { ChecklistVideoCamera } from "@/components/checklist-video-camera";
import type { VideoKind } from "@/lib/videos/types";
import { uploadVideo, videoRequest } from "@/lib/videos/client";

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

export function PendingVideos({ files, onChange, disabled = false, videosEnabled = true, onPhotos, saved = [], savedTarget, onSavedRemoved, canDeleteSaved = false, hideCarousel = false, photoCards, photoCount = 0 }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean; videosEnabled?: boolean; onPhotos?: (files: File[]) => void; saved?: Asset[]; savedTarget?: { osId: number; itemId: number; kind: VideoKind }; onSavedRemoved?: (id: string) => void; canDeleteSaved?: boolean; hideCarousel?: boolean; photoCards?: ReactNode; photoCount?: number }) {
  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const carousel = useRef<HTMLDivElement>(null);
  const count = saved.length + files.length + photoCount;
  return <div className="min-w-0 max-w-full space-y-2 py-2">
    <div className="flex flex-wrap items-center gap-2">
      {videosEnabled && <VideoGallery disabled={disabled} onFiles={picked => onChange([...files, ...picked])} />}
      {onPhotos && <>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => photos.current?.click()}><ImagePlus className="size-4" />Selecionar foto</Button>
        <input ref={photos} hidden type="file" accept="image/*" multiple disabled={disabled} onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (selected.length) onPhotos(selected); }} />
      </>}
      {videosEnabled && <ChecklistVideoCamera disabled={disabled} onCapture={file => onChange([...files, file])} />}
      {onPhotos && <>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => camera.current?.click()}><Camera className="size-4" />Gravar foto</Button>
        <input ref={camera} hidden type="file" accept="image/*" capture="environment" disabled={disabled} onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (selected.length) onPhotos(selected); }} />
      </>}
    </div>
    {videosEnabled && <p className="text-xs text-muted-foreground">Vídeos de até 2 minutos e 250 MB após a otimização. No iPhone, escolha a Fototeca em “Selecionar vídeo”; “Gravar vídeo” solicita Full HD no navegador.</p>}
    {!hideCarousel && count > 0 && <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">Anexos ({count})</p>{count > 1 && <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" aria-label="Anexos anteriores" onClick={() => carousel.current?.scrollBy({ left: -160, behavior: "smooth" })}><ChevronLeft className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label="Próximos anexos" onClick={() => carousel.current?.scrollBy({ left: 160, behavior: "smooth" })}><ChevronRight className="size-4" /></Button></div>}</div>
      <div ref={carousel} tabIndex={0} aria-label="Fotos e vídeos do item" className="flex w-full min-w-0 items-start snap-x snap-mandatory gap-2 overflow-x-auto pb-2">
        {photoCards}
        {savedTarget && saved.map(asset => <SavedVideoPreview key={asset.id} asset={asset} target={savedTarget} disabled={disabled} onRemoved={canDeleteSaved ? onSavedRemoved : undefined} />)}
        {files.map((file, index) => <PendingVideoPreview key={`${file.name}-${file.lastModified}-${index}`} file={file} disabled={disabled} onRemove={() => onChange(files.filter((_, i) => i !== index))} />)}
      </div>
    </div>}
  </div>;
}

export async function downloadChecklistFile(source: File | string, name: string) {
  try {
    let blob: Blob = source instanceof File ? source : new Blob();
    if (typeof source === "string") {
      const response = await fetch(source);
      if (!response.ok) throw new Error("Falha ao baixar arquivo.");
      blob = await response.blob();
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    window.alert("Falha ao baixar arquivo. Tente novamente.");
  }
}
function AttachmentMenu({ name, disabled, onDownload, onRemove }: { name: string; disabled?: boolean; onDownload?: () => void; onRemove?: () => void }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" disabled={disabled} aria-label={`Opções de ${name}`}><MoreVertical className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
    {onDownload && <DropdownMenuItem onSelect={onDownload}><Download className="size-4" />Baixar</DropdownMenuItem>}
    {onRemove && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}><Trash2 className="size-4" />Excluir</DropdownMenuItem>}
  </DropdownMenuContent></DropdownMenu>;
}

export function ChecklistPhotoCard({ children, name, pending = false, disabled, onRemove, onDownload }: { children: ReactNode; name: string; pending?: boolean; disabled?: boolean; onRemove?: () => void; onDownload?: () => void }) {
  return <div className="w-32 shrink-0 snap-start overflow-hidden rounded-lg border bg-background sm:w-36">
    <div className="aspect-video w-full overflow-hidden bg-muted">{children}</div>
    <div className="flex h-11 items-center gap-1 p-1.5"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={name}>{name}</p><p className="truncate text-[10px] text-muted-foreground">{pending ? "Nova" : "Salva"} · Foto</p></div>
      <AttachmentMenu name={name} disabled={disabled} onDownload={onDownload} onRemove={onRemove} />
    </div>
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
  const [url, setUrl] = useState("");
  const [viewing, setViewing] = useState(false);
  const [details, setDetails] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const source = URL.createObjectURL(file);
    queueMicrotask(() => { if (active) setUrl(source); });
    return () => { active = false; URL.revokeObjectURL(source); };
  }, [file]);
  return <div className="w-32 shrink-0 snap-start overflow-hidden rounded-lg border bg-background sm:w-36">
    <button type="button" disabled={!url} onClick={() => setViewing(true)} aria-label={`Visualizar ${file.name}`} className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black text-white">
      {url && <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 h-full w-full object-cover" onError={() => setError(true)} onLoadedMetadata={event => { const video = event.currentTarget; setError(false); setDetails(`${video.videoWidth} × ${video.videoHeight}${Number.isFinite(video.duration) ? ` · ${Math.round(video.duration)} s` : ""}`); }} />}
      <Play className="relative size-5 drop-shadow" />
    </button>
    <div className="flex h-11 items-center gap-1 p-1.5"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={file.name}>{file.name}</p><p className="truncate text-[10px] text-muted-foreground">Novo · {details || `${(file.size / 1e6).toFixed(1)} MB`}</p></div><AttachmentMenu name={file.name} disabled={disabled} onRemove={onRemove} onDownload={() => downloadChecklistFile(file, file.name)} /></div>
    {error && <p className="px-1.5 pb-1.5 text-[10px] text-muted-foreground">Prévia indisponível</p>}
    {viewing && url && <VideoViewerDialog id={file.name} name={file.name} initialUrl={url} access={async () => ({ url })} onClose={() => setViewing(false)} />}
  </div>;
}
type Asset = { id: string; item_id: number; kind: VideoKind; name: string; size_bytes: number; duration_seconds: number };
function VideoThumbnail({ asset, osId, itemId, kind, disabled, onPlay }: { asset: Asset; osId: number; itemId: number; kind: VideoKind; disabled: boolean; onPlay: (signedUrl?: string) => void }) {
  const [url, setUrl] = useState("");
  const signedAt = useRef(0);
  const [posterReady, setPosterReady] = useState(false);
  useEffect(() => {
    let active = true;
    void videoRequest({ action: "access", id: asset.id, osId, itemId, kind }).then(result => { if (active) { signedAt.current = Date.now(); setUrl(result.url); } }).catch(() => { if (active) setPosterReady(true); });
    return () => { active = false; };
  }, [asset.id, osId, itemId, kind]);
  return <button type="button" disabled={disabled} onClick={() => onPlay(url && Date.now() - signedAt.current < 10 * 60 * 1000 ? url : undefined)} aria-label={`Assistir ${asset.name}`} className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-black text-white focus-visible:outline-2 focus-visible:outline-primary">
    {url && <video src={`${url}#t=0.1`} muted playsInline preload="metadata" onLoadedData={() => setPosterReady(true)} onError={() => setPosterReady(true)} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
    <span className="relative rounded-full bg-black/65 p-2">{posterReady ? <Play className="size-5" /> : <Loader2 className="size-5 animate-spin" />}</span>
    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px]">Vídeo</span>
  </button>;
}
type Service = { enabled: boolean; capacityBytes: number; usedBytes: number; reservedBytes: number };
type VideoListing = { items: Asset[]; service: Service; canDelete: boolean; canEdit: boolean };
const listings = new Map<string, Promise<VideoListing>>();
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
  if (!force && cached) return cached;
  const promise = fetch(`/api/checklist-videos?osId=${osId}&scope=${scope}`, { cache: "no-store" }).then(async response => {
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Não foi possível carregar os vídeos.");
    return json as VideoListing;
  });
  listings.set(key, promise);
  void promise.finally(() => { if (listings.get(key) === promise) listings.delete(key); }).catch(() => undefined);
  return promise;
}
function SavedVideoPreview({ asset, target, disabled, onRemoved }: { disabled?: boolean; onRemoved?: (id: string) => void; asset: Asset; target: { osId: number; itemId: number; kind: VideoKind } }) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { osId, itemId, kind } = target;
  const access = useCallback((id: string) => videoRequest({ action: "access", id, osId, itemId, kind }), [osId, itemId, kind]);
  return <div className="w-32 shrink-0 snap-start overflow-hidden rounded-lg border bg-background sm:w-36">
    <VideoThumbnail asset={asset} {...target} disabled={false} onPlay={url => setViewing(url ?? "")} />
    <div className="flex h-11 items-center gap-1 p-1.5"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={asset.name}>{asset.name}</p><p className="truncate text-[10px] text-muted-foreground">Salvo · {Math.round(asset.duration_seconds)} s</p></div><AttachmentMenu name={asset.name} disabled={disabled || deleting} onDownload={() => void videoRequest({ action: "access", id: asset.id, ...target, download: true }).then(result => downloadChecklistFile(result.url, asset.name)).catch(cause => setError(cause instanceof Error ? cause.message : "Falha no download."))} onRemove={onRemoved ? () => {
      if (!window.confirm("Excluir permanentemente este vídeo?")) return;
      setDeleting(true); setError("");
      void videoRequest({ action: "delete", id: asset.id, ...target }).then(() => onRemoved(asset.id)).catch(cause => setError(cause instanceof Error ? cause.message : "Falha ao excluir vídeo.")).finally(() => setDeleting(false));
    } : undefined} /></div>
    {error && <p role="alert" className="px-1.5 pb-1.5 text-[10px] text-destructive">{error}</p>}
    {viewing !== null && <VideoViewerDialog id={asset.id} name={asset.name} initialUrl={viewing || undefined} access={access} onClose={() => setViewing(null)} />}
  </div>;
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
export function ChecklistVideos({ osId, itemId, kind, images = [], canEdit: requestedEdit = false, active = true, onDownloadImage }: { osId: number; itemId: number; kind: VideoKind; images?: ChecklistPhoto[]; canEdit?: boolean; active?: boolean; onDownloadImage?: (url: string, name: string) => void | Promise<void> }) {
  const isChecklist = kind === "entrada" || kind === "saida";
  const [serverCanEdit, setServerCanEdit] = useState(false);
  const canEdit = requestedEdit && (isChecklist || serverCanEdit);
  const loadingScope = useContext(LoadingContext);
  const reportLoadingError = loadingScope?.report;
  const retry = loadingScope?.retry;
  const carousel = useRef<HTMLDivElement>(null);
  const [addedPhotos, setAddedPhotos] = useState<ChecklistPhoto[]>([]);
  const [removedPhotos, setRemovedPhotos] = useState<number[]>([]);
  const photos = [...images, ...addedPhotos.filter(photo => !images.some(existing => existing.id === photo.id))].filter(photo => !removedPhotos.includes(photo.id));
  const [items, setItems] = useState<Asset[]>([]);
  const [loadedRetry, setLoadedRetry] = useState(-1);
  const loadingVideos = loadedRetry !== (retry ?? 0);
  const [service, setService] = useState<Service | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [viewing, setViewing] = useState<{ asset: Asset; url?: string } | null>(null);
  const requestId = useRef(0);
  const refresh = useCallback(async (force = false) => {
    const current = ++requestId.current;
    const json = await loadVideos(osId, kind, force);
    if (current !== requestId.current) return;
    setItems(json.items.filter((v: Asset) => Number(v.item_id) === itemId && v.kind === kind)); setService(json.service); setCanDelete(json.canDelete); setServerCanEdit(json.canEdit);
  }, [osId, itemId, kind]);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    setLoadedRetry(-1);
    refresh()
      .catch(cause => { if (mounted) (reportLoadingError ?? setError)(cause instanceof Error ? cause.message : "Não foi possível carregar os vídeos."); })
      .finally(() => { if (mounted) setLoadedRetry(retry ?? 0); });
    return () => { mounted = false; requestId.current += 1; };
  }, [active, refresh, reportLoadingError, retry]);
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
  function openVideo(asset: Asset, signedUrl?: string) {
    setViewing({ asset, url: signedUrl });
  }
  const accessVideo = useCallback((id: string) => videoRequest({ action: "access", id, osId, itemId, kind }), [osId, itemId, kind]);
  if (isChecklist && loadingVideos) return <div role="status" aria-label="Carregando fotos e vídeos do checklist" className="mt-3 flex min-h-20 items-center gap-2 rounded-lg border border-dashed px-3 text-sm text-muted-foreground">
    <Loader2 className="size-4 animate-spin" aria-hidden="true" />Carregando anexos...
  </div>;
  if (!canEdit && service && !service.enabled && !items.length && !photos.length) return null;
  if (!canEdit && !service && !items.length && !photos.length && reportLoadingError) return null;
  return <section className="mt-3 min-w-0 space-y-3" aria-label="Anexos do item">
    {canEdit && <PendingVideos files={pendingFiles} onChange={setPendingFiles} disabled={!!busy} videosEnabled={service?.enabled === true} onPhotos={isChecklist ? uploadPhotos : undefined} hideCarousel />}
    {photos.length + items.length + pendingFiles.length > 0 && <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-medium"><Film className="size-4" />Anexos ({photos.length + items.length + pendingFiles.length})</p>
      {photos.length + items.length + pendingFiles.length > 1 && <div className="flex gap-1"><Button type="button" variant="ghost" size="icon" aria-label="Anexos anteriores" onClick={() => carousel.current?.scrollBy({ left: -160, behavior: "smooth" })}><ChevronLeft className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label="Próximos anexos" onClick={() => carousel.current?.scrollBy({ left: 160, behavior: "smooth" })}><ChevronRight className="size-4" /></Button></div>}
    </div>}
    {(photos.length > 0 || items.length > 0 || pendingFiles.length > 0) && <div ref={carousel} tabIndex={0} aria-label="Fotos e vídeos do item" className="flex w-full min-w-0 items-start snap-x snap-mandatory gap-2 overflow-x-auto pb-2">
      {photos.map(photo => <ChecklistPhotoCard key={`photo-${photo.id}`} name={photo.descricao || "Foto"} disabled={!!busy} onRemove={canEdit ? () => {
        if (!window.confirm("Excluir permanentemente esta foto?")) return;
        void run(async () => {
          setBusy("Excluindo foto...");
          const endpoint = kind === "entrada" ? `/api/checklists/${itemId}/images/${photo.id}` : `/api/ordens/saida-checklist/${itemId}/images?imageId=${photo.id}`;
          const response = await fetch(endpoint, { method: "DELETE" });
          if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Falha ao excluir foto."); }
          setRemovedPhotos(current => [...current, photo.id]);
          window.dispatchEvent(new CustomEvent("os:refresh"));
        });
      } : undefined} onDownload={() => { if (onDownloadImage) void onDownloadImage(photo.url, photo.descricao || "foto-checklist"); else window.open(photo.url, "_blank", "noopener,noreferrer"); }}><ChecklistImagePreview src={photo.url} alt={photo.descricao || "Foto do checklist"} /></ChecklistPhotoCard>)}
      {items.map(asset => <div key={asset.id} className="w-32 shrink-0 snap-start overflow-hidden rounded-lg border bg-background sm:w-36">
        <VideoThumbnail asset={asset} osId={osId} itemId={itemId} kind={kind} disabled={!!busy} onPlay={signedUrl => openVideo(asset, signedUrl)} />
        <div className="flex h-11 items-center gap-1 p-1.5"><div className="min-w-0 flex-1"><p className="truncate text-xs" title={asset.name}>{asset.name}</p><p className="truncate text-[10px] text-muted-foreground">Salvo · {Math.round(asset.duration_seconds)} s</p></div>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" disabled={!!busy} aria-label={`Opções do vídeo ${asset.name}`}><MoreVertical className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void run(async () => { setBusy("Preparando download…"); const result = await videoRequest({ action: "access", id: asset.id, osId, itemId, kind, download: true }); const a = document.createElement("a"); a.href = result.url; a.download = "video.mp4"; a.click(); })}><Download className="size-4" />Baixar</DropdownMenuItem>
        {canDelete && canEdit && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => {
          if (window.confirm("Excluir permanentemente este vídeo? Esta ação não pode ser desfeita.")) void run(async () => { setBusy("Excluindo…"); await videoRequest({ action: "delete", id: asset.id, osId, itemId, kind }); await refresh(true); });
        }}><Trash2 className="size-4" />Excluir</DropdownMenuItem>}
        </DropdownMenuContent></DropdownMenu>
        </div>
      </div>)}
      {pendingFiles.map((file, index) => <PendingVideoPreview key={`${file.name}-${file.lastModified}-${index}`} file={file} disabled={!!busy} onRemove={() => setPendingFiles(current => current.filter((_, i) => i !== index))} />)}
    </div>}

    {canEdit && isChecklist && <p className="text-xs text-muted-foreground">As fotos são salvas ao selecionar.{service?.enabled ? " Confira os vídeos antes de clicar em Salvar vídeos." : ""}</p>}
    {canEdit && service?.enabled && <>
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
    {viewing && <VideoViewerDialog key={viewing.asset.id} id={viewing.asset.id} name={viewing.asset.name} initialUrl={viewing.url} access={accessVideo} onClose={() => setViewing(null)} />}

  </section>;
}
