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
            "rounded-[18px] px-3.5 py-2.5 text-[13px] leading-relaxed shadow-[0_1px_2px_rgb(15_23_42/0.06)]",
            own
              ? "rounded-br-md bg-gradient-to-br from-primary to-violet-700 text-primary-foreground dark:to-violet-600"
              : "rounded-bl-md border border-border/65 bg-card/90 text-card-foreground dark:bg-muted/70",
            message.sendStatus === "failed" && "border border-destructive/35 bg-destructive/[0.07] text-foreground dark:bg-destructive/10",
          )}
        >
          <p className="select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>
          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px] leading-none", own && message.sendStatus !== "failed" ? "text-primary-foreground/70" : "text-muted-foreground")}>
            <time>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
            {message.sendStatus === "sending" ? <Loader2 className="size-3 animate-spin" aria-label="Enviando" /> : null}
          </div>
        </div>

        {message.sendStatus === "failed" ? (
          <div role="alert" className="mt-1.5 flex flex-wrap items-center justify-end gap-1 text-[11px] text-destructive">
            <AlertCircle className="size-3" aria-hidden="true" />
            <span>{message.error || "Não foi possível enviar."}</span>
            {message.retryable !== false ? (
              <Button type="button" variant="link" size="sm" className="h-auto rounded-md px-1 py-0 text-[11px] font-semibold text-destructive" onClick={() => onRetry(message)}>
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
