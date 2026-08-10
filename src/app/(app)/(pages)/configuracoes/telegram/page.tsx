"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Bot, CheckCircle2, Loader2, RefreshCw, RotateCcw, Send } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TelegramRecipientsCard } from "./telegram-recipients-card";

type Status = {
  environment: { enabled: boolean; configured: boolean; hasWebhookSecret: boolean; hasAppUrl: boolean; botUsername: string | null };
  bot: { username?: string; first_name?: string } | null;
  webhook: { url: string; pending_update_count: number; last_error_message?: string } | null;
  connectionError: string | null;
  metrics: { connected: number; pendingEvents: number; pendingDeliveries: number; failedDeliveries: number };
  latestRun: { status: string; erro?: string; started_at: string; completed_at?: string } | null;
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

export default function TelegramConfigurationPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStatus(await requestJson("/api/integracoes/telegram/status")); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runAction(name: string, url: string, success: string) {
    setAction(name);
    try { await requestJson(url, { method: "POST" }); toast.success(success); await load(); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setAction(null); }
  }

  if (loading && !status) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const environmentOk = status?.environment.configured && status.environment.hasWebhookSecret && status.environment.hasAppUrl;
  const webhookOk = Boolean(status?.webhook?.url) && !status?.webhook?.last_error_message;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Telegram</h1><p className="mt-1 text-sm text-muted-foreground">Saúde da integração e processamento dos avisos de ordens de serviço.</p></div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["Usuários conectados", status?.metrics.connected ?? 0], ["Eventos pendentes", status?.metrics.pendingEvents ?? 0], ["Entregas pendentes", status?.metrics.pendingDeliveries ?? 0], ["Entregas com falha", status?.metrics.failedDeliveries ?? 0]].map(([label, value]) => (
          <Card key={String(label)}><CardContent className="p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" />Configuração do bot</CardTitle><CardDescription>Os segredos são lidos exclusivamente das variáveis do servidor.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <StatusItem ok={Boolean(status?.environment.configured)} label="Token e username" detail={status?.environment.botUsername ? `@${status.environment.botUsername}` : "Não configurados"} />
            <StatusItem ok={Boolean(status?.environment.hasWebhookSecret)} label="Segredo do webhook" detail={status?.environment.hasWebhookSecret ? "Configurado" : "Ausente"} />
            <StatusItem ok={Boolean(status?.environment.hasAppUrl)} label="URL pública" detail={status?.environment.hasAppUrl ? "Configurada" : "Ausente"} />
          </div>
          {status?.connectionError ? <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">{status.connectionError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runAction("webhook", "/api/integracoes/telegram/configurar-webhook", "Webhook configurado.")} disabled={!environmentOk || action === "webhook"}>{action === "webhook" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Configurar webhook</Button>
            <Button variant="outline" onClick={() => runAction("process", "/api/integracoes/telegram/executar", "Fila processada.")} disabled={!status?.environment.enabled || action === "process"}>{action === "process" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}Processar agora</Button>
            <Button variant="outline" onClick={() => runAction("retry", "/api/integracoes/telegram/reprocessar", "Falhas elegíveis recolocadas na fila.")} disabled={action === "retry"}>{action === "retry" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Reprocessar falhas</Button>
          </div>
        </CardContent>
      </Card>
      <TelegramRecipientsCard integrationEnabled={Boolean(status?.environment.enabled)} />
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" />Operação</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <StatusItem ok={webhookOk} label="Webhook" detail={status?.webhook?.url || "Ainda não registrado"} />
          <StatusItem ok={status?.latestRun?.status === "CONCLUIDO"} label="Último processamento" detail={status?.latestRun ? `${status.latestRun.status} — ${new Date(status.latestRun.started_at).toLocaleString("pt-BR")}` : "Nenhuma execução registrada"} />
          {status?.webhook?.last_error_message ? <p role="alert" className="text-sm text-destructive">Webhook: {status.webhook.last_error_message}</p> : null}
          {status?.latestRun?.erro ? <p role="alert" className="text-sm text-destructive">Processador: {status.latestRun.erro}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return <div className="flex items-start gap-3 border-l-2 border-border pl-3"><CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? "text-emerald-600" : "text-muted-foreground"}`} /><div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="break-all text-xs text-muted-foreground">{detail}</p></div></div>;
}
