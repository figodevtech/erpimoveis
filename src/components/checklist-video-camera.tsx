"use client";

import { useEffect, useRef, useState } from "react";
import { Video, X, Circle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function ChecklistVideoCamera({ disabled, onCapture, compact = false }: { disabled?: boolean; compact?: boolean; onCapture: (file: File) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" size="sm" variant="outline" className={compact ? "h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5" : undefined} disabled={disabled} onClick={() => setOpen(true)}><Video className="size-4" />Gravar vídeo</Button>
    <Dialog open={open} onOpenChange={setOpen}>{open && <Recorder onClose={() => setOpen(false)} onCapture={file => { setOpen(false); onCapture(file); }} />}</Dialog>
  </>;
}

function Recorder({ onClose, onCapture }: { onClose: () => void; onCapture: (file: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const alive = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedUrl = useRef<string | null>(null);
  const [phase, setPhase] = useState<"opening" | "ready" | "recording" | "finishing" | "review" | "error">("opening");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<File | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const previewElement = video.current;
    alive.current = true;
    async function open() {
      try {
        if (!window.isSecureContext) throw new Error("Abra o ERP por HTTPS para permitir acesso à câmera e ao microfone.");
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Gravação indisponível neste navegador. Use Selecionar vídeo.");
        let media: MediaStream;
        try {
          media = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: { ideal: "environment" }, width: { exact: 1920 }, height: { exact: 1080 }, frameRate: { ideal: 30, max: 30 } } });
        } catch (cause) {
          if (cancelled || !(cause instanceof DOMException) || cause.name !== "OverconstrainedError") throw cause;
          media = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: { ideal: "environment" }, width: { exact: 1080 }, height: { exact: 1920 }, frameRate: { ideal: 30, max: 30 } } });
        }
        if (cancelled) { media.getTracks().forEach(t => t.stop()); return; }
        stream.current = media;
        const settings = media.getVideoTracks()[0].getSettings();
        if (!settings.width || !settings.height || Math.min(settings.width, settings.height) < 1080 || Math.max(settings.width, settings.height) < 1920) throw new Error("A câmera não disponibilizou Full HD. Tente novamente ou selecione um vídeo já gravado.");
        if (video.current) { video.current.removeAttribute("src"); video.current.srcObject = media; await video.current.play(); }
        if (!cancelled) setPhase("ready");
      } catch (cause) {
        if (cancelled) return;
        stream.current?.getTracks().forEach(t => t.stop());
        const name = cause instanceof Error ? cause.name : "";
        setError(name === "NotAllowedError" ? "Permita acesso à câmera e ao microfone no navegador e tente novamente." : name === "OverconstrainedError" ? "A câmera não disponibilizou Full HD. Tente novamente ou selecione um vídeo já gravado." : name === "NotReadableError" ? "A câmera está ocupada. Feche outros aplicativos que a utilizam e tente novamente." : cause instanceof Error ? cause.message : "Não foi possível abrir a câmera.");
        setPhase("error");
      }
    }
    void open();
    const hidden = () => { if (document.hidden && recorder.current?.state === "recording") recorder.current.stop(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelled = true; alive.current = false;
      document.removeEventListener("visibilitychange", hidden);
      if (timer.current) clearInterval(timer.current);
      if (recorder.current) {
        recorder.current.onstop = null; recorder.current.ondataavailable = null; recorder.current.onerror = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
        recorder.current = null;
      }
      stream.current?.getTracks().forEach(t => t.stop());
      if (previewElement) { previewElement.onloadedmetadata = null; previewElement.onerror = null; }
      if (recordedUrl.current) { URL.revokeObjectURL(recordedUrl.current); recordedUrl.current = null; }
    };
  }, [attempt]);

  function stop() {
    if (timer.current) clearInterval(timer.current);
    if (recorder.current?.state === "recording") { setPhase("finishing"); recorder.current.stop(); }
  }
  function start() {
    if (phase !== "ready" || !stream.current) return;
    try {
      const mimeType = ["video/mp4;codecs=avc1.424028,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Formato de gravação indisponível neste navegador.");
      const capture = new MediaRecorder(stream.current, { mimeType, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 });
      recorder.current = capture;
      const chunks: Blob[] = [];
      let size = 0;
      let failed = false;
      capture.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); size += event.data.size; } if (size >= 240000000) stop(); };
      capture.onerror = () => {
        failed = true;
        if (timer.current) clearInterval(timer.current);
        stream.current?.getTracks().forEach(t => t.stop());
        if (alive.current) { setError("A gravação foi interrompida. Tente novamente."); setPhase("error"); }
      };
      capture.onstop = () => {
        if (timer.current) clearInterval(timer.current);
        if (!alive.current || failed) return;
        stream.current?.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: capture.mimeType || mimeType });
        if (!blob.size || blob.size > 250000000) { setError("Não foi possível concluir o vídeo. Grave novamente."); setPhase("error"); return; }
        const file = new File([blob], `checklist-${Date.now()}.${blob.type.includes("mp4") ? "mp4" : "webm"}`, { type: blob.type });
        const url = URL.createObjectURL(file);
        recordedUrl.current = url;
        const preview = video.current;
        if (!preview) { URL.revokeObjectURL(url); recordedUrl.current = null; setError("Não foi possível conferir o vídeo gravado."); setPhase("error"); return; }
        preview.srcObject = null;
        preview.onloadedmetadata = () => {
          if (!alive.current) return;
          if (Math.min(preview.videoWidth, preview.videoHeight) < 1080 || Math.max(preview.videoWidth, preview.videoHeight) < 1920) {
            URL.revokeObjectURL(url); recordedUrl.current = null;
            setError("O navegador gravou abaixo de Full HD. Grave pelo app Câmera e use Selecionar vídeo.");
            setPhase("error");
            return;
          }
          setResult(file); setPhase("review");
        };
        preview.onerror = () => { if (!alive.current) return; URL.revokeObjectURL(url); recordedUrl.current = null; setError("Não foi possível conferir a resolução do vídeo."); setPhase("error"); };
        preview.src = url;
        preview.load();
      };
      capture.start(1000); setSeconds(0); setPhase("recording");
      const started = performance.now();
      timer.current = setInterval(() => { const elapsed = Math.floor((performance.now() - started) / 1000); setSeconds(elapsed); if (elapsed >= 119) stop(); }, 250);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao iniciar gravação."); setPhase("error"); stream.current?.getTracks().forEach(t => t.stop()); }
  }
  function retry() { setPhase("opening"); setError(""); setResult(null); setAttempt(value => value + 1); }

  return <DialogContent showCloseButton={false} onInteractOutside={event => event.preventDefault()} className="inset-0 z-[100] flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black p-0 text-white sm:max-w-none">
    <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
      <div><DialogTitle className="text-base">Vídeo do checklist</DialogTitle><DialogDescription className="text-xs text-white/70">Full HD · até 2 minutos</DialogDescription></div>
      <Button type="button" size="icon" variant="ghost" className="text-white hover:bg-white/20 hover:text-white" aria-label="Fechar câmera e descartar gravação" onClick={onClose}><X /></Button>
    </div>
    <div className="relative flex min-h-0 flex-1 items-center justify-center">
      <video ref={video} autoPlay={phase !== "review"} muted={phase !== "review"} controls={phase === "review"} playsInline className="h-full w-full object-contain" />
      {phase === "opening" && <p role="status" className="absolute rounded bg-black/70 p-3">Abrindo câmera…</p>}
    </div>
    <div className="space-y-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      {error && <p role="alert" className="text-sm">{error}</p>}
      {(phase === "recording" || phase === "finishing") && <p role="status" className="tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p>}
      <div className="flex justify-center gap-3">
        {phase === "ready" && <Button type="button" className="bg-red-600 text-white hover:bg-red-700" onClick={start}><Circle className="fill-current" />Gravar</Button>}
        {(phase === "recording" || phase === "finishing") && <Button type="button" disabled={phase === "finishing"} onClick={stop}><Square className="fill-current" />{phase === "finishing" ? "Concluindo…" : "Parar"}</Button>}
        {(phase === "review" || phase === "error") && <Button type="button" onClick={retry}>Gravar novamente</Button>}
        {phase === "review" && result && <Button type="button" onClick={() => onCapture(result)}>Usar vídeo</Button>}
      </div>
    </div>
  </DialogContent>;
}
