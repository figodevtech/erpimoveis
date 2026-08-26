"use client";

import * as React from "react";
import { AlertCircle, Bell, BellOff, BellRing, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-provider";

type PushVisualState = "available" | "busy" | "active" | "denied" | "unavailable" | "error";

/**
 * Consentimento explícito das notificações do chat. A permissão do navegador
 * só é solicitada depois do clique; os demais estados são apenas informativos.
 */
export function ChatPushSettings() {
  const { push } = useChat();
  const [detalhes, setDetalhes] = React.useState(false);

  const bloqueado = push.permission === "denied";
  const servidorIndisponivel = push.status?.supported === false;
  const navegadorIndisponivel = push.support.state !== "supported";
  const indisponivel = servidorIndisponivel || navegadorIndisponivel;
  const visualState: PushVisualState = push.busy
    ? "busy"
    : push.enabledOnThisDevice
      ? "active"
      : bloqueado
        ? "denied"
        : indisponivel
          ? "unavailable"
          : push.error
            ? "error"
            : "available";

  const icon = visualState === "busy"
    ? <Loader2 aria-hidden="true" className="size-4 animate-spin" />
    : visualState === "active"
      ? <BellRing aria-hidden="true" className="size-4" />
      : visualState === "denied" || visualState === "unavailable"
        ? <BellOff aria-hidden="true" className="size-4" />
        : visualState === "error"
          ? <AlertCircle aria-hidden="true" className="size-4" />
          : <Bell aria-hidden="true" className="size-4" />;

  return (
    <section
      data-chat-push-state={visualState}
      className={cn(
        "mx-3 mt-2 overflow-hidden rounded-2xl border px-3 py-3 text-[11px] leading-relaxed shadow-xs transition-[background-color,border-color,box-shadow] duration-200",
        visualState === "active" && "border-primary/25 bg-primary/[0.07] shadow-primary/5",
        visualState === "busy" && "border-primary/20 bg-accent/60",
        visualState === "denied" && "border-destructive/20 bg-destructive/[0.05]",
        visualState === "error" && "border-destructive/25 bg-destructive/[0.06]",
        (visualState === "available" || visualState === "unavailable") && "border-border/60 bg-card/65",
      )}
      aria-label="Configuração das notificações do chat"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl",
            visualState === "active" && "bg-primary/15 text-primary",
            visualState === "busy" && "bg-primary/10 text-primary",
            (visualState === "denied" || visualState === "error") && "bg-destructive/10 text-destructive",
            (visualState === "available" || visualState === "unavailable") && "bg-muted text-muted-foreground",
          )}
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          {visualState === "busy" ? (
            <>
              <p className="font-semibold text-foreground">
                {push.enabledOnThisDevice ? "Atualizando notificações" : "Ativando notificações"}
              </p>
              <p className="mt-0.5 text-muted-foreground">Aguarde enquanto este dispositivo é atualizado.</p>
            </>
          ) : visualState === "active" ? (
            <>
              <p className="font-semibold text-foreground">Ativo neste dispositivo</p>
              <p className="mt-0.5 text-muted-foreground">
                Você recebe avisos de novas mensagens mesmo com o ERP fechado.
                {typeof push.status?.deviceCount === "number" && push.status.deviceCount > 1
                  ? ` ${push.status.deviceCount} dispositivos estão ativos na sua conta.`
                  : null}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1.5 h-8 rounded-lg px-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                disabled={push.busy}
                onClick={() => void push.disable()}
              >
                Desativar neste dispositivo
              </Button>
            </>
          ) : visualState === "denied" ? (
            <>
              <p className="font-semibold text-foreground">Permissão negada</p>
              <p className="mt-0.5 text-muted-foreground">
                Libere as notificações do ERP nas configurações do navegador ou do sistema para poder ativá-las aqui.
              </p>
            </>
          ) : visualState === "unavailable" ? (
            <>
              <p className="font-semibold text-foreground">Notificações indisponíveis</p>
              <p className="mt-0.5 text-muted-foreground">
                {servidorIndisponivel
                  ? "O envio de notificações ainda não está configurado nesta instalação."
                  : push.support.state === "unsupported"
                    ? push.support.reason
                    : "Este dispositivo não oferece suporte ao Web Push."}
              </p>
            </>
          ) : visualState === "error" ? (
            <>
              <p className="font-semibold text-foreground">Não foi possível ativar</p>
              <p role="alert" className="mt-0.5 text-destructive">{push.error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-8 rounded-lg px-2.5 text-[11px] font-semibold"
                onClick={() => void push.enable()}
              >
                Tentar novamente
              </Button>
            </>
          ) : (
            <>
              <p className="font-semibold text-foreground">Ativar notificações do chat</p>
              <p className="mt-0.5 text-muted-foreground">
                Receba um aviso quando alguém enviar mensagem, mesmo com o ERP em segundo plano ou fechado.
              </p>
              {detalhes ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  <li>usadas somente para novas mensagens do chat interno;</li>
                  <li>mostram o nome de quem enviou e uma prévia curta;</li>
                  <li>podem ser desativadas aqui mesmo, a qualquer momento;</li>
                  <li>valem apenas para este dispositivo e navegador.</li>
                </ul>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg px-2.5 text-[11px] font-semibold"
                  disabled={push.busy}
                  onClick={() => void push.enable()}
                >
                  Ativar notificações
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-[11px]"
                  aria-expanded={detalhes}
                  onClick={() => setDetalhes((valor) => !valor)}
                >
                  {detalhes ? "Ocultar detalhes" : "Como funciona"}
                </Button>
              </div>
            </>
          )}

          {visualState === "active" && push.error ? (
            <p role="alert" className="mt-1.5 flex items-start gap-1 text-destructive">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0 flex-1">{push.error}</span>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
