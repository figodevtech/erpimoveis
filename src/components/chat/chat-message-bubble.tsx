"use client";

import * as React from "react";
import { AlertCircle, Ban, Check, CheckCheck, Mic } from "lucide-react";

import type { ChatMessage, ChatReaction } from "@/lib/chat/contracts";
import { CHAT_REACTION_LABELS } from "@/lib/chat/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatAudioPlayer } from "./chat-audio-player";
import {
  ChatMessageActions,
  ChatMessageReactionPicker,
} from "./chat-message-actions";
import { canDeleteChatMessageForEveryone, canEditChatMessage } from "./chat-utils";

export type ChatMessageBubbleActions = {
  onReply: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, reaction: ChatReaction) => void;
  onEdit: (message: ChatMessage) => void;
  onDeleteForMe: (message: ChatMessage) => void;
  onDeleteForEveryone: (message: ChatMessage) => void;
  onJumpToMessage: (messageId: string) => void;
};

function ReplyQuote({
  reply,
  own,
  onJump,
}: {
  reply: NonNullable<ChatMessage["reply"]>;
  own: boolean;
  onJump: () => void;
}) {
  const vazio = !reply.content;
  const resumo = reply.type === "VOICE" ? "Mensagem de voz" : reply.content;

  return (
    <button
      type="button"
      onClick={onJump}
      disabled={!reply.messageId}
      aria-label={`Ir para a mensagem de ${reply.senderName}`}
      data-chat-message-control="true"
      className={cn(
        "mb-1.5 flex w-full min-w-0 gap-2 rounded-lg border-l-[3px] px-2.5 py-2 text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-default",
        own
          ? "border-primary-foreground/65 bg-primary-foreground/12 hover:bg-primary-foreground/20"
          : "border-primary/65 bg-primary/[0.07] hover:bg-primary/[0.12]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[11px] font-semibold", own ? "text-primary-foreground" : "text-primary")}>
          {reply.senderName || "Mensagem citada"}
        </span>
        <span
          className={cn(
            "mt-0.5 flex items-start gap-1 text-[11px] leading-snug",
            own ? "text-primary-foreground/80" : "text-muted-foreground",
            vazio && reply.type !== "VOICE" && "italic",
          )}
        >
          {reply.type === "VOICE" ? <Mic aria-hidden="true" className="mt-px size-3 shrink-0" /> : null}
          <span className="line-clamp-2 min-w-0">{resumo || "Mensagem excluída"}</span>
        </span>
      </span>
    </button>
  );
}

/**
 * Confirmação de envio no estilo WhatsApp, só nas mensagens próprias.
 *
 * Um tique aparece imediatamente, junto da mensagem otimista, e vira dois
 * quando o servidor confirma a persistência. A escolha é deliberada: um spinner
 * girando enquanto a rede responde transmite espera e ansiedade, enquanto o
 * tique único já comunica "saiu daqui".
 *
 * Os dois tiques significam **persistida no servidor**, não entregue ao
 * aparelho nem lida — o módulo não possui recibo de entrega nem de leitura, e
 * por isso os rótulos são "Enviando" e "Enviada" e nunca há tique azul.
 */
function ChatMessageTicks({
  message,
  own,
  excluida,
}: {
  message: ChatMessage;
  own: boolean;
  excluida: boolean;
}) {
  if (!own || excluida || message.sendStatus === "failed") return null;

  const enviando = message.sendStatus === "sending";
  const Icone = enviando ? Check : CheckCheck;

  return (
    <Icone
      role="img"
      aria-label={enviando ? "Enviando" : "Enviada"}
      className={cn("size-3.5 shrink-0", enviando && "opacity-70")}
    />
  );
}

export function ChatMessageBubble({
  message,
  own,
  onRetry,
  actions,
  highlighted = false,
  selected = false,
  onInteractionOpenChange,
  currentUserId,
}: {
  message: ChatMessage;
  own: boolean;
  onRetry: (message: ChatMessage) => void;
  actions?: ChatMessageBubbleActions;
  highlighted?: boolean;
  selected?: boolean;
  onInteractionOpenChange?: (open: boolean) => void;
  currentUserId: string;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [reactionOpen, setReactionOpen] = React.useState(false);
  const excluida = Boolean(message.deletedForEveryoneAt);
  const persistida = message.sendStatus === "sent";
  const podeEditar = canEditChatMessage(message, currentUserId);
  const podeExcluirParaTodos = canDeleteChatMessageForEveryone(message, currentUserId);
  const hasActions = Boolean(actions && persistida);
  /**
   * O gatilho de ações só aparece depois de a mensagem ser persistida, mas a
   * faixa dele é reservada desde o envio otimista. Sem isso o balão nasce
   * estreito com um tique e alarga sozinho ao ganhar o segundo, deslocando
   * texto e horário na frente de quem acabou de escrever.
   */
  const reservaAcoes = Boolean(actions);

  const changeMenuOpen = (open: boolean) => {
    setMenuOpen(open);
    if (open) setReactionOpen(false);
    onInteractionOpenChange?.(open || reactionOpen);
  };

  const changeReactionOpen = (open: boolean) => {
    setReactionOpen(open);
    if (open) setMenuOpen(false);
    onInteractionOpenChange?.(open || menuOpen);
  };

  return (
    <div
      className={cn("group/message flex w-full items-start", own ? "justify-end" : "justify-start")}
      data-message-id={message.id}
      data-chat-message-selected={selected ? "true" : "false"}
    >
      <div className={cn("flex max-w-[82%] min-w-0 flex-col", own ? "items-end" : "items-start")}>
        <div
          className="relative min-w-0 max-w-full"
          data-chat-message-key={`${message.senderId}:${message.clientMessageId}`}
        >
          <div
            data-chat-message-bubble="true"
            className={cn(
              "relative min-w-0 rounded-[18px] px-3.5 py-2.5 text-[13px] leading-relaxed shadow-[0_1px_2px_rgb(15_23_42/0.06)] transition-[box-shadow,background-color] duration-300",
              own
                ? "rounded-br-md bg-gradient-to-br from-primary to-violet-700 text-primary-foreground dark:to-violet-600"
                : "rounded-bl-md border border-border/65 bg-card/90 text-card-foreground dark:bg-muted/70",
              excluida && "bg-none bg-muted/70 text-muted-foreground dark:bg-muted/50",
              excluida && own && "border border-border/60",
              message.sendStatus === "failed" && "border border-destructive/35 bg-none bg-destructive/[0.07] text-foreground dark:bg-destructive/10",
              highlighted && "ring-2 ring-primary/60 ring-offset-2 ring-offset-transparent shadow-[0_0_0_6px_color-mix(in_srgb,var(--primary)_12%,transparent),0_8px_24px_-16px_var(--primary)]",
              reservaAcoes && "pr-10",
              message.type === "VOICE" && !excluida && "w-[min(16rem,72vw)]",
              "motion-reduce:transition-none",
            )}
          >
            {hasActions ? (
              <ChatMessageActions
                own={own}
                open={menuOpen}
                selected={selected || menuOpen}
                canReply={!excluida}
                canEdit={podeEditar}
                canDeleteForEveryone={podeExcluirParaTodos}
                onOpenChange={changeMenuOpen}
                onReply={() => actions?.onReply(message)}
                onEdit={() => actions?.onEdit(message)}
                onDeleteForMe={() => actions?.onDeleteForMe(message)}
                onDeleteForEveryone={() => actions?.onDeleteForEveryone(message)}
              />
            ) : null}

            {message.reply && !excluida ? (
              <ReplyQuote
                reply={message.reply}
                own={own}
                onJump={() => {
                  if (message.reply?.messageId) actions?.onJumpToMessage(message.reply.messageId);
                }}
              />
            ) : null}

            {excluida ? (
              <p className="flex items-center gap-1.5 italic">
                <Ban aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
                Mensagem excluída
              </p>
            ) : message.type === "VOICE" ? (
              <ChatAudioPlayer
                messageId={message.id}
                durationMs={message.audio?.durationMs ?? 0}
                localUrl={message.localAudioUrl}
                own={own && message.sendStatus !== "failed"}
                disabled={message.sendStatus === "failed"}
              />
            ) : (
              <p className="select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
            )}

            <div
              className={cn(
                "mt-1 flex items-center justify-end gap-1 text-[10px] leading-none",
                own && message.sendStatus !== "failed" && !excluida
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground",
              )}
            >
              {message.editedAt && !excluida ? <span>editada</span> : null}
              <time>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
              <ChatMessageTicks message={message} own={own} excluida={excluida} />
            </div>
          </div>

          {hasActions && !excluida ? (
            <ChatMessageReactionPicker
              reactions={message.reactions}
              own={own}
              open={reactionOpen}
              selected={selected || reactionOpen}
              onOpenChange={changeReactionOpen}
              onReact={(reaction) => actions?.onReact(message, reaction)}
            />
          ) : null}
        </div>

        {message.reactions.length > 0 && !excluida ? (
          <div className={cn("relative z-[1] -mt-1 flex flex-wrap gap-1 px-1", own ? "justify-end" : "justify-start")}>
            {message.reactions.map((item) => {
              const label = CHAT_REACTION_LABELS[item.reaction];
              if (!label) return null;
              return (
                <button
                  key={item.reaction}
                  type="button"
                  onClick={() => actions?.onReact(message, item.reaction)}
                  disabled={!actions || !persistida}
                  aria-pressed={item.own}
                  aria-label={`${label.nome}: ${item.total} ${item.total === 1 ? "reação" : "reações"}${item.own ? ", incluindo a sua" : ""}`}
                  data-chat-message-control="true"
                  className={cn(
                    "flex min-h-6 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tabular-nums shadow-xs transition-[color,background-color,border-color,transform] duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default active:scale-95 motion-reduce:transform-none",
                    item.own
                      ? "border-primary/40 bg-primary/15 font-semibold text-primary"
                      : "border-border/70 bg-background/95 text-muted-foreground hover:bg-card hover:text-foreground",
                  )}
                >
                  <span aria-hidden="true">{label.emoji}</span>
                  <span aria-hidden="true">{item.total}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {message.sendStatus === "failed" ? (
          <div role="alert" className="mt-1.5 flex flex-wrap items-center justify-end gap-1 text-[11px] text-destructive">
            <AlertCircle className="size-3" aria-hidden="true" />
            <span>{message.error || "Não foi possível enviar."}</span>
            {message.retryable !== false ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                data-chat-message-control="true"
                className="h-auto rounded-md px-1 py-0 text-[11px] font-semibold text-destructive"
                onClick={() => onRetry(message)}
              >
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
