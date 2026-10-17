"use client";

import {
  AlertTriangle,
  FileCheck2,
  FileOutput,
  Files,
  LockKeyhole,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { formatCompetencia, formatInteger, formatTimestamp } from "../formatters";
import type { SpedArquivo, SpedCompetenciaDetail } from "../types";
import type { SpedPendingAction } from "./action-dialog";
import { CompetenciaTabs } from "./competencia-tabs";
import type { SpedImportKind } from "./import-panel";
import { CompetenciaStatusBadge } from "./status-badges";

export function CompetenciaDetail({
  competencia,
  loading,
  canDownload,
  canManage,
  busy,
  onAction,
  onImport,
  onRefresh,
  initialTab,
}: {
  initialTab?: string | null;
  competencia: SpedCompetenciaDetail | null;
  loading: boolean;
  canDownload: boolean;
  canManage: boolean;
  busy: boolean;
  onAction: (action: SpedPendingAction) => void;
  onImport: (kind: SpedImportKind, file: File) => void;
  onRefresh: () => void;
}) {
  if (loading) return <CompetenciaDetailSkeleton />;
  if (!competencia) return null;

  const pendingGates = competencia.gates.filter((gate) => gate.status === "PENDENTE");
  const blockingDiagnostics = competencia.diagnosticos.bloqueios + competencia.diagnosticos.erros;
  const canClose =
    canManage &&
    competencia.status === "APTA" &&
    pendingGates.length === 0 &&
    blockingDiagnostics === 0;
  const isClosed = competencia.status === "FECHADA";

  return (
    <section aria-labelledby="sped-competencia-heading" className="space-y-4">
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="sped-competencia-heading" className="text-xl font-semibold">
              Competência {formatCompetencia(competencia.competencia)}
            </h2>
            <CompetenciaStatusBadge status={competencia.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            EFD ICMS/IPI · leiaute {competencia.layout} · {competencia.finalidade === "RETIFICADORA" ? "retificadora" : "original"}
            {competencia.versao ? ` · versão ${competencia.versao}` : ""}
          </p>
          {competencia.sourceCutoffAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Fontes congeladas em {formatTimestamp(competencia.sourceCutoffAt, competencia.configuracao.timezoneIana)}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          {!isClosed ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canManage || busy || competencia.status === "EM_VALIDACAO"}
                onClick={() => onAction({ type: "VALIDAR" })}
              >
                <FileCheck2 aria-hidden="true" /> Validar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canManage || busy || !competencia.versao}
                onClick={() => onAction({ type: "GERAR_PREVIA" })}
              >
                <FileOutput aria-hidden="true" /> Gerar Prévia
              </Button>
            </>
          ) : null}
          {!isClosed ? (
            <Button
              type="button"
              size="sm"
              disabled={!canClose || busy}
              title={!canClose ? closeBlockedReason(canManage, competencia.status, pendingGates.length, blockingDiagnostics) : undefined}
              onClick={() => onAction({ type: "FECHAR" })}
            >
              <LockKeyhole aria-hidden="true" /> Fechar
            </Button>
          ) : (
            <>
              <Button type="button" size="sm" variant="outline" disabled={!canManage || busy} onClick={() => onAction({ type: "REABRIR" })}>
                <RotateCcw aria-hidden="true" /> Reabrir
              </Button>
              <Button type="button" size="sm" disabled={!canManage || busy} onClick={() => onAction({ type: "GERAR" })}>
                <FileOutput aria-hidden="true" /> Gerar TXT
              </Button>
            </>
          )}
        </div>
      </div>

      {!canManage ? (
        <Alert>
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>Acesso somente para consulta</AlertTitle>
          <AlertDescription>
            Sua permissão permite conferir e baixar arquivos. Validar, fechar, reabrir e gerar exigem `fiscal:sped_gerenciar`.
          </AlertDescription>
        </Alert>
      ) : null}

      {pendingGates.length > 0 || blockingDiagnostics > 0 ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Fechamento bloqueado</AlertTitle>
          <AlertDescription>
            {pendingGates.length > 0 ? `${pendingGates.length} gate(s) fiscal(is) ainda estão pendentes. ` : ""}
            {blockingDiagnostics > 0 ? `${blockingDiagnostics} inconsistência(s) bloqueante(s) ou erro(s) precisam ser resolvidos.` : ""}
          </AlertDescription>
        </Alert>
      ) : competencia.status === "APTA" ? (
        <Alert>
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>Competência apta para fechamento</AlertTitle>
          <AlertDescription>A ação de fechar refará a validação no servidor e congelará uma nova versão fiscal.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Files} label="Documentos" value={formatInteger(competencia.contagens.total)} detail={`${formatInteger(competencia.contagens.entradas)} entradas · ${formatInteger(competencia.contagens.saidas)} saídas`} />
        <SummaryCard icon={ShieldAlert} label="Bloqueios e erros" value={formatInteger(blockingDiagnostics)} detail={`${formatInteger(competencia.diagnosticos.avisos)} avisos`} danger={blockingDiagnostics > 0} />
        <SummaryCard icon={AlertTriangle} label="Gates pendentes" value={formatInteger(pendingGates.length)} detail={`${formatInteger(competencia.gates.length)} gates avaliados`} danger={pendingGates.length > 0} />
        <SummaryCard icon={FileOutput} label="Arquivos" value={formatInteger(competencia.arquivos.length)} detail={competencia.versao ? `Versão fiscal ${competencia.versao}` : "Sem versão fechada"} />
      </div>

      <CompetenciaTabs
        competencia={competencia}
        canDownload={canDownload}
        canManage={canManage}
        busy={busy}
        onDownload={(file: SpedArquivo) => onAction({ type: "BAIXAR", file })}
        onImport={onImport}
        onConfigSaved={onRefresh}
        initialTab={initialTab}
      />
    </section>
  );
}

function closeBlockedReason(canManage: boolean, status: string, pendingGates: number, diagnostics: number) {
  if (!canManage) return "A permissão fiscal:sped_gerenciar é necessária.";
  if (status !== "APTA") return "A competência precisa estar apta após a validação.";
  if (pendingGates > 0) return "Existem gates fiscais pendentes.";
  if (diagnostics > 0) return "Existem bloqueios ou erros não resolvidos.";
  return undefined;
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  danger = false,
}: {
  icon: typeof Files;
  label: string;
  value: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className={danger ? "size-4 text-destructive" : "size-4 text-muted-foreground"} aria-hidden="true" />
        </div>
        <p className={danger ? "mt-1 text-2xl font-semibold tabular-nums text-destructive" : "mt-1 text-2xl font-semibold tabular-nums"}>{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function CompetenciaDetailSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando detalhes da competência" aria-busy="true">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4"><div className="space-y-2"><Skeleton className="h-6 w-52" /><Skeleton className="h-4 w-72" /></div><Skeleton className="h-9 w-48" /></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Card key={index}><CardContent className="space-y-2 p-4"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-20" /><Skeleton className="h-3 w-36" /></CardContent></Card>)}</div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
