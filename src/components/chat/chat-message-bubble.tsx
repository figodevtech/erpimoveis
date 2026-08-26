"use client";

import * as React from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import type { ChatMessage } from "@/lib/chat/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ChatMessageBubble({
  message,
  own,
  onRetry,
}: {
  message: ChatMessage;
  own: boolean;
  onRetry: (message: ChatMessage) => void;
}) {
  return (
    <div className={cn("flex w-full", own ? "justify-end" : "justify-start")} data-message-id={message.id}>
      <div className={cn("max-w-[82%]", own ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm shadow-sm",
            own
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md border bg-card text-card-foreground",
            message.sendStatus === "failed" && "border border-destructive/50 bg-destructive/5 text-foreground",
          )}
        >
          <p className="select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", own ? "text-primary-foreground/75" : "text-muted-foreground")}>
            <time>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
            {message.sendStatus === "sending" ? <Loader2 className="size-3 animate-spin" aria-label="Enviando" /> : null}
          </div>
        </div>

        {message.sendStatus === "failed" ? (
          <div role="alert" className="mt-1 flex flex-wrap items-center justify-end gap-1 text-xs text-destructive">
            <AlertCircle className="size-3" aria-hidden="true" />
            <span>{message.error || "Não foi possível enviar."}</span>
            {message.retryable !== false ? (
              <Button type="button" variant="link" size="sm" className="h-auto px-1 py-0 text-xs text-destructive" onClick={() => onRetry(message)}>
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
