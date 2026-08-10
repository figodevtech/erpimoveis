"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export const EVENT_GROUPS = [
  { label: "Entrada", description: "Abertura e triagem inicial", events: [["CRIADA", "OS criada"], ["AGUARDANDO_CHECKLIST", "Aguardando checklist"]] },
  { label: "Orçamento", description: "Preparação e decisão do cliente", events: [["ORCAMENTO", "Em orçamento"], ["APROVACAO_ORCAMENTO", "Aguardando aprovação"], ["ORCAMENTO_APROVADO", "Orçamento aprovado"], ["ORCAMENTO_RECUSADO", "Orçamento recusado"]] },
  { label: "Execução", description: "Andamento dos serviços", events: [["EM_ANDAMENTO", "Em andamento"]] },
  { label: "Encerramento", description: "Pagamento, conclusão ou cancelamento", events: [["PAGAMENTO", "Aguardando pagamento"], ["SEM_COBRANCA", "Finalizada sem cobrança"], ["CONCLUIDO", "Concluída"], ["CANCELADO", "Cancelada"]] },
] as const;

const STATUS_EVENTS = EVENT_GROUPS.flatMap((group) => group.events.map(([id]) => id)).filter((id) => id !== "CRIADA");
export const ALL_EVENTS = ["CRIADA", ...STATUS_EVENTS];
export const FINAL_EVENTS = ["CRIADA", "SEM_COBRANCA", "CONCLUIDO"];

export type Mode = "CRIACAO" | "CRIACAO_FINALIZACAO" | "TODOS" | "PERSONALIZADO";
export type Scope = "TODAS" | "MINHAS" | "MEU_SETOR";
export type TelegramUser = { id: string; name: string; email: string; active: boolean };
export type TelegramRecipient = {
  usuarioId: string; user: TelegramUser | null; connected: boolean; telegramUsername: string;
  telegramName: string | null; active: boolean; mode: Mode; scope: Scope;
  notifyCreation: boolean; selectedStatuses: string[]; lastError: string | null;
};
export type RecipientFormData = {
  usuarioId: string; telegramUsername: string; active: boolean; scope: Scope; selectedEvents: string[];
};

export function recipientEvents(recipient: TelegramRecipient) {
  if (recipient.mode === "TODOS") return ALL_EVENTS;
  if (recipient.mode === "CRIACAO") return ["CRIADA"];
  if (recipient.mode === "CRIACAO_FINALIZACAO") return FINAL_EVENTS;
  return [...(recipient.notifyCreation ? ["CRIADA"] : []), ...recipient.selectedStatuses];
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipient: TelegramRecipient | null;
  users: TelegramUser[];
  saving: boolean;
  onSave: (data: RecipientFormData) => Promise<void>;
};

export function TelegramRecipientDialog({ open, onOpenChange, recipient, users, saving, onSave }: Props) {
  const [form, setForm] = useState<RecipientFormData>(() => recipient ? {
      usuarioId: recipient.usuarioId,
      telegramUsername: `@${recipient.telegramUsername}`,
      active: recipient.active,
      scope: recipient.scope,
      selectedEvents: recipientEvents(recipient),
    } : { usuarioId: "", telegramUsername: "", active: true, scope: "MINHAS", selectedEvents: FINAL_EVENTS });

  function setEvents(selectedEvents: readonly string[]) {
    setForm((current) => ({ ...current, selectedEvents: [...selectedEvents] }));
  }

  function toggleEvent(event: string, checked: boolean) {
    setForm((current) => ({ ...current, selectedEvents: checked
      ? Array.from(new Set([...current.selectedEvents, event]))
      : current.selectedEvents.filter((item) => item !== event) }));
  }

  function toggleGroup(events: readonly (readonly [string, string])[]) {
    const ids = events.map(([id]) => id);
    const allSelected = ids.every((id) => form.selectedEvents.includes(id));
    setForm((current) => ({ ...current, selectedEvents: allSelected
      ? current.selectedEvents.filter((id) => !ids.includes(id))
      : Array.from(new Set([...current.selectedEvents, ...ids])) }));
  }

  const valid = Boolean(form.usuarioId && form.telegramUsername.trim() && form.selectedEvents.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[820px] sm:w-[88vw] sm:min-w-0 sm:max-w-[920px]" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{recipient ? "Editar destinatário" : "Novo destinatário"}</DialogTitle>
            <DialogDescription>Defina o contato e marque as alterações de OS que devem gerar mensagens.</DialogDescription>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
                <div className="space-y-2"><Label>Usuário do ERP</Label><Select value={form.usuarioId} onValueChange={(usuarioId) => setForm((current) => ({ ...current, usuarioId }))} disabled={Boolean(recipient)}><SelectTrigger aria-label="Usuário do ERP"><SelectValue placeholder="Selecione um usuário" /></SelectTrigger><SelectContent>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}{!user.active ? " (inativo)" : ""}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor="dialog-telegram-username">Usuário do Telegram</Label><Input id="dialog-telegram-username" value={form.telegramUsername} onChange={(event) => setForm((current) => ({ ...current, telegramUsername: event.target.value }))} placeholder="@usuario_telegram" disabled={recipient?.connected} maxLength={33} autoComplete="off" spellCheck={false} /></div>
                <div className="space-y-2"><Label>Quais ordens devem gerar avisos</Label><Select value={form.scope} onValueChange={(scope: Scope) => setForm((current) => ({ ...current, scope }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MINHAS">Somente OS atribuídas ao usuário</SelectItem><SelectItem value="MEU_SETOR">Todas as OS do setor do usuário</SelectItem><SelectItem value="TODAS">Todas as OS da empresa</SelectItem></SelectContent></Select></div>
                <div className="flex items-end"><div className="flex h-10 w-full items-center justify-between rounded-md border px-3"><div><Label htmlFor="dialog-recipient-active">Receber avisos</Label><p className="text-xs text-muted-foreground">Pausa sem remover o vínculo.</p></div><Switch id="dialog-recipient-active" checked={form.active} onCheckedChange={(active) => setForm((current) => ({ ...current, active }))} /></div></div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3"><div><Label>Eventos que enviam notificação</Label><p className="text-xs text-muted-foreground">A seleção funciona como as permissões: individualmente, por grupo ou por atalho.</p></div><div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setEvents(FINAL_EVENTS)}>Criação e finalização</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEvents(ALL_EVENTS)}>Selecionar todas</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEvents([])}>Limpar</Button></div></div>
                <Separator />
                <div className="space-y-2">{EVENT_GROUPS.map((group) => {
                  const selectedCount = group.events.filter(([id]) => form.selectedEvents.includes(id)).length;
                  const checked = selectedCount === group.events.length ? true : selectedCount > 0 ? "indeterminate" : false;
                  return <div key={group.label} className="rounded-md border bg-background"><div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2"><Checkbox checked={checked} onCheckedChange={() => toggleGroup(group.events)} aria-label={`Selecionar etapa ${group.label}`} /><button type="button" className="flex flex-1 items-center justify-between gap-3 text-left" onClick={() => toggleGroup(group.events)}><span><span className="block text-sm font-medium">{group.label}</span><span className="block text-xs text-muted-foreground">{group.description}</span></span><span className="text-xs text-muted-foreground">{selectedCount}/{group.events.length}</span></button></div><div className="grid gap-1 p-2 sm:grid-cols-2">{group.events.map(([id, label]) => <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50"><Checkbox checked={form.selectedEvents.includes(id)} onCheckedChange={(value) => toggleEvent(id, value === true)} />{label}</label>)}</div></div>;
                })}</div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => onSave(form)} disabled={saving || !valid}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : "Salvar"}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
