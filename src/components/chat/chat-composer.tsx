"use client";

import * as React from "react";
import { Loader2, Send } from "lucide-react";

import { CHAT_MESSAGE_MAX_LENGTH } from "@/lib/chat/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatComposer({
  onSend,
  sending,
}: {
  onSend: (content: string) => void;
  sending: boolean;
}) {
  const [content, setContent] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const valid = content.trim().length > 0 && content.trim().length <= CHAT_MESSAGE_MAX_LENGTH;

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
      className="shrink-0 border-t bg-background px-3 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="chat-message" className="sr-only">Mensagem</label>
          <Textarea
            ref={textareaRef}
            id="chat-message"
            value={content}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            rows={1}
            placeholder="Digite uma mensagem"
            className="max-h-36 min-h-10 resize-none py-2"
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
          <p className="mt-1 text-right text-[10px] text-muted-foreground">
            {content.length}/{CHAT_MESSAGE_MAX_LENGTH}
          </p>
        </div>
        <Button type="button" size="icon" className="size-10" disabled={!valid} aria-label="Enviar mensagem" onClick={submit}>
          {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

