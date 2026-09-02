"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy, Edit3, ExternalLink, Link2, Loader2, MoreHorizontal, Plus, Search, Send, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  recipientEvents,
  TelegramRecipientDialog,
  type RecipientFormData,
  type Scope,
  type TelegramRecipient,
  type TelegramUser,
} from "./telegram-recipient-dialog";

const SCOPE_LABELS: Record<Scope, string> = {
  MINHAS: "OS atribuídas",
  MEU_SETOR: "Setor do usuário",
  TODAS: "Todas as OS",
};

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Não foi possível concluir a operação.");
  return body;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

function recipientName(recipient: TelegramRecipient) {
  return recipient.user?.name || recipient.user?.email || "Usuário removido";
}

export function TelegramRecipientsCard({ integrationEnabled }: { integrationEnabled: boolean }) {
  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [recipients, setRecipients] = useState<TelegramRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogRecipient, setDialogRecipient] = useState<TelegramRecipient | null>(null);
  const [link, setLink] = useState<{ recipient: TelegramRecipient; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await requestJson("/api/integracoes/telegram/destinatarios");
      setUsers(body.users ?? []);
      setRecipients(body.recipients ?? []);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filteredRecipients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return recipients;
    return recipients.filter((recipient) => `${recipientName(recipient)} ${recipient.user?.email ?? ""} ${recipient.telegramUsername}`.toLocaleLowerCase("pt-BR").includes(term));
  }, [recipients, search]);

  const total = filteredRecipients.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageRecipients = filteredRecipients.slice(start, end);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const availableUsers = useMemo(() => {
    if (dialogRecipient) return users;
    const configuredIds = new Set(recipients.map((recipient) => recipient.usuarioId));
    return users.filter((user) => !configuredIds.has(user.id));
  }, [dialogRecipient, recipients, users]);

  function openCreate() {
    setDialogRecipient(null);
    setDialogOpen(true);
  }

  function openEdit(recipient: TelegramRecipient) {
    setDialogRecipient(recipient);
    setDialogOpen(true);
  }

  async function saveRecipient(data: RecipientFormData) {
    setAction("save");
    try {
      await requestJson("/api/integracoes/telegram/destinatarios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuarioId: data.usuarioId,
          telegramUsername: data.telegramUsername,
          ativo: data.active,
          modo: "PERSONALIZADO",
          escopo: data.scope,
          notificarCriacao: data.selectedEvents.includes("CRIADA"),
          statusSelecionados: data.selectedEvents.filter((event) => event !== "CRIADA"),
          notificarFinanceiroDiario: data.notifyFinancialDaily,
          horarioResumoFinanceiro: data.financialSummaryTime,
          financeiroIncluirAtrasadas: data.financialIncludeOverdue,
          financeiroEnviarSemContas: data.financialSendWhenEmpty,
          notificarReceberDiario: data.notifyReceivableDaily,
          horarioResumoReceber: data.receivableSummaryTime,
          receberIncluirVencidas: data.receivableIncludeOverdue,
          receberEnviarSemContas: data.receivableSendWhenEmpty,
          estoqueEventosSelecionados: data.selectedStockEvents,
          fiscalEventosSelecionados: data.selectedFiscalEvents,
        }),
      });
      toast.success("Configuração de avisos salva.");
      setDialogOpen(false);
      await load();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  async function generateLink(recipient: TelegramRecipient) {
    setAction(`link:${recipient.usuarioId}`);
    try {
      const body = await requestJson("/api/integracoes/telegram/destinatarios/vinculo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId: recipient.usuarioId }),
      });
      setLink({ recipient, url: body.url });
      await navigator.clipboard.writeText(body.url).catch(() => undefined);
      toast.success("Link gerado e copiado. Ele expira em 10 minutos.");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  async function testRecipient(recipient: TelegramRecipient) {
    setAction(`test:${recipient.usuarioId}`);
    try {
      await requestJson("/api/integracoes/telegram/destinatarios/teste", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId: recipient.usuarioId }),
      });
      toast.success("Mensagem de teste enviada.");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  async function testFinancialSummary(recipient: TelegramRecipient, tipo: "A_PAGAR" | "A_RECEBER") {
    setAction(`financial-test:${recipient.usuarioId}`);
    try {
      const body = await requestJson("/api/integracoes/telegram/destinatarios/teste-financeiro", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId: recipient.usuarioId, tipo }),
      });
      const label = tipo === "A_RECEBER" ? "contas a receber" : "contas a pagar";
      toast.success(`Resumo de ${label} de teste enviado em ${body.messages ?? 1} mensagem(ns).`);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  async function removeRecipient(recipient: TelegramRecipient) {
    if (!window.confirm(`Remover ${recipientName(recipient)} e descartar seus avisos pendentes?`)) return;
    setAction(`remove:${recipient.usuarioId}`);
    try {
      await requestJson(`/api/integracoes/telegram/destinatarios?usuarioId=${encodeURIComponent(recipient.usuarioId)}`, { method: "DELETE" });
      toast.success("Destinatário removido.");
      await load();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  return (
    <>
      <Card>
        <CardHeader className="border-b-2 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Avisos por usuário</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <button type="button" onClick={() => void load()} className="inline-flex cursor-pointer items-center gap-1 text-foreground/50 hover:text-foreground/70">
                  <span>Recarregar</span>
                  <Loader2 width={12} className={loading ? "animate-spin" : ""} />
                </button>
                <span>·</span>
                <span>{recipients.length} {recipients.length === 1 ? "destinatário configurado" : "destinatários configurados"}</span>
              </CardDescription>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
              <div className="relative min-w-56 flex-1 md:w-72 md:flex-none"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar destinatário" className="h-9 pl-9" aria-label="Buscar destinatários" /></div>
              <Button size="sm" onClick={openCreate} disabled={availableUsers.length === 0}><Plus className="h-4 w-4" />Novo destinatário</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative -mt-[24px] min-h-[190px] px-4 pb-4 pt-0">
          <div className={`${loading ? "opacity-100" : ""} absolute left-0 right-0 top-0 h-0.5 overflow-hidden bg-slate-400 opacity-0 transition-all`}>
            <div className={`${loading ? "animate-slideIn" : ""} absolute left-0 h-full w-1/2 -translate-x-full rounded-lg bg-primary`} />
          </div>
          <Table className="mt-6">
            <TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Telegram</TableHead><TableHead>Notificações</TableHead><TableHead>Escopo de OS</TableHead><TableHead>Status</TableHead><TableHead className="w-12 text-right">Ações</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? Array.from({ length: 3 }).map((_, index) => <TableRow key={index} className="animate-pulse"><TableCell><div className="h-4 w-36 rounded bg-muted" /></TableCell><TableCell><div className="h-4 w-28 rounded bg-muted" /></TableCell><TableCell><div className="h-4 w-20 rounded bg-muted" /></TableCell><TableCell><div className="h-4 w-24 rounded bg-muted" /></TableCell><TableCell><div className="h-5 w-20 rounded bg-muted" /></TableCell><TableCell /></TableRow>)
              : filteredRecipients.length === 0 ? <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">{recipients.length ? "Nenhum destinatário corresponde à busca." : "Nenhum destinatário cadastrado."}</TableCell></TableRow>
              : pageRecipients.map((recipient) => {
                 const eventCount = recipientEvents(recipient).length;
                 const stockEventCount = recipient.selectedStockEvents.length;
                 const fiscalEventCount = recipient.selectedFiscalEvents.length;
                 const busy = action?.endsWith(recipient.usuarioId);
                return <TableRow key={recipient.usuarioId}>
                  <TableCell><div className="font-medium">{recipientName(recipient)}</div><div className="text-xs text-muted-foreground">{recipient.user?.email || "—"}</div></TableCell>
                  <TableCell><div>@{recipient.telegramUsername}</div><div className="text-xs text-muted-foreground">{recipient.connected ? "Conta vinculada" : "Aguardando vínculo"}</div></TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{eventCount > 0 ? <Badge variant="secondary">OS: {eventCount}</Badge> : null}{recipient.notifyFinancialDaily ? <Badge variant="outline">A pagar às {recipient.financialSummaryTime}</Badge> : null}{recipient.notifyReceivableDaily ? <Badge variant="outline">A receber às {recipient.receivableSummaryTime}</Badge> : null}{stockEventCount > 0 ? <Badge variant="outline">Estoque: {stockEventCount}</Badge> : null}{fiscalEventCount > 0 ? <Badge variant="outline">Fiscal: {fiscalEventCount}</Badge> : null}</div></TableCell>
                  <TableCell>{eventCount > 0 ? SCOPE_LABELS[recipient.scope] : "—"}</TableCell>
                  <TableCell><div className="flex flex-wrap gap-1"><Badge variant={recipient.active ? "outline" : "secondary"}>{recipient.active ? "Ativo" : "Pausado"}</Badge><Badge variant={recipient.connected ? "outline" : "secondary"}>{recipient.connected ? "Vinculado" : "Pendente"}</Badge></div></TableCell>
                  <TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={busy} aria-label={`Ações de ${recipientName(recipient)}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openEdit(recipient)}><Edit3 className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>{!recipient.connected ? <DropdownMenuItem onClick={() => generateLink(recipient)}><Link2 className="mr-2 h-4 w-4" />Gerar link</DropdownMenuItem> : <><DropdownMenuItem onClick={() => testRecipient(recipient)} disabled={!integrationEnabled}><Send className="mr-2 h-4 w-4" />Testar mensagem</DropdownMenuItem>{recipient.notifyFinancialDaily ? <DropdownMenuItem onClick={() => testFinancialSummary(recipient, "A_PAGAR")} disabled={!integrationEnabled}><Send className="mr-2 h-4 w-4" />Testar contas a pagar</DropdownMenuItem> : null}{recipient.notifyReceivableDaily ? <DropdownMenuItem onClick={() => testFinancialSummary(recipient, "A_RECEBER")} disabled={!integrationEnabled}><Send className="mr-2 h-4 w-4" />Testar contas a receber</DropdownMenuItem> : null}</>}<DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => removeRecipient(recipient)}><Trash2 className="mr-2 h-4 w-4" />Remover</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-xs text-muted-foreground">{total > 0 ? `${start + 1} - ${end} de ${total}` : "0 de 0"}</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setPage(1)} disabled={page === 1 || total === 0} aria-label="Primeira página"><ChevronsLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1 || total === 0} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="min-w-24 text-center text-xs font-medium">Pg. {Math.min(page, totalPages)} de {totalPages}</span>
              <Button variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages || total === 0} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" onClick={() => setPage(totalPages)} disabled={page === totalPages || total === 0} aria-label="Última página"><ChevronsRight className="h-4 w-4" /></Button>
            </div>
            <Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value)); setPage(1); }}><SelectTrigger className="h-9 w-20" aria-label="Itens por página"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="10">10</SelectItem><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent></Select>
          </div>
        </CardContent>
      </Card>

      {dialogOpen ? <TelegramRecipientDialog open={dialogOpen} onOpenChange={setDialogOpen} recipient={dialogRecipient} users={availableUsers} saving={action === "save"} onSave={saveRecipient} /> : null}

      <Dialog open={Boolean(link)} onOpenChange={(open) => { if (!open) setLink(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Vincular contato ao bot</DialogTitle><DialogDescription>Envie este link para {link ? recipientName(link.recipient) : "o destinatário"}. A pessoa deve abri-lo com o Telegram cadastrado e tocar em Iniciar.</DialogDescription></DialogHeader>
          <Input value={link?.url ?? ""} readOnly aria-label="Link de vínculo do Telegram" />
          <DialogFooter><Button variant="outline" onClick={() => link && navigator.clipboard.writeText(link.url).then(() => toast.success("Link copiado.")).catch(() => toast.error("Não foi possível copiar o link."))}><Copy className="h-4 w-4" />Copiar</Button><Button onClick={() => link && window.open(link.url, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" />Abrir Telegram</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
