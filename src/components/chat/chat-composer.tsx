"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, Check, Loader2, Mic, Pencil, Reply, Send, X } from "lucide-react";

import type { ChatMessage } from "@/lib/chat/contracts";
import { CHAT_MESSAGE_MAX_LENGTH } from "@/lib/chat/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { chatRecordingSupported, ChatVoiceRecorder } from "./chat-voice-recorder";
import { chatMessageSummaryText } from "./chat-utils";

export type ChatComposerReply = { message: ChatMessage; authorName: string };
export type ChatComposerEditing = { message: ChatMessage };

export function ChatComposer({
  onSend,
  sending,
  reply,
  onCancelReply,
  editing,
  onSubmitEdit,
  onCancelEdit,
  editSaving,
  editError,
  onSendVoice,
  voiceSending,
}: {
  onSend: (content: string) => void;
  sending: boolean;
  reply: ChatComposerReply | null;
  onCancelReply: () => void;
  editing: ChatComposerEditing | null;
  onSubmitEdit: (content: string) => void;
  onCancelEdit: () => void;
  editSaving: boolean;
  editError: string | null;
  onSendVoice: (blob: Blob, durationMs: number) => void;
  voiceSending: boolean;
}) {
  const [content, setContent] = React.useState("");
  const [gravando, setGravando] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const voiceSendingWasActiveRef = React.useRef(false);
  const reduceMotion = useReducedMotion();
  const valid = content.trim().length > 0 && content.trim().length <= CHAT_MESSAGE_MAX_LENGTH;
  const ocupado = sending || editSaving;
  const sendHighlighted = valid || ocupado;
  const nearingLimit = content.length >= Math.floor(CHAT_MESSAGE_MAX_LENGTH * 0.9);
  const gravacaoDisponivel = React.useMemo(chatRecordingSupported, []);

  const resize = React.useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  }, []);

  const editingId = editing?.message.id ?? null;

  React.useEffect(() => {
    // Entrar em edicao carrega o conteudo atual; sair devolve o rascunho vazio.
    if (editingId && editing) {
      setGravando(false);
      setContent(editing.message.content);
      requestAnimationFrame(() => {
        resize();
        const element = textareaRef.current;
        if (!element) return;
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
      });
    } else {
      setContent("");
      requestAnimationFrame(resize);
    }
    // `editing` muda de referencia a cada render do pai; a identidade da
    // mensagem e o que realmente decide recarregar o editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, resize]);

  React.useEffect(() => {
    if (reply) textareaRef.current?.focus();
  }, [reply]);

  React.useEffect(() => {
    if (voiceSending) {
      voiceSendingWasActiveRef.current = true;
      return;
    }
    if (voiceSendingWasActiveRef.current) {
      voiceSendingWasActiveRef.current = false;
      setGravando(false);
    }
  }, [voiceSending]);

  const submit = () => {
    if (!valid || ocupado) return;
    const texto = content.trim();
    if (editing) {
      onSubmitEdit(texto);
      return;
    }
    onSend(texto);
    setContent("");
    requestAnimationFrame(resize);
  };

  return (
    <div
      className="chat-composer-dock shrink-0 border-t border-border/50 px-3 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <AnimatePresence initial={false}>
        {editing ? (
          <motion.div
            key="editando"
            initial={{ opacity: 0, height: reduceMotion ? "auto" : 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: reduceMotion ? "auto" : 0 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.16 }}
            className="overflow-hidden"
          >
            <div
              data-chat-composer-mode="editing"
              className="mb-2 flex items-start gap-2 rounded-xl border-l-[3px] border-muted-foreground/45 bg-muted/65 px-2.5 py-2"
            >
              <Pencil aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-foreground">Editando mensagem</p>
                <p className="truncate text-[11px] text-muted-foreground">{editing.message.content}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-my-1 size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Cancelar edição"
                onClick={onCancelEdit}
              >
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          </motion.div>
        ) : null}

        {reply && !editing ? (
          <motion.div
            key="respondendo"
            initial={{ opacity: 0, height: reduceMotion ? "auto" : 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: reduceMotion ? "auto" : 0 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.16 }}
            className="overflow-hidden"
          >
            <div
              data-chat-composer-mode="reply"
              className="mb-2 flex items-start gap-2 rounded-xl border-l-[3px] border-primary/65 bg-primary/[0.06] px-2.5 py-2"
            >
              <Reply aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-primary">
                  Respondendo a {reply.authorName}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {chatMessageSummaryText({
                    type: reply.message.type,
                    content: reply.message.content,
                    deleted: Boolean(reply.message.deletedForEveryoneAt),
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-my-1 size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Cancelar resposta"
                onClick={onCancelReply}
              >
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {editError ? (
        <p role="alert" className="mb-2 flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />
          {editError}
        </p>
      ) : null}

      {gravando ? (
        <ChatVoiceRecorder
          sending={voiceSending}
          onCancel={() => setGravando(false)}
          onSend={(blob, durationMs) => {
            onSendVoice(blob, durationMs);
          }}
        />
      ) : (
        <div className="chat-composer-surface rounded-2xl border border-border/70 p-1.5 shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_10%,transparent)]">
          <div className="flex min-w-0 items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <label htmlFor="chat-message" className="sr-only">
                {editing ? "Editar mensagem" : "Mensagem"}
              </label>
              <Textarea
                ref={textareaRef}
                id="chat-message"
                value={content}
                maxLength={CHAT_MESSAGE_MAX_LENGTH}
                rows={1}
                placeholder={editing ? "Edite a mensagem" : "Digite uma mensagem"}
                className="max-h-36 min-h-10 resize-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
                onChange={(event) => {
                  setContent(event.target.value);
                  requestAnimationFrame(resize);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && editing) {
                    event.preventDefault();
                    onCancelEdit();
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            </div>

            {!editing && gravacaoDisponivel && !content.trim() ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-10 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
                aria-label="Gravar mensagem de voz"
                onClick={() => setGravando(true)}
              >
                <Mic aria-hidden="true" className="size-4" />
              </Button>
            ) : null}

            <motion.div
              animate={{ opacity: sendHighlighted ? 1 : 0.55, scale: sendHighlighted && !reduceMotion ? 1 : reduceMotion ? 1 : 0.9 }}
              transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: "easeOut" }}
              className="shrink-0"
            >
              <Button
                type="button"
                size="icon"
                className="size-10 rounded-xl shadow-sm shadow-primary/15 transition-transform hover:scale-[1.03] active:scale-[0.94] motion-reduce:transform-none"
                disabled={!valid || ocupado}
                aria-label={editing ? "Salvar edição" : "Enviar mensagem"}
                onClick={submit}
              >
                <AnimatePresence initial={false} mode="wait">
                  <motion.span
                    key={ocupado ? "ocupado" : editing ? "salvar" : "enviar"}
                    initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.8 }}
                    transition={{ duration: reduceMotion ? 0.06 : 0.14 }}
                    className="inline-flex"
                  >
                    {ocupado ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : editing ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Send className="size-4" aria-hidden="true" />
                    )}
                  </motion.span>
                </AnimatePresence>
              </Button>
            </motion.div>
          </div>
        </div>
      )}

      {!gravando ? (
        <p className={cn("mt-1.5 pr-1 text-right text-[10px] tabular-nums text-muted-foreground/70 transition-colors", nearingLimit && "font-medium text-amber-700 dark:text-amber-300")}>
          {content.length}/{CHAT_MESSAGE_MAX_LENGTH}
        </p>
      ) : null}
    </div>
  );
}
