import { AlertTriangle, CheckCircle2, Clock3, Info, LoaderCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { formatEnum } from "../formatters";
import type { SpedCompetenciaStatus, SpedDiagnosticSeverity, SpedGateStatus } from "../types";

const BASE = "gap-1 border font-medium";

export function CompetenciaStatusBadge({ status }: { status: SpedCompetenciaStatus }) {
  const config = {
    ABERTA: { icon: Clock3, className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
    EM_VALIDACAO: { icon: LoaderCircle, className: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300" },
    COM_ERROS: { icon: XCircle, className: "border-destructive/40 bg-destructive/10 text-destructive" },
    APTA: { icon: CheckCircle2, className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    FECHADA: { icon: CheckCircle2, className: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  }[status];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(BASE, config.className)}>
      <Icon aria-hidden="true" />
      {formatEnum(status)}
    </Badge>
  );
}

export function GateStatusBadge({ status }: { status: SpedGateStatus }) {
  const config = {
    PENDENTE: { icon: AlertTriangle, className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
    CONFIRMADO: { icon: CheckCircle2, className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    NAO_APLICAVEL: { icon: Info, className: "border-muted-foreground/30 bg-muted text-muted-foreground" },
  }[status];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(BASE, config.className)}>
      <Icon aria-hidden="true" />
      {formatEnum(status)}
    </Badge>
  );
}

export function DiagnosticBadge({ severity }: { severity: SpedDiagnosticSeverity }) {
  const config = {
    BLOQUEIO: { icon: XCircle, className: "border-destructive/40 bg-destructive/10 text-destructive" },
    ERRO: { icon: XCircle, className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
    AVISO: { icon: AlertTriangle, className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
    INFORMACAO: { icon: Info, className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  }[severity];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn(BASE, config.className)}>
      <Icon aria-hidden="true" />
      {formatEnum(severity)}
    </Badge>
  );
}
