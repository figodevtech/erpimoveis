"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Link2, Loader2, MessageCircleMore, RefreshCw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import type { ChecklistConviteAssinaturaResumo, ChecklistConviteStatus } from "@/lib/ordens/checklist-documento";

const STATUS_LABEL: Record<ChecklistConviteStatus, string> = {
  ATIVO: "Ativo",
  EXPIRADO: "Expirado",
  REVOGADO: "Revogado",
  UTILIZADO: "Utilizado",
  SUPERADO: "Superado",
};

const DARK_INPUT_CLASS =
  "h-11 select-text dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500";
const DARK_SELECT_CLASS =
  "border-input bg-background text-foreground h-11 w-full rounded-md border px-3 text-base md:text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]";
const DARK_OUTLINE_BUTTON_CLASS =
  "dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:hover:text-white";
const DARK_PRIMARY_BUTTON_CLASS =
  "dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500";

function date(value: string | null | undefined) {
  if (!value) return "Não informado";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

function whatsappPhone(value: string | null | undefined) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : "";
}

export function ChecklistOnlineSigningInvitation({
  publicId,
  canManage,
  latest,
  customerPhone,
  documentCode,
}: {
  publicId: string;
  canManage: boolean;
  latest: boolean;
  customerPhone?: string | null;
  documentCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [invitation, setInvitation] = useState<ChecklistConviteAssinaturaResumo | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [duration, setDuration] = useState("72");
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/checklist-documentos/${publicId}/convite-assinatura`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível consultar o convite.");
      setInvitation(payload.convite ?? null);
      setShowForm(!payload.convite || ["EXPIRADO", "REVOGADO", "SUPERADO"].includes(payload.convite.status));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível consultar o convite.");
    } finally {
      setLoading(false);
    }
  }, [publicId]);

  useEffect(() => { void load(); }, [load]);

  async function copy(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(success);
    } catch {
      toast.error("Não foi possível copiar. Selecione o conteúdo manualmente.");
    }
  }

  async function create() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/checklist-documentos/${publicId}/convite-assinatura`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf, senha: password, confirmacaoSenha: confirmation, validadeHoras: Number(duration) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível gerar o convite.");
      setInvitation(payload.convite);
      setNewPassword(password);
      setPassword("");
      setConfirmation("");
      setShowForm(false);
      toast.success("Convite criado. Envie o link e a senha em mensagens separadas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o convite.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/checklist-documentos/${publicId}/convite-assinatura`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível revogar o convite.");
      setNewPassword(null);
      await load();
      toast.success(payload.revoked ? "Convite revogado." : "Não havia convite ativo para revogar.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível revogar o convite.");
    } finally {
      setSaving(false);
    }
  }

  function shareWhatsapp() {
    if (!invitation?.url) return;
    const phone = whatsappPhone(customerPhone);
    const message = [
      "Olá! A oficina enviou um checklist para sua revisão e assinatura.",
      `Documento: ${documentCode}`,
      `Acesse: ${invitation.url}`,
      `O convite vence em ${date(invitation.expiraEm)}.`,
      "A senha será enviada separadamente.",
    ].join("\n");
    const params = new URLSearchParams({ text: message });
    if (phone) params.set("phone", phone);
    window.open(`https://api.whatsapp.com/send?${params.toString()}`, "_blank", "noopener,noreferrer");
    if (!phone) toast.info("Telefone não identificado no snapshot. Selecione o contato no WhatsApp.");
  }

  const active = invitation?.status === "ATIVO";
  return <>
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={DARK_OUTLINE_BUTTON_CLASS}
      onClick={() => { setOpen(true); void load(); }}
      disabled={!canManage || !latest}
      title={!latest ? "Somente a versão mais recente pode ser enviada para assinatura." : undefined}
    >
      <Send className="mr-2 h-4 w-4" />Enviar para assinatura online
      {invitation && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{STATUS_LABEL[invitation.status]}</span>}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 text-foreground [&_button:not([data-slot=dialog-close])]:h-auto [&_button:not([data-slot=dialog-close])]:min-h-11 [&_button]:whitespace-normal sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b p-4 pr-10 text-left sm:p-6 sm:pr-10">
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" />Assinatura online</DialogTitle>
          <DialogDescription>O link e a senha devem ser enviados separadamente ao responsável.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-y-contain p-4 [overflow-wrap:anywhere] sm:p-6">
        {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : <div className="space-y-5">
          {invitation && (
            <section className="space-y-3 rounded-xl border bg-muted/25 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><b>Convite {STATUS_LABEL[invitation.status].toLowerCase()}</b><span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold text-foreground ring-1 ring-border">{STATUS_LABEL[invitation.status]}</span></div>
              <div className="grid gap-2 text-sm sm:grid-cols-2"><p><b>Criado em:</b> {date(invitation.criadoEm)}</p><p><b>Vencimento:</b> {date(invitation.expiraEm)}</p>{invitation.ultimoAcessoEm && <p><b>Último acesso:</b> {date(invitation.ultimoAcessoEm)}</p>}{invitation.consumidoEm && <p><b>Utilizado em:</b> {date(invitation.consumidoEm)}</p>}</div>
              {active && invitation.url && <>
                <div className="flex flex-col gap-2 sm:flex-row"><Input aria-label="Link privado de assinatura" className={`min-w-0 font-mono ${DARK_INPUT_CLASS}`} value={invitation.url} readOnly /><Button className={DARK_OUTLINE_BUTTON_CLASS} variant="outline" onClick={() => void copy(invitation.url!, "Link copiado.")}><Copy className="mr-2 h-4 w-4" />Copiar link</Button></div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Button className={DARK_PRIMARY_BUTTON_CLASS} onClick={shareWhatsapp}><MessageCircleMore className="mr-2 h-4 w-4" />Compartilhar link no WhatsApp</Button>{newPassword ? <Button className={DARK_OUTLINE_BUTTON_CLASS} variant="outline" onClick={() => void copy(newPassword, "Senha copiada.")}><KeyRound className="mr-2 h-4 w-4" />Copiar senha</Button> : <p className="self-center text-xs text-muted-foreground">A senha não é recuperável. Gere outro convite se ela foi perdida.</p>}</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Button className={DARK_OUTLINE_BUTTON_CLASS} variant="outline" onClick={() => { setShowForm(true); setNewPassword(null); }}><RefreshCw className="mr-2 h-4 w-4" />Gerar novo convite</Button><Button variant="destructive" onClick={() => void revoke()} disabled={saving}><Trash2 className="mr-2 h-4 w-4" />Revogar</Button></div>
              </>}
            </section>
          )}

          {showForm && (
            <section className="space-y-4 select-none rounded-xl bg-card sm:p-4">
              {active && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Ao gerar, o convite ativo será revogado imediatamente.</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm sm:col-span-2"><span className="font-medium">CPF do responsável</span><Input className={DARK_INPUT_CLASS} name="checklist-signing-recipient" value={cpf} onChange={(event) => setCpf(event.target.value)} inputMode="numeric" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-autocomplete="none" placeholder="000.000.000-00" /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Senha numérica</span><Input className={DARK_INPUT_CLASS} name="checklist-invitation-new-code" type="password" value={password} onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-autocomplete="none" minLength={4} maxLength={8} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Confirmar senha</span><Input className={DARK_INPUT_CLASS} name="checklist-invitation-confirm-code" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-autocomplete="none" minLength={4} maxLength={8} /></label>
                <label className="space-y-1.5 text-sm sm:col-span-2"><span className="font-medium">Validade</span><select className={DARK_SELECT_CLASS} value={duration} onChange={(event) => setDuration(event.target.value)}><option value="24">24 horas</option><option value="48">48 horas</option><option value="72">72 horas</option><option value="168">7 dias</option></select></label>
              </div>
            </section>
          )}
        </div>}
        </div>

        <DialogFooter className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          <Button className={DARK_OUTLINE_BUTTON_CLASS} variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          {showForm && <Button className={DARK_PRIMARY_BUTTON_CLASS} onClick={() => void create()} disabled={saving || password.length < 4 || password !== confirmation}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Gerar convite</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
