"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  ExternalLink,
  FileCheck2,
  FileSearch,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";

import {
  downloadSpedFile,
  generateAndDownloadSpedPreview,
  getLatestSpedGeneration,
  getSpedGeneration,
  requestSpedGeneration,
} from "./api";
import { formatCompetencia, formatFileSize, formatInteger, formatTimestamp } from "./formatters";
import type { SpedGeracao, SpedPendencia } from "./types";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Etapas mostradas ao usuário, cada uma ligada às etapas reais gravadas pelo backend. */
const STEPS = [
  { label: "Buscando documentos fiscais", stages: ["PREPARANDO", "COLETANDO_DOCUMENTOS"] },
  { label: "Processando produtos e participantes", stages: ["RESOLVENDO_CADASTROS"] },
  { label: "Calculando apuração", stages: ["CALCULANDO_APURACAO"] },
  { label: "Montando registros", stages: ["MONTANDO_REGISTROS"] },
  { label: "Validando informações", stages: ["VALIDANDO"] },
  { label: "Finalizando o arquivo", stages: ["FECHANDO", "GERANDO_ARQUIVO", "FINALIZADO"] },
] as const;

const ACTIVE = new Set(["PENDENTE", "PROCESSANDO"]);

function previousMonth(): { year: number; month: number } {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function stepIndexOf(stage: string): number {
  return STEPS.findIndex((step) => (step.stages as readonly string[]).includes(stage));
}

export function SpedOneClick() {
  const { data: session } = useSession();
  const permissions = (session?.user as { permissoes?: unknown } | undefined)?.permissoes;
  const canView = permissionSetHas(permissions, PERMS.FISCAL_SPED);
  const canManage = permissionSetHas(permissions, PERMS.FISCAL_SPED_GERENCIAR);

  const initial = useMemo(previousMonth, []);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const competencia = `${year}-${String(month).padStart(2, "0")}`;
  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current];
  }, []);

  const [job, setJob] = useState<SpedGeracao | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const polls = useRef(0);

  // Estado já existente da competência escolhida (pedido anterior, arquivo pronto).
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    getLatestSpedGeneration(competencia, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setJob(response.data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Falha ao consultar a competência.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canView, competencia]);

  // Acompanhamento: consulta o progresso real só enquanto o pedido está ativo,
  // com intervalo que cresce para não sobrecarregar o servidor.
  const jobId = job?.id ?? null;
  const jobActive = job ? ACTIVE.has(job.status) : false;
  useEffect(() => {
    if (!jobId || !jobActive) return;
    polls.current = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const tick = async () => {
      try {
        const response = await getSpedGeneration(jobId, controller.signal);
        if (controller.signal.aborted) return;
        setJob(response.data);
        if (ACTIVE.has(response.data.status)) schedule();
      } catch {
        if (!controller.signal.aborted) schedule();
      }
    };
    const schedule = () => {
      polls.current += 1;
      const delay = polls.current < 20 ? 1500 : polls.current < 60 ? 4000 : 10000;
      timer = setTimeout(tick, delay);
    };
    schedule();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, jobActive]);

  const generate = useCallback(async () => {
    setRequesting(true);
    try {
      const response = await requestSpedGeneration(competencia);
      setJob(response.data);
    } catch (error: unknown) {
      toast.error("Não foi possível iniciar a geração", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setRequesting(false);
    }
  }, [competencia]);

  const download = useCallback(async () => {
    const file = job?.resultado?.arquivo;
    if (!file) return;
    setDownloading(true);
    try {
      await downloadSpedFile({ id: file.id, nome: file.nome } as Parameters<typeof downloadSpedFile>[0]);
    } catch (error: unknown) {
      toast.error("Não foi possível baixar o arquivo", { description: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setDownloading(false);
    }
  }, [job]);

  const preview = useCallback(async () => {
    if (!job?.competenciaId) return;
    setPreviewing(true);
    try {
      await generateAndDownloadSpedPreview(job.competenciaId, job.resultado?.versao ?? null);
      toast.success("Prévia gerada para conferência.", { description: "O arquivo é marcado como PRÉVIA e não substitui o arquivo final." });
    } catch (error: unknown) {
      toast.error("Não foi possível gerar a prévia", { description: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPreviewing(false);
    }
  }, [job]);

  const running = jobActive || requesting;
  const advancedHref = job?.competenciaId ? `/fiscal/sped/avancado?competencia=${encodeURIComponent(job.competenciaId)}` : "/fiscal/sped/avancado";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 className="size-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight">SPED Fiscal</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Gere a escrituração fiscal da sua empresa automaticamente a partir dos documentos registrados no sistema.
          </p>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link href={advancedHref}><Settings2 aria-hidden="true" /> Área avançada</Link>
        </Button>
      </header>

      {!canView && session ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Acesso restrito</AlertTitle>
          <AlertDescription>A permissão fiscal:sped é necessária para acessar o SPED Fiscal.</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Competência</CardTitle>
          <CardDescription>
            {job?.resultado?.empresa
              ? <>Estabelecimento: <span className="font-medium text-foreground">{job.resultado.empresa}</span></>
              : "O estabelecimento é identificado automaticamente."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="sped-mes">Mês</Label>
              <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))} disabled={running}>
                <SelectTrigger id="sped-mes" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((label, index) => <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sped-ano">Ano</Label>
              <Select value={String(year)} onValueChange={(value) => setYear(Number(value))} disabled={running}>
                <SelectTrigger id="sped-ano" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            type="button"
            size="lg"
            className="sm:min-w-56"
            onClick={generate}
            disabled={!canManage || running || loading}
            title={canManage ? undefined : "A permissão fiscal:sped_gerenciar é necessária."}
          >
            {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileCheck2 aria-hidden="true" />}
            {running ? "Gerando…" : "Gerar SPED Fiscal"}
          </Button>
        </CardContent>
        {!canManage && canView ? (
          <CardFooter className="text-xs text-muted-foreground">Você pode consultar e baixar arquivos; gerar exige a permissão fiscal:sped_gerenciar.</CardFooter>
        ) : null}
      </Card>

      {loadError ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Não foi possível consultar a competência</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {job && jobActive ? <ProgressCard job={job} /> : null}
      {job?.status === "CONCLUIDA" ? <SuccessCard job={job} downloading={downloading} onDownload={download} /> : null}
      {job?.status === "PENDENCIAS" ? (
        <PendenciesCard job={job} advancedHref={advancedHref} canManage={canManage} previewing={previewing} onPreview={preview} />
      ) : null}
      {job?.status === "FALHOU" ? (
        <Alert variant="destructive">
          <XCircle aria-hidden="true" />
          <AlertTitle>A geração não foi concluída</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{job.erro?.mensagem}</p>
            {canManage ? (
              <Button type="button" size="sm" variant="outline" onClick={generate} disabled={running}>
                <RefreshCw aria-hidden="true" /> Tentar novamente
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {!job && !loading && !loadError ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma geração para {formatCompetencia(competencia)} ainda. Selecione a competência e clique em Gerar SPED Fiscal.
        </p>
      ) : null}
    </div>
  );
}

function ProgressCard({ job }: { job: SpedGeracao }) {
  const current = Math.max(0, stepIndexOf(job.etapa));
  return (
    <Card aria-live="polite">
      <CardHeader>
        <CardTitle className="text-base">Gerando o SPED de {formatCompetencia(job.competencia)}</CardTitle>
        <CardDescription>
          {job.interrompida
            ? "O processamento foi interrompido e está sendo retomado de onde parou."
            : "Você pode sair desta tela: a geração continua no servidor."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2.5">
          {STEPS.map((step, index) => {
            const state = job.status === "PENDENTE" ? "pending" : index < current ? "done" : index === current ? "active" : "pending";
            return (
              <li key={step.label} className="flex items-center gap-2.5 text-sm">
                {state === "done" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                  : state === "active" ? <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                    : <Circle className="size-4 text-muted-foreground/50" aria-hidden="true" />}
                <span className={state === "pending" ? "text-muted-foreground" : state === "active" ? "font-medium" : undefined}>{step.label}</span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function SuccessCard({ job, downloading, onDownload }: { job: SpedGeracao; downloading: boolean; onDownload: () => void }) {
  const result = job.resultado;
  const file = result?.arquivo;
  const rows: Array<[string, string]> = [
    ["Competência", formatCompetencia(job.competencia)],
    ["Empresa", result ? `${result.empresa}${result.cnpj ? ` · CNPJ ${result.cnpj}` : ""}` : "—"],
    ["Documentos processados", result ? `${formatInteger(result.documentos)} (${formatInteger(result.saidas)} saídas · ${formatInteger(result.entradas)} entradas)` : "—"],
    ["Registros gerados", file ? `${formatInteger(file.linhas)} linhas · ${formatFileSize(file.tamanhoBytes)}` : formatInteger(result?.registros)],
    ["Data da geração", formatTimestamp(file?.geradoEm ?? job.concluidoEm)],
    ["Versão do leiaute", result?.leiaute ?? "—"],
    ["Status da geração", result?.finalidade === "RETIFICADORA" ? "Arquivo final · retificadora" : "Arquivo final · competência fechada"],
  ];
  return (
    <Card className="border-emerald-600/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
          <CardTitle className="text-base">SPED Fiscal gerado com sucesso</CardTitle>
        </div>
        {result && (result.itensClassificados > 0 || result.creditosDecididos > 0) ? (
          <CardDescription>
            O sistema classificou {formatInteger(result.itensClassificados)} produto(s) e registrou {formatInteger(result.creditosDecididos)} decisão(ões) de crédito automaticamente, com evidência auditável.
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-medium" title={value}>{value}</dd>
            </div>
          ))}
        </dl>
        {file ? <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">SHA-256 {file.sha256}</p> : null}
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" onClick={onDownload} disabled={!file || downloading}>
          {downloading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          Baixar SPED Fiscal (.txt)
        </Button>
        <p className="text-xs text-muted-foreground">Validado pelo ERP. Transmita pelo PVA da Receita Federal, que faz a validação oficial.</p>
      </CardFooter>
    </Card>
  );
}

function PendenciesCard({
  job,
  advancedHref,
  canManage,
  previewing,
  onPreview,
}: {
  job: SpedGeracao;
  advancedHref: string;
  canManage: boolean;
  previewing: boolean;
  onPreview: () => void;
}) {
  const pendencies = job.pendencias;
  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">Precisamos resolver algumas informações antes de gerar o arquivo final.</CardTitle>
            <CardDescription className="mt-1">
              {formatInteger(pendencies?.blocking ?? 0)} ocorrência(s) impedem o fechamento de {formatCompetencia(job.competencia)}. Depois de corrigir, clique em Gerar SPED Fiscal novamente.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {(pendencies?.groups ?? []).map((group) => (
          <section key={group.category} aria-labelledby={`pendencias-${group.category}`} className="space-y-2">
            <h3 id={`pendencias-${group.category}`} className="text-sm font-semibold">{group.label}</h3>
            <ul className="space-y-2">
              {group.items.map((item) => <PendencyItem key={item.id} item={item} />)}
            </ul>
          </section>
        ))}
        {pendencies && pendencies.warnings.length > 0 ? (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-3.5" aria-hidden="true" /> {pendencies.warnings.length} aviso(s) que não impedem a geração
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-2 space-y-2">{pendencies.warnings.map((item) => <PendencyItem key={item.id} item={item} />)}</ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Button asChild>
          <Link href={advancedHref}>Corrigir pendências</Link>
        </Button>
        {canManage && job.competenciaId ? (
          <Button type="button" variant="outline" onClick={onPreview} disabled={previewing}>
            {previewing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSearch aria-hidden="true" />}
            Gerar prévia para conferência
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">A prévia é marcada como PRÉVIA, não é o arquivo final e não pode ser entregue.</p>
      </CardFooter>
    </Card>
  );
}

function PendencyItem({ item }: { item: SpedPendencia }) {
  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.title}</span>
        {item.occurrences > 1 ? <Badge variant="secondary">{formatInteger(item.occurrences)} ocorrências</Badge> : null}
        {item.record ? <Badge variant="outline">Registro {item.record}</Badge> : null}
      </div>
      <p className="mt-1 text-muted-foreground">{item.description}</p>
      {item.affected.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Afeta: {item.affected.join(", ")}{item.occurrences > item.affected.length ? " e outros" : ""}
        </p>
      ) : null}
      <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
        <div><dt className="inline font-medium">Por que bloqueia: </dt><dd className="inline text-muted-foreground">{item.reason}</dd></div>
        <div><dt className="inline font-medium">Como corrigir: </dt><dd className="inline text-muted-foreground">{item.action}</dd></div>
      </dl>
      {item.link ? (
        <Link href={item.link.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          {item.link.label} <ExternalLink className="size-3" aria-hidden="true" />
        </Link>
      ) : null}
    </li>
  );
}
