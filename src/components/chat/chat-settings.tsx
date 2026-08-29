"use client";

import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChatPushSettings } from "./chat-push-settings";
import { useChat } from "./chat-provider";

/**
 * Painel de configurações do chat. Nesta fase ele reúne apenas as
 * notificações; a estrutura em seções existe para receber novos ajustes sem
 * voltar a espalhar controles pelo cabeçalho da inbox.
 */
export function ChatSettings() {
  const { showInbox } = useChat();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chat-header-surface shrink-0 border-b border-border/60 px-4 pb-3 pr-12">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-xl transition-transform active:scale-90 motion-reduce:transform-none"
            aria-label="Voltar para conversas"
            onClick={showInbox}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div>
            <h2 className="font-semibold tracking-tight">Configurações</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Preferências do chat neste dispositivo</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <section aria-labelledby="chat-settings-notificacoes">
          <h3
            id="chat-settings-notificacoes"
            className="px-4 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75"
          >
            Notificações
          </h3>
          <ChatPushSettings />
        </section>
      </div>
    </div>
  );
}
