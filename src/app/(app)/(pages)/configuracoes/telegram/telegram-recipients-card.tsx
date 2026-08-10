"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Loader2, Pencil, Send, Trash2, Users } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const STATUSES = [
  ["AGUARDANDO_CHECKLIST", "Aguardando checklist"], ["ORCAMENTO", "Orçamento"],
  ["APROVACAO_ORCAMENTO", "Aguardando aprovação"], ["ORCAMENTO_APROVADO", "Orçamento aprovado"],
  ["ORCAMENTO_RECUSADO", "Orçamento recusado"], ["EM_ANDAMENTO", "Em andamento"],
  ["PAGAMENTO", "Aguardando pagamento"], ["SEM_COBRANCA", "Finalizada sem cobrança"],
  ["CONCLUIDO", "Concluída"], ["CANCELADO", "Cancelada"],
] as const;

type Mode = "CRIACAO" | "CRIACAO_FINALIZACAO" | "TODOS" | "PERSONALIZADO";
type Scope = "TODAS" | "MINHAS" | "MEU_SETOR";
type User = { id: string; name: string; email: string; active: boolean };
type Recipient = {
  usuarioId: string; user: User | null; connected: boolean; telegramUsername: string;
  telegramName: string | null; active: boolean; mode: Mode; scope: Scope;
  notifyCreation: boolean; selectedStatuses: string[]; lastError: string | null;
};
type FormState = {
  usuarioId: string; telegramUsername: string; active: boolean; mode: Mode; scope: Scope;
  notifyCreation: boolean; selectedStatuses: string[]; connected: boolean;
};

const EMPTY_FORM: FormState = {
  usuarioId: "", telegramUsername: "", active: true, mode: "CRIACAO_FINALIZACAO",
  scope: "MINHAS", notifyCreation: true, selectedStatuses: [], connected: false,
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

export function TelegramRecipientsCard({ integrationEnabled }: { integrationEnabled: boolean }) {
  const [users, setUsers] = useState<User[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [link, setLink] = useState<{ usuarioId: string; url: string } | null>(null);

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

  function edit(recipient: Recipient) {
    setForm({
      usuarioId: recipient.usuarioId,
      telegramUsername: recipient.telegramUsername ? `@${recipient.telegramUsername}` : "",
      active: recipient.active,
      mode: recipient.mode,
      scope: recipient.scope,
      notifyCreation: recipient.notifyCreation,
      selectedStatuses: recipient.selectedStatuses,
      connected: recipient.connected,
    });
    setLink(null);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setLink(null);
  }

  async function save() {
    setAction("save");
    try {
      await requestJson("/api/integracoes/telegram/destinatarios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuarioId: form.usuarioId,
          telegramUsername: form.telegramUsername,
          ativo: form.active,
          modo: form.mode,
          escopo: form.scope,
          notificarCriacao: form.notifyCreation,
          statusSelecionados: form.selectedStatuses,
        }),
      });
      toast.success("Destinatário salvo.");
      resetForm();
      await load();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  async function generateLink(usuarioId: string) {
    setAction(`link:${usuarioId}`);
    try {
      const body = await requestJson("/api/integracoes/telegram/destinatarios/vinculo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId }),
      });
      setLink({ usuarioId, url: body.url });
      await navigator.clipboard.writeText(body.url).catch(() => undefined);
      toast.success("Link gerado e copiado. Envie-o ao destinatário; ele expira em 10 minutos.");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  async function testRecipient(usuarioId: string) {
    setAction(`test:${usuarioId}`);
    try {
      await requestJson("/api/integracoes/telegram/destinatarios/teste", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuarioId }),
      });
      toast.success("Mensagem de teste enviada.");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  async function removeRecipient(usuarioId: string) {
    if (!window.confirm("Remover este destinatário e descartar seus avisos pendentes?")) return;
    setAction(`remove:${usuarioId}`);
    try {
      await requestJson(`/api/integracoes/telegram/destinatarios?usuarioId=${encodeURIComponent(usuarioId)}`, { method: "DELETE" });
      toast.success("Destinatário removido.");
      if (form.usuarioId === usuarioId) resetForm();
      await load();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  function toggleStatus(status: string, checked: boolean) {
    setForm((current) => ({ ...current, selectedStatuses: checked
      ? Array.from(new Set([...current.selectedStatuses, status]))
      : current.selectedStatuses.filter((item) => item !== status) }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" />Destinatários dos avisos</CardTitle>
        <CardDescription>Cadastre os contatos que receberão atualizações das ordens de serviço. Apenas usuários com acesso às configurações podem alterar esta lista.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4 border-b pb-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Usuário do ERP</Label>
              <Select value={form.usuarioId} onValueChange={(usuarioId) => setForm((current) => ({ ...current, usuarioId }))} disabled={form.connected}>
                <SelectTrigger aria-label="Usuário do ERP"><SelectValue placeholder="Selecione um usuário" /></SelectTrigger>
                <SelectContent>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name || user.email}{!user.active ? " (inativo)" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipient-telegram-username">Usuário do Telegram</Label>
              <Input id="recipient-telegram-username" value={form.telegramUsername} onChange={(event) => setForm((current) => ({ ...current, telegramUsername: event.target.value }))} placeholder="@usuario_telegram" disabled={form.connected} maxLength={33} autoComplete="off" spellCheck={false} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label>Quando avisar</Label><Select value={form.mode} onValueChange={(mode: Mode) => setForm((current) => ({ ...current, mode }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CRIACAO">Somente criação</SelectItem><SelectItem value="CRIACAO_FINALIZACAO">Criação e finalização</SelectItem><SelectItem value="TODOS">Todas as mudanças</SelectItem><SelectItem value="PERSONALIZADO">Personalizado</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Quais ordens</Label><Select value={form.scope} onValueChange={(scope: Scope) => setForm((current) => ({ ...current, scope }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MINHAS">OS atribuídas ao usuário</SelectItem><SelectItem value="MEU_SETOR">OS do setor do usuário</SelectItem><SelectItem value="TODAS">Todas as OS</SelectItem></SelectContent></Select></div>
          </div>
          {form.mode === "PERSONALIZADO" ? <fieldset className="space-y-3"><legend className="text-sm font-medium">Eventos selecionados</legend><label className="flex items-center gap-2 text-sm"><Checkbox checked={form.notifyCreation} onCheckedChange={(value) => setForm((current) => ({ ...current, notifyCreation: value === true }))} />Criação da OS</label><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{STATUSES.map(([status, label]) => <label key={status} className="flex items-center gap-2 text-sm"><Checkbox checked={form.selectedStatuses.includes(status)} onCheckedChange={(value) => toggleStatus(status, value === true)} />{label}</label>)}</div></fieldset> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={!form.usuarioId || !form.telegramUsername.trim() || action === "save"}>{action === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{form.usuarioId && recipients.some((item) => item.usuarioId === form.usuarioId) ? "Salvar alterações" : "Adicionar destinatário"}</Button>
            {form.usuarioId ? <Button variant="ghost" onClick={resetForm}>Cancelar</Button> : null}
            <div className="ml-auto flex items-center gap-2"><Label htmlFor="recipient-active">Receber avisos</Label><Switch id="recipient-active" checked={form.active} onCheckedChange={(active) => setForm((current) => ({ ...current, active }))} /></div>
          </div>
        </div>

        {loading ? <div className="flex min-h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        : recipients.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum destinatário cadastrado.</p>
        : <div className="divide-y">{recipients.map((recipient) => (
          <div key={recipient.usuarioId} className="space-y-3 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-medium">{recipient.user?.name || recipient.user?.email || "Usuário removido"}</p><p className="text-sm text-muted-foreground">@{recipient.telegramUsername} · {recipient.connected ? "bot vinculado" : "aguardando vínculo"} · {recipient.active ? "avisos ativos" : "avisos pausados"}</p></div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => edit(recipient)}><Pencil className="h-4 w-4" />Editar</Button>
                {!recipient.connected ? <Button size="sm" variant="outline" onClick={() => generateLink(recipient.usuarioId)} disabled={action === `link:${recipient.usuarioId}`} >{action === `link:${recipient.usuarioId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Gerar link</Button> : null}
                {recipient.connected ? <Button size="sm" variant="outline" onClick={() => testRecipient(recipient.usuarioId)} disabled={!integrationEnabled || action === `test:${recipient.usuarioId}`}>{action === `test:${recipient.usuarioId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Testar</Button> : null}
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeRecipient(recipient.usuarioId)} disabled={action === `remove:${recipient.usuarioId}`}><Trash2 className="h-4 w-4" />Remover</Button>
              </div>
            </div>
            {recipient.lastError ? <p role="alert" className="text-sm text-destructive">Último erro: {recipient.lastError}</p> : null}
            {link?.usuarioId === recipient.usuarioId ? <div className="flex flex-col gap-2 sm:flex-row"><Input aria-label="Link de vínculo do Telegram" value={link.url} readOnly /><Button variant="outline" onClick={() => navigator.clipboard.writeText(link.url)}><Copy className="h-4 w-4" />Copiar</Button><Button variant="outline" onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}><ExternalLink className="h-4 w-4" />Abrir</Button></div> : null}
          </div>
        ))}</div>}
      </CardContent>
    </Card>
  );
}
