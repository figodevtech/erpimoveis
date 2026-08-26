"use client";

import * as React from "react";
import { AlertCircle, Loader2, Pause, Play, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { fetchAudioUrl } from "./chat-api";
import { chatAudioDurationLabel } from "./chat-utils";

/**
 * Somente um audio toca por vez em toda a timeline. O registro fica no modulo
 * porque a pausa precisa alcancar um balao que nao e ancestral nem filho.
 */
let reprodutorAtivo: { pause: () => void } | null = null;

function assumirReproducao(controle: { pause: () => void }) {
  if (reprodutorAtivo && reprodutorAtivo !== controle) reprodutorAtivo.pause();
  reprodutorAtivo = controle;
}

function liberarReproducao(controle: { pause: () => void }) {
  if (reprodutorAtivo === controle) reprodutorAtivo = null;
}

export function ChatAudioPlayer({
  messageId,
  durationMs,
  localUrl,
  own,
  disabled,
}: {
  messageId: string;
  durationMs: number;
  /** Blob da propria gravacao, disponivel antes da confirmacao do servidor. */
  localUrl?: string | null;
  own: boolean;
  disabled?: boolean;
}) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlExpiraEmRef = React.useRef(0);
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [position, setPosition] = React.useState(0);
  const totalSegundos = Math.max(1, Math.round(durationMs / 1_000));

  const pause = React.useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const controleRef = React.useRef({ pause });
  controleRef.current.pause = pause;

  React.useEffect(() => {
    const controle = controleRef.current;
    return () => {
      // Desmontar precisa parar o audio e soltar o elemento; caso contrario a
      // reproducao continua depois que o balao sai da tela.
      controle.pause();
      liberarReproducao(controle);
      const element = audioRef.current;
      if (element) {
        element.src = "";
        element.load();
      }
      audioRef.current = null;
    };
  }, []);

  const garantirElemento = React.useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const element = new Audio();
    element.preload = "none";
    element.addEventListener("timeupdate", () => setPosition(element.currentTime));
    element.addEventListener("ended", () => {
      setPlaying(false);
      setPosition(0);
      element.currentTime = 0;
      liberarReproducao(controleRef.current);
    });
    element.addEventListener("pause", () => setPlaying(false));
    element.addEventListener("error", () => {
      setPlaying(false);
      setError("Não foi possível reproduzir.");
    });
    audioRef.current = element;
    return element;
  }, []);

  const garantirFonte = React.useCallback(async () => {
    const element = garantirElemento();
    if (localUrl) {
      if (element.src !== localUrl) element.src = localUrl;
      return element;
    }
    // A URL assinada e curta de proposito; perto do vencimento pedimos outra.
    if (element.src && Date.now() < urlExpiraEmRef.current) return element;

    setLoading(true);
    try {
      const acesso = await fetchAudioUrl(messageId);
      element.src = acesso.url;
      urlExpiraEmRef.current = new Date(acesso.expiresAt).getTime() - 15_000;
      return element;
    } finally {
      setLoading(false);
    }
  }, [garantirElemento, localUrl, messageId]);

  const alternar = async () => {
    if (disabled) return;
    if (playing) {
      pause();
      return;
    }

    setError(null);
    try {
      const element = await garantirFonte();
      assumirReproducao(controleRef.current);
      await element.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setError("Não foi possível reproduzir.");
    }
  };

  const buscar = (segundos: number) => {
    const element = audioRef.current;
    setPosition(segundos);
    if (element && element.src) element.currentTime = segundos;
  };

  const restante = Math.max(0, totalSegundos - Math.floor(position));
  const progresso = Math.min(100, Math.max(0, (position / totalSegundos) * 100));

  return (
    <div className="flex min-w-0 items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={() => void alternar()}
        disabled={disabled}
        aria-label={error ? "Tentar reproduzir mensagem de voz novamente" : playing ? "Pausar mensagem de voz" : "Reproduzir mensagem de voz"}
        aria-busy={loading}
        data-chat-message-control="true"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full shadow-sm transition-[background-color,transform,box-shadow] duration-150 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 active:scale-95 disabled:opacity-50 motion-reduce:transform-none",
          own
            ? "bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 focus-visible:ring-primary-foreground/70"
            : "bg-primary/12 text-primary hover:bg-primary/20 focus-visible:ring-primary/60",
        )}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : playing ? (
          <Pause aria-hidden="true" className="size-4" />
        ) : (
          <Play aria-hidden="true" className="size-4" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={totalSegundos}
          step={1}
          value={Math.min(position, totalSegundos)}
          onChange={(event) => buscar(Number(event.target.value))}
          disabled={disabled}
          aria-label="Posição da mensagem de voz"
          aria-valuetext={`${chatAudioDurationLabel(position * 1_000)} de ${chatAudioDurationLabel(durationMs)}`}
          data-own={own ? "true" : "false"}
          data-chat-message-control="true"
          className="chat-audio-progress h-5 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-default"
          style={{ "--chat-audio-progress": `${progresso}%` } as React.CSSProperties}
        />
        <div
          className={cn(
            "mt-1 flex items-center gap-1.5 text-[10px] tabular-nums",
            own ? "text-primary-foreground/75" : "text-muted-foreground",
          )}
        >
          <span>{chatAudioDurationLabel(restante * 1_000)}</span>
          <span aria-hidden="true">·</span>
          <span>Mensagem de voz</span>
        </div>
        {error ? (
          <p role="alert" className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-destructive">
            <AlertCircle aria-hidden="true" className="size-3" />
            {error}
            {!disabled ? (
              <button
                type="button"
                data-chat-message-control="true"
                className="inline-flex items-center gap-1 rounded font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void alternar()}
              >
                <RotateCcw aria-hidden="true" className="size-3" /> Tentar novamente
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
