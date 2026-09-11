"use client";

import { useState } from "react";
import { Boxes, Clock3, HandCoins, Loader2, ReceiptText, ShoppingBag, WalletCards, Wrench, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FINANCEIRO_NOTIFICATION_EVENT_GROUPS,
  FINANCEIRO_NOTIFICATION_EVENT_VALUES,
  FINANCEIRO_ORIGEM_OPTIONS,
  type FinanceiroNotificationEvent,
  type FinanceiroOrigem,
} from "@/lib/financeiro/telegram-financeiro-events";
import {
  STOCK_NOTIFICATION_EVENT_GROUPS,
  STOCK_NOTIFICATION_EVENT_VALUES,
  type StockNotificationEvent,
} from "@/lib/estoque/telegram-stock-events";
import {
  MERCADOLIVRE_NOTIFICATION_EVENT_GROUPS,
  MERCADOLIVRE_NOTIFICATION_EVENT_VALUES,
  type MercadoLivreNotificationEvent,
} from "@/lib/integrations/mercadolivre-notification-events";
import {
  FISCAL_NOTIFICATION_EVENT_GROUPS,
  FISCAL_NOTIFICATION_EVENT_VALUES,
  type FiscalNotificationEvent,
} from "@/lib/fiscal/telegram-fiscal-events";

export const EVENT_GROUPS = [
  { label: "Entrada", description: "Abertura e triagem inicial", events: [["CRIADA", "OS criada"], ["AGUARDANDO_CHECKLIST", "Aguardando checklist"]] },
  { label: "Orçamento", description: "Preparação e decisão do cliente", events: [["ORCAMENTO", "Em orçamento"], ["APROVACAO_ORCAMENTO", "Aguardando aprovação"], ["ORCAMENTO_APROVADO", "Orçamento aprovado"], ["ORCAMENTO_RECUSADO", "Orçamento recusado"]] },
  { label: "Execução", description: "Andamento dos serviços", events: [["EM_ANDAMENTO", "Em andamento"]] },
  { label: "Encerramento", description: "Pagamento, conclusão ou cancelamento", events: [["PAGAMENTO", "Aguardando pagamento"], ["FATURAMENTO", "Enviada para faturamento"], ["SEM_COBRANCA", "Finalizada sem cobrança"], ["CONCLUIDO", "Concluída"], ["CANCELADO", "Cancelada"]] },
] as const;

const STATUS_EVENTS = EVENT_GROUPS.flatMap((group) => group.events.map(([id]) => id)).filter((id) => id !== "CRIADA");
export const ALL_EVENTS = ["CRIADA", ...STATUS_EVENTS];
export const FINAL_EVENTS = ["CRIADA", "SEM_COBRANCA", "CONCLUIDO"];
const STOCK_REGISTRATION_EVENTS = STOCK_NOTIFICATION_EVENT_VALUES.filter((event) => event.endsWith("_REGISTRO"));
/** Atalho para quem só quer ser chamado quando a nota não passou. */
const FISCAL_PROBLEM_EVENTS: readonly FiscalNotificationEvent[] = [
  "NFE_REJEITADA",
  "NFE_DENEGADA",
  "NFE_RESULTADO_INCERTO",
  "NFSE_REJEITADA",
];

export type Mode = "CRIACAO" | "CRIACAO_FINALIZACAO" | "TODOS" | "PERSONALIZADO";
export type Scope = "TODAS" | "MINHAS" | "MEU_SETOR";
export type TelegramUser = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  financialAccess: boolean;
  stockAccess: boolean;
  fiscalAccess: boolean;
  marketplaceAccess: boolean;
};
export type TelegramBank = {
  id: number;
  titulo: string;
};
export type TelegramRecipient = {
  usuarioId: string;
  user: TelegramUser | null;
  connected: boolean;
  telegramUsername: string;
  telegramName: string | null;
  active: boolean;
  mode: Mode;
  scope: Scope;
  notifyCreation: boolean;
  selectedStatuses: string[];
  lastError: string | null;
  notifyFinancialDaily: boolean;
  financialSummaryTime: string;
  financialIncludeOverdue: boolean;
  financialSendWhenEmpty: boolean;
  notifyReceivableDaily: boolean;
  receivableSummaryTime: string;
  receivableIncludeOverdue: boolean;
  receivableSendWhenEmpty: boolean;
  selectedStockEvents: StockNotificationEvent[];
  selectedFiscalEvents: FiscalNotificationEvent[];
  notifyMarketplace: boolean;
  selectedMarketplaceEvents: MercadoLivreNotificationEvent[];
  selectedFinanceiroEvents: FinanceiroNotificationEvent[];
  /** Zero é sem piso. */
  financeiroMinimumValue: number;
  /** Vazio é todas as origens. */
  selectedFinanceiroOrigins: FinanceiroOrigem[];
  /** Vazio é todas as contas. */
  selectedFinanceiroBanks: number[];
};
export type RecipientFormData = {
  usuarioId: string;
  telegramUsername: string;
  active: boolean;
  scope: Scope;
  selectedEvents: string[];
  notifyFinancialDaily: boolean;
  financialSummaryTime: string;
  financialIncludeOverdue: boolean;
  financialSendWhenEmpty: boolean;
  notifyReceivableDaily: boolean;
  receivableSummaryTime: string;
  receivableIncludeOverdue: boolean;
  receivableSendWhenEmpty: boolean;
  selectedStockEvents: StockNotificationEvent[];
  selectedFiscalEvents: FiscalNotificationEvent[];
  notifyMarketplace: boolean;
  selectedMarketplaceEvents: MercadoLivreNotificationEvent[];
  selectedFinanceiroEvents: FinanceiroNotificationEvent[];
  /** Zero é sem piso. */
  financeiroMinimumValue: number;
  /** Vazio é todas as origens. */
  selectedFinanceiroOrigins: FinanceiroOrigem[];
  /** Vazio é todas as contas. */
  selectedFinanceiroBanks: number[];
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
  banks: TelegramBank[];
  saving: boolean;
  onSave: (data: RecipientFormData) => Promise<void>;
};

export function TelegramRecipientDialog({ open, onOpenChange, recipient, users, banks, saving, onSave }: Props) {
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
    notifyReceivableDaily: recipient.notifyReceivableDaily,
    receivableSummaryTime: recipient.receivableSummaryTime,
    receivableIncludeOverdue: recipient.receivableIncludeOverdue,
    receivableSendWhenEmpty: recipient.receivableSendWhenEmpty,
    selectedStockEvents: recipient.selectedStockEvents,
    selectedFiscalEvents: recipient.selectedFiscalEvents,
    notifyMarketplace: recipient.notifyMarketplace,
    selectedMarketplaceEvents: recipient.selectedMarketplaceEvents,
    selectedFinanceiroEvents: recipient.selectedFinanceiroEvents,
    financeiroMinimumValue: recipient.financeiroMinimumValue,
    selectedFinanceiroOrigins: recipient.selectedFinanceiroOrigins,
    selectedFinanceiroBanks: recipient.selectedFinanceiroBanks,
  } : {
    usuarioId: "",
    telegramUsername: "",
    active: true,
    scope: "MINHAS",
    selectedEvents: FINAL_EVENTS,
    notifyFinancialDaily: false,
    financialSummaryTime: "08:00",
    financialIncludeOverdue: true,
    financialSendWhenEmpty: false,
    notifyReceivableDaily: false,
    receivableSummaryTime: "08:00",
    receivableIncludeOverdue: true,
    receivableSendWhenEmpty: false,
    selectedStockEvents: [],
    selectedFiscalEvents: [],
    notifyMarketplace: false,
    selectedMarketplaceEvents: [...MERCADOLIVRE_NOTIFICATION_EVENT_VALUES],
    selectedFinanceiroEvents: [],
    financeiroMinimumValue: 0,
    selectedFinanceiroOrigins: [],
    selectedFinanceiroBanks: [],
  });

  function setEvents(selectedEvents: readonly string[]) {
    setForm((current) => ({ ...current, selectedEvents: [...selectedEvents] }));
  }

  function toggleEvent(event: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      selectedEvents: checked
        ? Array.from(new Set([...current.selectedEvents, event]))
        : current.selectedEvents.filter((item) => item !== event),
    }));
  }

  function toggleGroup(events: readonly (readonly [string, string])[]) {
    const ids = events.map(([id]) => id);
    const allSelected = ids.every((id) => form.selectedEvents.includes(id));
    setForm((current) => ({
      ...current,
      selectedEvents: allSelected
        ? current.selectedEvents.filter((id) => !ids.includes(id))
        : Array.from(new Set([...current.selectedEvents, ...ids])),
    }));
  }

  function setStockEvents(selectedStockEvents: readonly StockNotificationEvent[]) {
    setForm((current) => ({ ...current, selectedStockEvents: [...selectedStockEvents] }));
  }

  function toggleStockEvent(event: StockNotificationEvent, checked: boolean) {
    setForm((current) => ({
      ...current,
      selectedStockEvents: checked
        ? Array.from(new Set([...current.selectedStockEvents, event]))
        : current.selectedStockEvents.filter((item) => item !== event),
    }));
  }

  function toggleStockGroup(events: readonly (readonly [StockNotificationEvent, string])[]) {
    const ids = events.map(([id]) => id);
    const allSelected = ids.every((id) => form.selectedStockEvents.includes(id));
    setForm((current) => ({
      ...current,
      selectedStockEvents: allSelected
        ? current.selectedStockEvents.filter((id) => !ids.includes(id))
        : Array.from(new Set([...current.selectedStockEvents, ...ids])),
    }));
  }

  function setMarketplaceEvents(selectedMarketplaceEvents: readonly MercadoLivreNotificationEvent[]) {
    setForm((current) => ({ ...current, selectedMarketplaceEvents: [...selectedMarketplaceEvents] }));
  }

  function toggleMarketplaceEvent(event: MercadoLivreNotificationEvent, checked: boolean) {
    setForm((current) => ({
      ...current,
      selectedMarketplaceEvents: checked
        ? Array.from(new Set([...current.selectedMarketplaceEvents, event]))
        : current.selectedMarketplaceEvents.filter((item) => item !== event),
    }));
  }

  function toggleMarketplaceGroup(events: readonly (readonly [MercadoLivreNotificationEvent, string])[]) {
    const ids = events.map(([id]) => id);
    const allSelected = ids.every((id) => form.selectedMarketplaceEvents.includes(id));
    setForm((current) => ({
      ...current,
      selectedMarketplaceEvents: allSelected
        ? current.selectedMarketplaceEvents.filter((id) => !ids.includes(id))
        : Array.from(new Set([...current.selectedMarketplaceEvents, ...ids])),
    }));
  }

  function setFinanceiroEvents(selectedFinanceiroEvents: readonly FinanceiroNotificationEvent[]) {
    setForm((current) => ({ ...current, selectedFinanceiroEvents: [...selectedFinanceiroEvents] }));
  }

  function toggleFinanceiroEvent(event: FinanceiroNotificationEvent, checked: boolean) {
    setForm((current) => ({
      ...current,
      selectedFinanceiroEvents: checked
        ? Array.from(new Set([...current.selectedFinanceiroEvents, event]))
        : current.selectedFinanceiroEvents.filter((item) => item !== event),
    }));
  }

  function toggleFinanceiroGroup(events: readonly (readonly [FinanceiroNotificationEvent, string])[]) {
    const ids = events.map(([id]) => id);
    const allSelected = ids.every((id) => form.selectedFinanceiroEvents.includes(id));
    setForm((current) => ({
      ...current,
      selectedFinanceiroEvents: allSelected
        ? current.selectedFinanceiroEvents.filter((id) => !ids.includes(id))
        : Array.from(new Set([...current.selectedFinanceiroEvents, ...ids])),
    }));
  }

  function toggleFinanceiroOrigin(origem: FinanceiroOrigem, checked: boolean) {
    setForm((current) => ({
      ...current,
      selectedFinanceiroOrigins: checked
        ? Array.from(new Set([...current.selectedFinanceiroOrigins, origem]))
        : current.selectedFinanceiroOrigins.filter((item) => item !== origem),
    }));
  }

  function toggleFinanceiroBank(bankId: number, checked: boolean) {
    setForm((current) => ({
      ...current,
      selectedFinanceiroBanks: checked
        ? Array.from(new Set([...current.selectedFinanceiroBanks, bankId]))
        : current.selectedFinanceiroBanks.filter((item) => item !== bankId),
    }));
  }

  function setFiscalEvents(selectedFiscalEvents: readonly FiscalNotificationEvent[]) {
    setForm((current) => ({ ...current, selectedFiscalEvents: [...selectedFiscalEvents] }));
  }

  function toggleFiscalEvent(event: FiscalNotificationEvent, checked: boolean) {
    setForm((current) => ({
      ...current,
      selectedFiscalEvents: checked
        ? Array.from(new Set([...current.selectedFiscalEvents, event]))
        : current.selectedFiscalEvents.filter((item) => item !== event),
    }));
  }

  function toggleFiscalGroup(events: readonly (readonly [FiscalNotificationEvent, string])[]) {
    const ids = events.map(([id]) => id);
    const allSelected = ids.every((id) => form.selectedFiscalEvents.includes(id));
    setForm((current) => ({
      ...current,
      selectedFiscalEvents: allSelected
        ? current.selectedFiscalEvents.filter((id) => !ids.includes(id))
        : Array.from(new Set([...current.selectedFiscalEvents, ...ids])),
    }));
  }

  const selectedUser = users.find((user) => user.id === form.usuarioId) ?? recipient?.user ?? null;
  const financialAllowed = selectedUser?.financialAccess === true;
  const stockAllowed = selectedUser?.stockAccess === true;
  const fiscalAllowed = selectedUser?.fiscalAccess === true;
  const marketplaceAllowed = selectedUser?.marketplaceAccess === true;
  const hasNotification = Boolean(
    form.selectedEvents.length
    || form.notifyFinancialDaily
    || form.notifyReceivableDaily
    || form.selectedStockEvents.length
    || form.selectedFiscalEvents.length
    || form.notifyMarketplace
    || form.selectedFinanceiroEvents.length,
  );
  const valid = Boolean(
    form.usuarioId
    && form.telegramUsername.trim()
    && hasNotification
    && (!form.notifyFinancialDaily || financialAllowed)
    && (!form.notifyReceivableDaily || financialAllowed)
    && (!form.selectedStockEvents.length || stockAllowed)
    && (!form.selectedFiscalEvents.length || fiscalAllowed)
    && (!form.notifyMarketplace || marketplaceAllowed)
    && (!form.selectedFinanceiroEvents.length || financialAllowed),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[820px] sm:w-[88vw] sm:min-w-0 sm:max-w-[920px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{recipient ? "Editar destinatário" : "Novo destinatário"}</DialogTitle>
            <DialogDescription>Defina o contato e escolha, por módulo, os avisos enviados pelo Telegram.</DialogDescription>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Usuário do ERP</Label>
                  <Select
                    value={form.usuarioId}
                    onValueChange={(usuarioId) => setForm((current) => ({ ...current, usuarioId }))}
                    disabled={Boolean(recipient)}
                  >
                    <SelectTrigger aria-label="Usuário do ERP"><SelectValue placeholder="Selecione um usuário" /></SelectTrigger>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name || user.email}{!user.active ? " (inativo)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dialog-telegram-username">Usuário do Telegram</Label>
                  <Input
                    id="dialog-telegram-username"
                    value={form.telegramUsername}
                    onChange={(event) => setForm((current) => ({ ...current, telegramUsername: event.target.value }))}
                    placeholder="@usuario_telegram"
                    disabled={recipient?.connected}
                    maxLength={33}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="flex items-end md:col-span-2">
                  <div className="flex h-12 w-full items-center justify-between rounded-md border px-3">
                    <div>
                      <Label htmlFor="dialog-recipient-active">Receber avisos</Label>
                      <p className="text-xs text-muted-foreground">Pausa todos os módulos sem remover o vínculo.</p>
                    </div>
                    <Switch
                      id="dialog-recipient-active"
                      checked={form.active}
                      onCheckedChange={(active) => setForm((current) => ({ ...current, active }))}
                    />
                  </div>
                </div>
              </div>

              <Tabs defaultValue="os" className="gap-4">
                <TabsList className="grid h-auto w-full grid-cols-2 sm:h-11 sm:grid-cols-5">
                  <TabsTrigger value="os"><Wrench />OS</TabsTrigger>
                  <TabsTrigger value="financeiro"><WalletCards />Financeiro</TabsTrigger>
                  <TabsTrigger value="estoque"><Boxes />Estoque</TabsTrigger>
                  <TabsTrigger value="fiscal"><ReceiptText />Fiscal</TabsTrigger>
                  <TabsTrigger value="marketplace"><ShoppingBag />Marketplace</TabsTrigger>
                </TabsList>

                <TabsContent value="os" className="space-y-4">
                  <div className="space-y-2 rounded-lg border bg-card p-4">
                    <Label>Quais ordens devem gerar avisos</Label>
                    <Select value={form.scope} onValueChange={(scope: Scope) => setForm((current) => ({ ...current, scope }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MINHAS">Somente OS atribuídas ao usuário</SelectItem>
                        <SelectItem value="MEU_SETOR">Todas as OS do setor do usuário</SelectItem>
                        <SelectItem value="TODAS">Todas as OS da empresa</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Este escopo vale somente para notificações de ordens de serviço.</p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <Label>Eventos que enviam notificação</Label>
                        <p className="text-xs text-muted-foreground">Selecione individualmente, por etapa ou usando os atalhos.</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEvents(FINAL_EVENTS)}>Criação e finalização</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEvents(ALL_EVENTS)}>Selecionar todas</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEvents([])}>Limpar</Button>
                      </div>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      {EVENT_GROUPS.map((group) => {
                        const selectedCount = group.events.filter(([id]) => form.selectedEvents.includes(id)).length;
                        const checked = selectedCount === group.events.length ? true : selectedCount > 0 ? "indeterminate" : false;
                        return (
                          <div key={group.label} className="rounded-md border bg-card">
                            <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
                              <Checkbox checked={checked} onCheckedChange={() => toggleGroup(group.events)} aria-label={`Selecionar etapa ${group.label}`} />
                              <button type="button" className="flex flex-1 items-center justify-between gap-3 text-left" onClick={() => toggleGroup(group.events)}>
                                <span>
                                  <span className="block text-sm font-medium">{group.label}</span>
                                  <span className="block text-xs text-muted-foreground">{group.description}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">{selectedCount}/{group.events.length}</span>
                              </button>
                            </div>
                            <div className="grid gap-1 p-2 sm:grid-cols-2">
                              {group.events.map(([id, label]) => (
                                <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                                  <Checkbox checked={form.selectedEvents.includes(id)} onCheckedChange={(value) => toggleEvent(id, value === true)} />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="financeiro" className="space-y-4">
                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><WalletCards className="size-4" /></span>
                        <div>
                          <Label htmlFor="dialog-financial-daily">Resumo diário de contas a pagar</Label>
                          <p className="text-xs text-muted-foreground">Despesas atrasadas e com vencimento no dia, agrupadas com os totais.</p>
                        </div>
                      </div>
                      <Switch
                        id="dialog-financial-daily"
                        checked={form.notifyFinancialDaily}
                        disabled={!financialAllowed}
                        onCheckedChange={(notifyFinancialDaily) => setForm((current) => ({ ...current, notifyFinancialDaily }))}
                      />
                    </div>
                    {!form.usuarioId ? (
                      <p className="text-xs text-muted-foreground">Selecione o usuário para verificar o acesso financeiro.</p>
                    ) : !financialAllowed ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">Este usuário não possui a permissão Financeiro: visualizar.</p>
                    ) : null}
                    {form.notifyFinancialDaily ? (
                      <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="dialog-financial-time" className="flex items-center gap-1.5"><Clock3 className="size-3.5" />Horário do envio</Label>
                          <Input
                            id="dialog-financial-time"
                            type="time"
                            value={form.financialSummaryTime}
                            onChange={(event) => setForm((current) => ({ ...current, financialSummaryTime: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-3 md:pt-7">
                          <label className="flex cursor-pointer items-center gap-3 text-sm">
                            <Checkbox checked={form.financialIncludeOverdue} onCheckedChange={(checked) => setForm((current) => ({ ...current, financialIncludeOverdue: checked === true }))} />
                            Incluir contas atrasadas
                          </label>
                          <label className="flex cursor-pointer items-center gap-3 text-sm">
                            <Checkbox checked={form.financialSendWhenEmpty} onCheckedChange={(checked) => setForm((current) => ({ ...current, financialSendWhenEmpty: checked === true }))} />
                            Avisar mesmo quando não houver contas
                          </label>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><HandCoins className="size-4" /></span>
                        <div>
                          <Label htmlFor="dialog-receivable-daily">Resumo diário de contas a receber</Label>
                          <p className="text-xs text-muted-foreground">Títulos vencidos em aberto e com vencimento no dia, agrupados com os totais.</p>
                        </div>
                      </div>
                      <Switch
                        id="dialog-receivable-daily"
                        checked={form.notifyReceivableDaily}
                        disabled={!financialAllowed}
                        onCheckedChange={(notifyReceivableDaily) => setForm((current) => ({ ...current, notifyReceivableDaily }))}
                      />
                    </div>
                    {form.notifyReceivableDaily ? (
                      <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="dialog-receivable-time" className="flex items-center gap-1.5"><Clock3 className="size-3.5" />Horário do envio</Label>
                          <Input
                            id="dialog-receivable-time"
                            type="time"
                            value={form.receivableSummaryTime}
                            onChange={(event) => setForm((current) => ({ ...current, receivableSummaryTime: event.target.value }))}
                          />
                          <p className="text-xs text-muted-foreground">Independente do horário do resumo de contas a pagar.</p>
                        </div>
                        <div className="space-y-3 md:pt-7">
                          <label className="flex cursor-pointer items-center gap-3 text-sm">
                            <Checkbox checked={form.receivableIncludeOverdue} onCheckedChange={(checked) => setForm((current) => ({ ...current, receivableIncludeOverdue: checked === true }))} />
                            Incluir títulos vencidos
                          </label>
                          <label className="flex cursor-pointer items-center gap-3 text-sm">
                            <Checkbox checked={form.receivableSendWhenEmpty} onCheckedChange={(checked) => setForm((current) => ({ ...current, receivableSendWhenEmpty: checked === true }))} />
                            Avisar mesmo quando não houver títulos
                          </label>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Zap className="size-4" /></span>
                        <div>
                          <Label>Avisos na hora do fluxo de caixa</Label>
                          <p className="text-xs text-muted-foreground">Cada lançamento, baixa ou estorno vira uma mensagem no momento em que acontece.</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!financialAllowed}
                          onClick={() => setFinanceiroEvents(FINANCEIRO_NOTIFICATION_EVENT_VALUES)}
                        >
                          Selecionar todas
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setFinanceiroEvents([])}>Limpar</Button>
                      </div>
                    </div>
                    {!form.usuarioId ? (
                      <p className="text-xs text-muted-foreground">Selecione o usuário para verificar o acesso financeiro.</p>
                    ) : !financialAllowed ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">Este usuário não possui a permissão Financeiro: visualizar.</p>
                    ) : null}
                    <Separator />
                    <div className="space-y-2">
                      {FINANCEIRO_NOTIFICATION_EVENT_GROUPS.map((group) => {
                        const selectedCount = group.events.filter(([id]) => form.selectedFinanceiroEvents.includes(id)).length;
                        const checked = selectedCount === group.events.length ? true : selectedCount > 0 ? "indeterminate" : false;
                        return (
                          <div key={group.id} className="rounded-md border bg-card">
                            <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
                              <Checkbox
                                checked={checked}
                                disabled={!financialAllowed}
                                onCheckedChange={() => toggleFinanceiroGroup(group.events)}
                                aria-label={`Selecionar avisos de ${group.label}`}
                              />
                              <button
                                type="button"
                                className="flex flex-1 items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={!financialAllowed}
                                onClick={() => toggleFinanceiroGroup(group.events)}
                              >
                                <span>
                                  <span className="block text-sm font-medium">{group.label}</span>
                                  <span className="block text-xs text-muted-foreground">{group.description}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">{selectedCount}/{group.events.length}</span>
                              </button>
                            </div>
                            <div className="grid gap-1 p-2 sm:grid-cols-2">
                              {group.events.map(([id, label]) => (
                                <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                                  <Checkbox
                                    checked={form.selectedFinanceiroEvents.includes(id)}
                                    disabled={!financialAllowed}
                                    onCheckedChange={(value) => toggleFinanceiroEvent(id, value === true)}
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {form.selectedFinanceiroEvents.length > 0 ? (
                      <div className="space-y-4 border-t pt-4">
                        <p className="text-xs text-muted-foreground">Filtros opcionais. Deixar em branco significa receber tudo.</p>
                        <div className="space-y-2">
                          <Label htmlFor="dialog-financeiro-minimo">Valor mínimo</Label>
                          <Input
                            id="dialog-financeiro-minimo"
                            type="number"
                            min={0}
                            step="0.01"
                            className="md:w-56"
                            value={form.financeiroMinimumValue}
                            onChange={(event) => setForm((current) => ({
                              ...current,
                              financeiroMinimumValue: Math.max(0, Number(event.target.value) || 0),
                            }))}
                          />
                          <p className="text-xs text-muted-foreground">Zero avisa qualquer valor.</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Origens</Label>
                          <div className="grid gap-1 sm:grid-cols-2">
                            {FINANCEIRO_ORIGEM_OPTIONS.map(([id, label, description]) => (
                              <label key={id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                                <Checkbox
                                  className="mt-0.5"
                                  checked={form.selectedFinanceiroOrigins.includes(id)}
                                  onCheckedChange={(value) => toggleFinanceiroOrigin(id, value === true)}
                                />
                                <span>
                                  <span className="block">{label}</span>
                                  <span className="block text-xs text-muted-foreground">{description}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">Nenhuma marcada avisa de todas. Desmarcar Ordem de serviço evita receber o mesmo pagamento pela OS e pelo financeiro.</p>
                        </div>
                        {banks.length > 0 ? (
                          <div className="space-y-2">
                            <Label>Contas bancárias</Label>
                            <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                              {banks.map((bank) => (
                                <label key={bank.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                                  <Checkbox
                                    checked={form.selectedFinanceiroBanks.includes(bank.id)}
                                    onCheckedChange={(value) => toggleFinanceiroBank(bank.id, value === true)}
                                  />
                                  {bank.titulo}
                                </label>
                              ))}
                            </div>
                            <p className="text-xs text-muted-foreground">Nenhuma marcada avisa de todas. Lançamento que ainda não tem conta definida sempre passa.</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent value="estoque" className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <Label>Movimentações que enviam notificação</Label>
                      <p className="text-xs text-muted-foreground">Cada produto movimentado gera uma mensagem com quantidade e saldos.</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!stockAllowed}
                        onClick={() => setStockEvents(STOCK_REGISTRATION_EVENTS)}
                      >
                        Somente registros
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!stockAllowed}
                        onClick={() => setStockEvents(STOCK_NOTIFICATION_EVENT_VALUES)}
                      >
                        Selecionar todas
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setStockEvents([])}>Limpar</Button>
                    </div>
                  </div>
                  {!form.usuarioId ? (
                    <p className="text-xs text-muted-foreground">Selecione o usuário para verificar o acesso ao estoque.</p>
                  ) : !stockAllowed ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">Este usuário não possui a permissão Estoque: visualizar.</p>
                  ) : null}
                  <Separator />
                  <div className="space-y-2">
                    {STOCK_NOTIFICATION_EVENT_GROUPS.map((group) => {
                      const selectedCount = group.events.filter(([id]) => form.selectedStockEvents.includes(id)).length;
                      const checked = selectedCount === group.events.length ? true : selectedCount > 0 ? "indeterminate" : false;
                      return (
                        <div key={group.id} className="rounded-md border bg-card">
                          <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
                            <Checkbox
                              checked={checked}
                              disabled={!stockAllowed}
                              onCheckedChange={() => toggleStockGroup(group.events)}
                              aria-label={`Selecionar movimentações de ${group.label}`}
                            />
                            <button
                              type="button"
                              className="flex flex-1 items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!stockAllowed}
                              onClick={() => toggleStockGroup(group.events)}
                            >
                              <span>
                                <span className="block text-sm font-medium">{group.label}</span>
                                <span className="block text-xs text-muted-foreground">{group.description}</span>
                              </span>
                              <span className="text-xs text-muted-foreground">{selectedCount}/{group.events.length}</span>
                            </button>
                          </div>
                          <div className="grid gap-1 p-2 sm:grid-cols-2">
                            {group.events.map(([id, label]) => (
                              <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                                <Checkbox
                                  checked={form.selectedStockEvents.includes(id)}
                                  disabled={!stockAllowed}
                                  onCheckedChange={(value) => toggleStockEvent(id, value === true)}
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="fiscal" className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <Label>Documentos fiscais que enviam notificação</Label>
                      <p className="text-xs text-muted-foreground">Vale para notas emitidas pela empresa e para as notas de terceiros reconhecidas na distribuição.</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!fiscalAllowed}
                        onClick={() => setFiscalEvents(FISCAL_PROBLEM_EVENTS)}
                      >
                        Somente problemas
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!fiscalAllowed}
                        onClick={() => setFiscalEvents(FISCAL_NOTIFICATION_EVENT_VALUES)}
                      >
                        Selecionar todas
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setFiscalEvents([])}>Limpar</Button>
                    </div>
                  </div>
                  {!form.usuarioId ? (
                    <p className="text-xs text-muted-foreground">Selecione o usuário para verificar o acesso às notas fiscais.</p>
                  ) : !fiscalAllowed ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">Este usuário não possui a permissão Financeiro: notas fiscais.</p>
                  ) : null}
                  <Separator />
                  <div className="space-y-2">
                    {FISCAL_NOTIFICATION_EVENT_GROUPS.map((group) => {
                      const selectedCount = group.events.filter(([id]) => form.selectedFiscalEvents.includes(id)).length;
                      const checked = selectedCount === group.events.length ? true : selectedCount > 0 ? "indeterminate" : false;
                      return (
                        <div key={group.id} className="rounded-md border bg-card">
                          <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
                            <Checkbox
                              checked={checked}
                              disabled={!fiscalAllowed}
                              onCheckedChange={() => toggleFiscalGroup(group.events)}
                              aria-label={`Selecionar avisos de ${group.label}`}
                            />
                            <button
                              type="button"
                              className="flex flex-1 items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!fiscalAllowed}
                              onClick={() => toggleFiscalGroup(group.events)}
                            >
                              <span>
                                <span className="block text-sm font-medium">{group.label}</span>
                                <span className="block text-xs text-muted-foreground">{group.description}</span>
                              </span>
                              <span className="text-xs text-muted-foreground">{selectedCount}/{group.events.length}</span>
                            </button>
                          </div>
                          <div className="grid gap-1 p-2 sm:grid-cols-2">
                            {group.events.map(([id, label]) => (
                              <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                                <Checkbox
                                  checked={form.selectedFiscalEvents.includes(id)}
                                  disabled={!fiscalAllowed}
                                  onCheckedChange={(value) => toggleFiscalEvent(id, value === true)}
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="marketplace" className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><ShoppingBag className="size-4" /></span>
                      <div>
                        <Label htmlFor="dialog-marketplace-notifications">Atualizações do Mercado Livre</Label>
                        <p className="text-xs text-muted-foreground">Envia perguntas, mensagens, pedidos, alterações de envio, reclamações e anúncios processados pelo ERP.</p>
                      </div>
                    </div>
                    <Switch
                      id="dialog-marketplace-notifications"
                      checked={form.notifyMarketplace}
                      disabled={!marketplaceAllowed}
                      onCheckedChange={(notifyMarketplace) => setForm((current) => ({ ...current, notifyMarketplace }))}
                    />
                  </div>
                  {!form.usuarioId ? (
                    <p className="text-xs text-muted-foreground">Selecione o usuário para verificar o acesso ao Marketplace.</p>
                  ) : !marketplaceAllowed ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">Este usuário não possui a permissão Vendas: visualizar.</p>
                  ) : null}
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!marketplaceAllowed || !form.notifyMarketplace}
                      onClick={() => setMarketplaceEvents(MERCADOLIVRE_NOTIFICATION_EVENT_VALUES)}
                    >
                      Selecionar todas
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setMarketplaceEvents([])}>Limpar</Button>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    {MERCADOLIVRE_NOTIFICATION_EVENT_GROUPS.map((group) => {
                      const selectedCount = group.events.filter(([id]) => form.selectedMarketplaceEvents.includes(id)).length;
                      const checked = selectedCount === group.events.length ? true : selectedCount > 0 ? "indeterminate" : false;
                      const groupDisabled = !marketplaceAllowed || !form.notifyMarketplace;
                      return (
                        <div key={group.id} className="rounded-md border bg-card">
                          <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
                            <Checkbox
                              checked={checked}
                              disabled={groupDisabled}
                              onCheckedChange={() => toggleMarketplaceGroup(group.events)}
                              aria-label={`Selecionar eventos de ${group.label}`}
                            />
                            <button
                              type="button"
                              className="flex flex-1 items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={groupDisabled}
                              onClick={() => toggleMarketplaceGroup(group.events)}
                            >
                              <span>
                                <span className="block text-sm font-medium">{group.label}</span>
                                <span className="block text-xs text-muted-foreground">{group.description}</span>
                              </span>
                              <span className="text-xs text-muted-foreground">{selectedCount}/{group.events.length}</span>
                            </button>
                          </div>
                          <div className="grid gap-1 p-2 sm:grid-cols-2">
                            {group.events.map(([id, label]) => (
                              <label key={id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                                <Checkbox
                                  checked={form.selectedMarketplaceEvents.includes(id)}
                                  disabled={groupDisabled}
                                  onCheckedChange={(value) => toggleMarketplaceEvent(id, value === true)}
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">O usuário recebe somente eventos que também aparecem na Central de Notificações e para os quais possui acesso ao módulo de vendas. Alterações feitas dentro do ERP não geram aviso.</p>
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => onSave(form)} disabled={saving || !valid}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : "Salvar"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
