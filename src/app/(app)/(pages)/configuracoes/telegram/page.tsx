"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Bot, CheckCircle2, Loader2, RefreshCw, RotateCcw, Send } from "lucide-react";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TelegramRecipientsCard } from "./telegram-recipients-card";

type Status = {
  environment: { enabled: boolean; configured: boolean; hasWebhookSecret: boolean; hasAppUrl: boolean; botUsername: string | null };
  bot: { username?: string; first_name?: string } | null;
  webhook: { url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string; last_success_date?: number } | null;
  connectionError: string | null;
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

  if (loading && !status) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
          <p className="text-primary">Carregando configurações...</p>
        </div>
      </div>
    );
  }
  const environmentOk = status?.environment.configured && status.environment.hasWebhookSecret && status.environment.hasAppUrl;
  const webhookOk = Boolean(status?.webhook?.url) && (
    !status?.webhook?.last_error_message
    || (status.webhook.last_success_date ?? 0) > (status.webhook.last_error_date ?? 0)
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted"><Bot className="h-4 w-4" /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{status?.environment.botUsername ? `@${status.environment.botUsername}` : "Bot não configurado"}</p><Badge variant={status?.environment.enabled ? "default" : "secondary"}>{status?.environment.enabled ? "Ativo" : "Desativado"}</Badge><Badge variant={webhookOk ? "outline" : "destructive"}>{webhookOk ? "Webhook conectado" : "Webhook pendente"}</Badge></div>
                <p className="mt-0.5 text-xs text-muted-foreground">{status?.latestRun ? `Último processamento: ${new Date(status.latestRun.started_at).toLocaleString("pt-BR")} · ${status.latestRun.status}` : "O processador ainda não foi executado."}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button size="sm" variant={webhookOk ? "outline" : "default"} onClick={() => runAction("webhook", "/api/integracoes/telegram/configurar-webhook", "Webhook configurado.")} disabled={!environmentOk || action === "webhook"}>{action === "webhook" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{webhookOk ? "Reconfigurar" : "Configurar webhook"}</Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="max-w-64">Atualiza o webhook e o envio automático. Use após alterar domínio, bot ou segredos.</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button size="sm" variant="outline" onClick={() => runAction("process", "/api/integracoes/telegram/executar", "Fila processada.")} disabled={!status?.environment.enabled || action === "process"}>{action === "process" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}Processar</Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="max-w-64">Processa agora os eventos pendentes. O envio normal acontece automaticamente.</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button size="sm" variant="outline" onClick={() => runAction("retry", "/api/integracoes/telegram/reprocessar", "Falhas elegíveis recolocadas na fila.")} disabled={action === "retry"}>{action === "retry" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Reprocessar</Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="max-w-64">Recoloca na fila notificações que falharam e ainda podem ser reenviadas.</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button size="icon" variant="ghost" onClick={() => void load()} disabled={loading} aria-label="Atualizar integração"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>Atualiza o status da integração.</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {status?.connectionError ? <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">{status.connectionError}</p> : null}
          {!environmentOk ? <div className="grid gap-3 border-t pt-3 md:grid-cols-3"><StatusItem ok={Boolean(status?.environment.configured)} label="Token e username" detail={status?.environment.configured ? "Configurados" : "Ausentes"} /><StatusItem ok={Boolean(status?.environment.hasWebhookSecret)} label="Segredo" detail={status?.environment.hasWebhookSecret ? "Configurado" : "Ausente"} /><StatusItem ok={Boolean(status?.environment.hasAppUrl)} label="URL pública" detail={status?.environment.hasAppUrl ? "Configurada" : "Ausente"} /></div> : null}
          {!webhookOk && status?.webhook?.last_error_message ? <p role="alert" className="text-sm text-destructive">Webhook: {status.webhook.last_error_message}</p> : null}
          {status?.latestRun?.erro ? <p role="alert" className="text-sm text-destructive">Processador: {status.latestRun.erro}</p> : null}
        </CardContent>
      </Card>
      <TelegramRecipientsCard integrationEnabled={Boolean(status?.environment.enabled)} />
    </div>
  );
}

function StatusItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return <div className="flex items-start gap-3 border-l-2 border-border pl-3"><CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? "text-emerald-600" : "text-muted-foreground"}`} /><div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="break-all text-xs text-muted-foreground">{detail}</p></div></div>;
}
