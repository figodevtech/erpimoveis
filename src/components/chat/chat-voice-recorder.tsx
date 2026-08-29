"use client";

import * as React from "react";
import { AlertCircle, Loader2, Mic, Pause, Play, Send, Square, Trash2 } from "lucide-react";

import { CHAT_VOICE_MAX_BYTES, CHAT_VOICE_MAX_DURATION_MS } from "@/lib/chat/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { chatAudioDurationLabel } from "./chat-utils";

/** Ordem de preferencia; nem todo navegador produz o mesmo codec. */
const FORMATOS_PREFERIDOS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

export function chatRecordingSupported() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.MediaRecorder
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function"
    && window.isSecureContext,
  );
}

function escolherFormato() {
  if (typeof window === "undefined" || !window.MediaRecorder) return undefined;
  return FORMATOS_PREFERIDOS.find((tipo) => {
    try {
      return MediaRecorder.isTypeSupported(tipo);
    } catch {
      return false;
    }
  });
}

function mensagemDeErro(error: unknown) {
  const name = (error as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permissão do microfone negada. Autorize o acesso nas configurações do navegador para gravar áudio.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Nenhum microfone foi encontrado neste dispositivo.";
  }
  if (name === "NotReadableError") {
    return "O microfone está em uso por outro aplicativo.";
  }
  return "Não foi possível gravar o áudio. Tente novamente.";
}

type Estado = "solicitando" | "gravando" | "revisando";

export function ChatVoiceRecorder({
  sending,
  onCancel,
  onSend,
}: {
  sending: boolean;
  onCancel: () => void;
  onSend: (blob: Blob, durationMs: number) => void;
}) {
  const [estado, setEstado] = React.useState<Estado>("solicitando");
  const [erro, setErro] = React.useState<string | null>(null);
  const [decorridoMs, setDecorridoMs] = React.useState(0);
  const [gravacao, setGravacao] = React.useState<{ blob: Blob; url: string; durationMs: number } | null>(null);
  const [ouvindo, setOuvindo] = React.useState(false);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<BlobPart[]>([]);
  const inicioRef = React.useRef(0);
  const timerRef = React.useRef<number | null>(null);
  const previewRef = React.useRef<HTMLAudioElement | null>(null);
  const canceladoRef = React.useRef(false);

  const pararTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const soltarMicrofone = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const pararGravacao = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  React.useEffect(() => {
    let ativo = true;
    canceladoRef.current = false;

    // A permissao so e pedida agora, depois do clique explicito no microfone.
    const iniciar = async () => {
      if (!chatRecordingSupported()) {
        setErro("Este navegador não permite gravar áudio. Use o Chrome, o Edge ou o Safari atualizados.");
        setEstado("revisando");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!ativo) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const mimeType = escolherFormato();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
        });

        recorder.addEventListener("stop", () => {
          pararTimer();
          soltarMicrofone();
          const duracao = Date.now() - inicioRef.current;
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
          chunksRef.current = [];

          if (!ativo || canceladoRef.current) return;
          if (blob.size === 0) {
            setErro("A gravação ficou vazia. Tente novamente.");
            setEstado("revisando");
            return;
          }
          if (blob.size > CHAT_VOICE_MAX_BYTES) {
            setErro("O áudio ficou maior que o limite de 10 MB.");
            setEstado("revisando");
            return;
          }
          setGravacao({ blob, url: URL.createObjectURL(blob), durationMs: Math.max(1, duracao) });
          setEstado("revisando");
        });

        recorder.addEventListener("error", () => {
          if (!ativo) return;
          setErro("A gravação foi interrompida.");
          pararGravacao();
        });

        inicioRef.current = Date.now();
        recorder.start();
        setEstado("gravando");

        timerRef.current = window.setInterval(() => {
          const decorrido = Date.now() - inicioRef.current;
          setDecorridoMs(decorrido);
          // Ao alcancar o tempo maximo a gravacao para sozinha e vai para revisao.
          if (decorrido >= CHAT_VOICE_MAX_DURATION_MS) pararGravacao();
        }, 200);
      } catch (error) {
        if (!ativo) return;
        setErro(mensagemDeErro(error));
        setEstado("revisando");
      }
    };

    void iniciar();

    return () => {
      ativo = false;
      pararTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null;
      soltarMicrofone();
      previewRef.current?.pause();
      previewRef.current = null;
    };
  }, [pararGravacao, pararTimer, soltarMicrofone]);

  React.useEffect(() => {
    // Esconder a aba ou fechar a tela encerra a gravacao e leva para a revisao
    // em vez de perder o audio silenciosamente.
    const encerrar = () => {
      if (document.visibilityState === "hidden") pararGravacao();
    };
    document.addEventListener("visibilitychange", encerrar);
    window.addEventListener("pagehide", pararGravacao);
    return () => {
      document.removeEventListener("visibilitychange", encerrar);
      window.removeEventListener("pagehide", pararGravacao);
    };
  }, [pararGravacao]);

  React.useEffect(() => {
    const url = gravacao?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [gravacao?.url]);

  const descartar = () => {
    canceladoRef.current = true;
    pararGravacao();
    previewRef.current?.pause();
    onCancel();
  };

  const alternarPreview = () => {
    if (!gravacao) return;
    if (!previewRef.current) {
      const element = new Audio(gravacao.url);
      element.addEventListener("ended", () => setOuvindo(false));
      element.addEventListener("pause", () => setOuvindo(false));
      previewRef.current = element;
    }
    if (ouvindo) {
      previewRef.current.pause();
      return;
    }
    void previewRef.current.play().then(() => setOuvindo(true)).catch(() => setOuvindo(false));
  };

  const duracaoExibida = gravacao ? gravacao.durationMs : decorridoMs;
  const estadoVisual = sending
    ? "sending"
    : erro
      ? "failed"
      : estado === "gravando"
        ? "recording"
        : estado === "revisando" && gravacao
          ? "reviewing"
          : "preparing";

  return (
    <div
      className="chat-composer-surface rounded-2xl border border-border/70 p-2.5 shadow-sm transition-[border-color,box-shadow] duration-150"
      role="group"
      aria-label="Gravação de mensagem de voz"
      data-chat-voice-state={estadoVisual}
    >
      <p aria-live="polite" className="sr-only">
        {sending
          ? `Enviando mensagem de voz, ${chatAudioDurationLabel(duracaoExibida)}`
          : estado === "gravando"
          ? `Gravando, ${chatAudioDurationLabel(decorridoMs)}`
          : gravacao
            ? `Gravação pronta, ${chatAudioDurationLabel(gravacao.durationMs)}`
            : erro
              ? erro
              : "Preparando o microfone"}
      </p>

      {erro ? (
        <div role="alert" className="mb-2 flex items-start gap-2 rounded-xl bg-destructive/[0.08] px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{erro}</span>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-xl text-destructive hover:bg-destructive/10"
          aria-label="Descartar gravação"
          onClick={descartar}
          disabled={sending}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          {sending ? (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              </span>
              <span className="text-xs font-semibold text-foreground">Enviando</span>
            </>
          ) : erro ? (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertCircle aria-hidden="true" className="size-3.5" />
              </span>
              <span className="text-xs font-semibold text-destructive">Falha</span>
            </>
          ) : estado === "gravando" ? (
            <>
              <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <span
                  aria-hidden="true"
                  className="size-2.5 animate-pulse rounded-full bg-destructive motion-reduce:animate-none"
                />
              </span>
              <span className="text-xs font-semibold text-destructive">Gravando</span>
            </>
          ) : estado === "solicitando" ? (
            <>
              <Mic aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Preparando o microfone</span>
            </>
          ) : gravacao ? (
            <>
              <span className="hidden text-xs font-semibold text-foreground min-[390px]:inline">Revisando</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg px-2 text-xs"
                onClick={alternarPreview}
                aria-label={ouvindo ? "Pausar prévia" : "Ouvir prévia"}
              >
                {ouvindo ? <Pause aria-hidden="true" className="size-3.5" /> : <Play aria-hidden="true" className="size-3.5" />}
                Ouvir
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Gravação indisponível</span>
          )}

          <span className={cn("ml-auto text-xs tabular-nums", estado === "gravando" ? "font-semibold text-destructive" : "text-muted-foreground")}>
            {chatAudioDurationLabel(duracaoExibida)}
          </span>
        </div>

        {estado === "gravando" && !sending ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="size-10 shrink-0 rounded-xl"
            aria-label="Parar gravação"
            onClick={pararGravacao}
          >
            <Square aria-hidden="true" className="size-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="size-10 shrink-0 rounded-xl"
            aria-label="Enviar mensagem de voz"
            disabled={!gravacao || sending}
            onClick={() => {
              if (!gravacao) return;
              previewRef.current?.pause();
              onSend(gravacao.blob, gravacao.durationMs);
            }}
          >
            {sending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
