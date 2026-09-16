"use client";

import { Loader2, MessageCircle, RefreshCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

export type MarketplaceConversation = {
  id: string;
  name: string;
  preview: string;
  unreadCount?: number;
};

export type MarketplaceConversationMessage = {
  id: string;
  text: string;
  fromBuyer: boolean;
  type?: string;
  date?: string | number | null;
};

export function MarketplaceConversationPanel({
  channelName,
  conversations,
  selectedId,
  selectedName,
  messages,
  loading,
  error,
  messageText,
  onMessageTextChange,
  onRefresh,
  onSelect,
  onSend,
  onLoadMore,
  loadingMore = false,
}: {
  channelName: string;
  conversations: MarketplaceConversation[];
  selectedId: string | null;
  selectedName?: string | null;
  messages: MarketplaceConversationMessage[];
  loading: boolean;
  error?: string | null;
  messageText: string;
  onMessageTextChange: (value: string) => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  onSend: () => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(130px,36%)_minmax(0,1fr)] overflow-hidden sm:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-r bg-muted/20">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Conversas</span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onRefresh} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}</Button>
        </div>
        {error ? <div className="m-4 rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/20 dark:text-orange-100">{error}</div> : null}
        <ScrollArea className="h-[calc(100vh-121px)]"><div className="space-y-1 p-2">{conversations.map((conversation) => (
          <button key={conversation.id} type="button" onClick={() => onSelect(conversation.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${selectedId === conversation.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{conversation.name}</span>{conversation.unreadCount ? <Badge className={selectedId === conversation.id ? "bg-background text-foreground" : ""}>{conversation.unreadCount}</Badge> : null}</div>
            <div className="mt-1 truncate text-xs opacity-75">{conversation.preview || "Abra para visualizar"}</div>
          </button>
        ))}{!loading && !error && !conversations.length ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">Nenhuma conversa encontrada.</div> : null}
        {onLoadMore ? <Button type="button" variant="outline" size="sm" className="h-auto w-full whitespace-normal" disabled={loading || loadingMore} onClick={onLoadMore}>{loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{loadingMore ? "Carregando..." : "Carregar mais conversas"}</Button> : null}
        </div></ScrollArea>
      </aside>
      <section className="flex min-h-0 flex-col">
        <div className="border-b px-4 py-3"><div className="truncate text-sm font-semibold">{selectedId ? selectedName || `Comprador ${channelName}` : "Selecione uma conversa"}</div><div className="truncate text-xs text-muted-foreground">{selectedId ? `Atendimento pelo ${channelName}` : "As mensagens dos compradores aparecem aqui."}</div></div>
        <ScrollArea className="h-[calc(100vh-185px)]"><div className="flex min-h-full flex-col justify-end space-y-3 p-4">
          {error && selectedId ? <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm">{error}</div> : null}
          {messages.map((message) => <div key={message.id} className={`flex ${message.fromBuyer ? "justify-start" : "justify-end"}`}><div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${message.fromBuyer ? "bg-muted" : "bg-primary text-primary-foreground"}`}><div>{message.text || `[${message.type || "mensagem"}]`}</div>{message.date ? <div className="mt-1 text-right text-[11px] opacity-70">{formatMessageDate(message.date)}</div> : null}</div></div>)}
          {selectedId && !messages.length && !loading ? <PanelEmpty title="Sem mensagens carregadas" description="Esta conversa ainda não possui histórico disponível." /> : null}
        </div></ScrollArea>
        <div className="border-t bg-background p-3"><div className="flex items-end gap-2"><Textarea placeholder={`Digite uma mensagem para o comprador`} className="max-h-28 min-h-11 flex-1 resize-none py-2" value={messageText} onChange={(event) => onMessageTextChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} disabled={!selectedId || loading} /><Button className="h-11 w-11 shrink-0 p-0" onClick={onSend} disabled={!selectedId || !messageText.trim() || loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div></div>
      </section>
    </div>
  );
}

function formatMessageDate(value: string | number) {
  const numeric = typeof value === "number" ? (value < 10_000_000_000 ? value * 1000 : value) : value;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function PanelEmpty({ title, description }: { title: string; description: string }) {
  return <div className="flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center text-muted-foreground"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted"><MessageCircle className="h-6 w-6" /></span><p className="text-sm font-medium text-foreground">{title}</p><p className="mt-1 max-w-sm text-xs">{description}</p></div>;
}
