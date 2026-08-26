"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2, Send } from "lucide-react";

import { CHAT_MESSAGE_MAX_LENGTH } from "@/lib/chat/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function ChatComposer({
  onSend,
  sending,
}: {
  onSend: (content: string) => void;
  sending: boolean;
}) {
  const [content, setContent] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const reduceMotion = useReducedMotion();
  const valid = content.trim().length > 0 && content.trim().length <= CHAT_MESSAGE_MAX_LENGTH;
  const sendHighlighted = valid || sending;
  const nearingLimit = content.length >= Math.floor(CHAT_MESSAGE_MAX_LENGTH * 0.9);

  const resize = () => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  };

  const submit = () => {
    if (!valid) return;
    onSend(content.trim());
    setContent("");
    requestAnimationFrame(resize);
  };

  return (
    <div
      className="chat-composer-dock shrink-0 border-t border-border/50 px-3 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="chat-composer-surface rounded-2xl border border-border/70 p-1.5 shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_10%,transparent)]">
        <div className="flex min-w-0 items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <label htmlFor="chat-message" className="sr-only">Mensagem</label>
            <Textarea
              ref={textareaRef}
              id="chat-message"
              value={content}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              rows={1}
              placeholder="Digite uma mensagem"
              className="max-h-36 min-h-10 resize-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
              onChange={(event) => {
                setContent(event.target.value);
                requestAnimationFrame(resize);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <motion.div
            animate={{ opacity: sendHighlighted ? 1 : 0.55, scale: sendHighlighted && !reduceMotion ? 1 : reduceMotion ? 1 : 0.9 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: "easeOut" }}
            className="shrink-0"
          >
            <Button type="button" size="icon" className="size-10 rounded-xl shadow-sm shadow-primary/15 transition-transform hover:scale-[1.03] active:scale-[0.94] motion-reduce:transform-none" disabled={!valid} aria-label="Enviar mensagem" onClick={submit}>
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  key={sending ? "sending" : "send"}
                  initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.8 }}
                  transition={{ duration: reduceMotion ? 0.06 : 0.14 }}
                  className="inline-flex"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                </motion.span>
              </AnimatePresence>
            </Button>
          </motion.div>
        </div>
      </div>
      <p className={cn("mt-1.5 pr-1 text-right text-[10px] tabular-nums text-muted-foreground/70 transition-colors", nearingLimit && "font-medium text-amber-700 dark:text-amber-300")}>
        {content.length}/{CHAT_MESSAGE_MAX_LENGTH}
      </p>
    </div>
  );
}
