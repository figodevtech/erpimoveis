"use client";

import { useState } from "react";
import { Clock3, Loader2, WalletCards } from "lucide-react";
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
export type TelegramUser = { id: string; name: string; email: string; active: boolean; financialAccess: boolean };
export type TelegramRecipient = {
  usuarioId: string; user: TelegramUser | null; connected: boolean; telegramUsername: string;
  telegramName: string | null; active: boolean; mode: Mode; scope: Scope;
  notifyCreation: boolean; selectedStatuses: string[]; lastError: string | null;
  notifyFinancialDaily: boolean; financialSummaryTime: string;
  financialIncludeOverdue: boolean; financialSendWhenEmpty: boolean;
};
export type RecipientFormData = {
  usuarioId: string; telegramUsername: string; active: boolean; scope: Scope; selectedEvents: string[];
  notifyFinancialDaily: boolean; financialSummaryTime: string;
  financialIncludeOverdue: boolean; financialSendWhenEmpty: boolean;
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
      notifyFinancialDaily: recipient.notifyFinancialDaily,
      financialSummaryTime: recipient.financialSummaryTime,
      financialIncludeOverdue: recipient.financialIncludeOverdue,
      financialSendWhenEmpty: recipient.financialSendWhenEmpty,
    } : {
      usuarioId: "", telegramUsername: "", active: true, scope: "MINHAS", selectedEvents: FINAL_EVENTS,
      notifyFinancialDaily: false, financialSummaryTime: "08:00", financialIncludeOverdue: true, financialSendWhenEmpty: false,
    });

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

  const selectedUser = users.find((user) => user.id === form.usuarioId) ?? recipient?.user ?? null;
  const financialAllowed = selectedUser?.financialAccess === true;
  const valid = Boolean(
    form.usuarioId
    && form.telegramUsername.trim()
    && (form.selectedEvents.length || form.notifyFinancialDaily)
    && (!form.notifyFinancialDaily || financialAllowed),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[820px] sm:w-[88vw] sm:min-w-0 sm:max-w-[920px]" onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{recipient ? "Editar destinatário" : "Novo destinatário"}</DialogTitle>
            <DialogDescription>Defina o contato e escolha os avisos de OS e financeiros enviados pelo Telegram.</DialogDescription>
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
                  return <div key={group.label} className="rounded-md border bg-card"><div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2"><Checkbox checked={checked} onCheckedChange={() => toggleGroup(group.events)} aria-label={`Selecionar etapa ${group.label}`} /><button type="button" className="flex flex-1 items-center justify-between gap-3 text-left" onClick={() => toggleGroup(group.events)}><span><span className="block text-sm font-medium">{group.label}</span><span className="block text-xs text-muted-foreground">{group.description}</span></span><span className="text-xs text-muted-foreground">{selectedCount}/{group.events.length}</span></button></div><div className="grid gap-1 p-2 sm:grid-cols-2">{group.events.map(([id, label]) => <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50"><Checkbox checked={form.selectedEvents.includes(id)} onCheckedChange={(value) => toggleEvent(id, value === true)} />{label}</label>)}</div></div>;
                })}</div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><WalletCards className="size-4" /></span>
                    <div><Label htmlFor="dialog-financial-daily">Resumo diário de contas a pagar</Label><p className="text-xs text-muted-foreground">Despesas atrasadas e com vencimento no dia, agrupadas com os totais.</p></div>
                  </div>
                  <Switch id="dialog-financial-daily" checked={form.notifyFinancialDaily} disabled={!financialAllowed} onCheckedChange={(notifyFinancialDaily) => setForm((current) => ({ ...current, notifyFinancialDaily }))} />
                </div>
                {!form.usuarioId ? <p className="text-xs text-muted-foreground">Selecione o usuário para verificar o acesso financeiro.</p> : !financialAllowed ? <p className="text-xs text-amber-700 dark:text-amber-400">Este usuário não possui a permissão Financeiro: visualizar.</p> : null}
                {form.notifyFinancialDaily ? <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="dialog-financial-time" className="flex items-center gap-1.5"><Clock3 className="size-3.5" />Horário do envio</Label><Input id="dialog-financial-time" type="time" value={form.financialSummaryTime} onChange={(event) => setForm((current) => ({ ...current, financialSummaryTime: event.target.value }))} /></div>
                  <div className="space-y-3 md:pt-7">
                    <label className="flex cursor-pointer items-center gap-3 text-sm"><Checkbox checked={form.financialIncludeOverdue} onCheckedChange={(checked) => setForm((current) => ({ ...current, financialIncludeOverdue: checked === true }))} />Incluir contas atrasadas</label>
                    <label className="flex cursor-pointer items-center gap-3 text-sm"><Checkbox checked={form.financialSendWhenEmpty} onCheckedChange={(checked) => setForm((current) => ({ ...current, financialSendWhenEmpty: checked === true }))} />Avisar mesmo quando não houver contas</label>
                  </div>
                </div> : null}
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
