"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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

export function PendingVideos({ files, onChange, disabled = false }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  return <div className="space-y-2 py-2">
    <label className="inline-flex items-center rounded-md border px-3 py-2 text-sm cursor-pointer">Adicionar vídeo
      <input className="sr-only" aria-label="Adicionar vídeo de até 2 minutos" disabled={disabled} type="file" accept="video/*" multiple onChange={e => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
    </label>
    <p className="text-xs text-muted-foreground">Até 2 minutos e 250 MB por vídeo. O envio ocorre após salvar o checklist.</p>
    {files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 text-sm"><span className="truncate">{file.name} · {(file.size / 1e6).toFixed(1)} MB</span><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(files.filter((_, i) => i !== index))}>Remover</Button></div>)}
  </div>;
}
type Asset = { id: string; item_id: number; kind: "entrada" | "saida"; name: string; size_bytes: number; duration_seconds: number };
type Service = { enabled: boolean; capacityBytes: number; usedBytes: number; reservedBytes: number };
type VideoListing = { items: Asset[]; service: Service; canDelete: boolean };
const listings = new Map<number, { at: number; promise: Promise<VideoListing> }>();
function loadVideos(osId: number, force = false) {
  const cached = listings.get(osId);
  if (!force && cached && Date.now() - cached.at < 5000) return cached.promise;
  const promise = fetch(`/api/checklist-videos?osId=${osId}`).then(async response => {
    const json = await response.json();
    if (!response.ok) throw new Error(json.error);
    return json as VideoListing;
  });
  if (listings.size > 20) listings.clear();
  listings.set(osId, { at: Date.now(), promise });
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
export function ChecklistVideos({ osId, itemId, kind }: { osId: number; itemId: number; kind: "entrada" | "saida" }) {
  const [items, setItems] = useState<Asset[]>([]);
  const [service, setService] = useState<Service | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const refresh = useCallback(async (force = false) => {
    const json = await loadVideos(osId, force);
    setItems(json.items.filter((v: Asset) => v.item_id === itemId && v.kind === kind)); setService(json.service); setCanDelete(json.canDelete);
  }, [osId, itemId, kind]);
  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);
  async function run(task: () => Promise<void>) { setError(""); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao acessar vídeo."); } finally { setBusy(""); } }
  if (!service) return null;
  if (!service.enabled && !items.length) return null;
  return <section className="mt-3 space-y-2 rounded-lg border p-3" aria-label="Vídeos do item">
    <VideoUsage service={service} />
    {service.enabled && <label className="inline-block cursor-pointer rounded border p-2 text-sm">Adicionar vídeo<input aria-label="Anexar vídeo ao item" type="file" accept="video/*" disabled={!!busy} className="sr-only" onChange={e => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (file) void run(async () => { await uploadVideo(file, { osId, itemId, kind }, setBusy); await refresh(true); });
    }} /></label>}
    {busy && <p role="status">{busy}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
    {items.map(asset => <div key={asset.id} className="rounded border p-2 space-y-2">
      <p className="truncate text-sm">{asset.name} · {Math.round(asset.duration_seconds)} s · {(asset.size_bytes / 1e6).toFixed(1)} MB</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void run(async () => { setBusy("Abrindo vídeo…"); const result = await videoRequest({ action: "access", id: asset.id, osId, itemId, kind }); setPlaying({ id: asset.id, url: result.url }); })}>Assistir</Button>
        <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void run(async () => { setBusy("Preparando download…"); const result = await videoRequest({ action: "access", id: asset.id, osId, itemId, kind, download: true }); const a = document.createElement("a"); a.href = result.url; a.download = "video-checklist.mp4"; a.click(); })}>Baixar</Button>
        {canDelete && <Button type="button" size="sm" variant="destructive" disabled={!!busy} onClick={() => {
          if (window.confirm("Excluir permanentemente este vídeo? Esta ação não pode ser desfeita.")) void run(async () => { setBusy("Excluindo…"); await videoRequest({ action: "delete", id: asset.id, osId, itemId, kind }); setPlaying(null); await refresh(true); });
        }}>Excluir</Button>}
      </div>
      {playing?.id === asset.id && <video className="max-h-96 w-full" controls playsInline preload="metadata" src={playing.url} onError={() => setError("Não foi possível reproduzir. Clique em Assistir para renovar o acesso.")} />}
    </div>)}
  </section>;
}
