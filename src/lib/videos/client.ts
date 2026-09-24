import { createUploadId } from "./upload-id";
const pendingCompletions = new WeakMap<File, { id: string; osId: number; itemId: number; kind: "entrada" | "saida" }>();
export async function videoRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/checklist-videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw Object.assign(new Error(json.error || "Falha no serviço de vídeos."), { code: json.code });
  return json;
}
export async function uploadVideo(file: File, target: { osId: number; itemId: number; kind: "entrada" | "saida" }, onProgress: (s: string) => void) {
  const pending = pendingCompletions.get(file);
  if (pending) {
    if (pending.osId !== target.osId || pending.itemId !== target.itemId || pending.kind !== target.kind) throw new Error("Conclua o envio no item original antes de reutilizar este arquivo.");
    onProgress("Concluindo envio anterior…");
    try { await videoRequest({ ...pending, action: "complete" }); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "UPLOAD_REJECTED") pendingCompletions.delete(file);
      throw error;
    }
    pendingCompletions.delete(file);
    return;
  }
  if (file.size > 250000000) throw new Error("O vídeo excede 250 MB.");
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let compatible = false;
  try {
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120.1) throw new Error("Selecione um vídeo de até 2 minutos.");
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (video) {
      const width = await video.getDisplayWidth();
      const height = await video.getDisplayHeight();
      if (Math.min(width, height) < 720) throw new Error(`O vídeo original está em ${width} × ${height}, abaixo de HD. Grave pelo aplicativo Câmera do celular em 1080p e use Selecionar vídeo. A otimização não recupera a resolução perdida na captura.`);
    }
    compatible = (await input.getFormat()).name === "MP4" && video?.codec === "avc" && (!audio || audio.codec === "aac");
  } finally { input.dispose(); }
  onProgress("Otimizando vídeo…");
  const blob = await new Promise<Blob>((resolve, reject) => {
    const fallback = (message: string) => {
      if (compatible && window.confirm(`${message}\nEnviar sem otimizar (${(file.size / 1e6).toFixed(1)} MB)?`)) resolve(file);
      else reject(new Error(message));
    };
    let worker: Worker;
    try { worker = new Worker(new URL("./optimize.worker.ts", import.meta.url), { type: "module" }); }
    catch { fallback("O aparelho não conseguiu iniciar a otimização."); return; }
    const timer = setTimeout(() => { worker.terminate(); fallback("Otimização demorou demais."); }, 180000);
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) { onProgress(`Otimizando: ${Math.round(data.progress * 100)}%`); return; }
      clearTimeout(timer); worker.terminate();
      if (data.blob) resolve(data.blob);
      else fallback(data.error);
    };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); fallback("O aparelho não conseguiu processar o vídeo."); };
    worker.postMessage(file);
  });
  if (blob.size > 250000000) throw new Error("O vídeo final excede 250 MB.");
  const id = createUploadId();
  const body = { id, ...target };
  let completing = false;
  try {
    const reservation = await videoRequest({ ...body, action: "reserve", name: file.name.slice(0, 160), size: blob.size });
    for (let i = 0; i < reservation.urls.length; i++) {
      onProgress(`Enviando: ${Math.round(i / reservation.urls.length * 100)}%`);
      const part = blob.slice(i * reservation.partSize, (i + 1) * reservation.partSize);
      let sent = false;
      let status: number | undefined;
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        const response = await fetch(reservation.urls[i], { method: "PUT", body: part }).catch(() => null);
        sent = response?.ok ?? false;
        status = response?.status;
      }
      if (!sent) throw new Error(status ? `O armazenamento recusou o envio (HTTP ${status}). Tente novamente; se persistir, contate o suporte.` : `O navegador não conseguiu acessar o armazenamento. Confira a conexão e se o CORS do bucket permite a origem ${window.location.origin}.`);
    }
    onProgress("Validando vídeo…"); completing = true;
    pendingCompletions.set(file, body);
    await videoRequest({ ...body, action: "complete" });
    pendingCompletions.delete(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "UPLOAD_REJECTED") pendingCompletions.delete(file);
    if (!completing) await videoRequest({ ...body, action: "cancel" }).catch(() => undefined);
    throw error;
  }
}
