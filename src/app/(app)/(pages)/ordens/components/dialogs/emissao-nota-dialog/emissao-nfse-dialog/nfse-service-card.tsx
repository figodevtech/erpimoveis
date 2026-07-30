import {
  AlertTriangle,
  Ban,
  CircleDashed,
  Clock3,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ServicoOS } from "./types";

type StatusVisual = {
  label: string;
  Icon: LucideIcon;
  badgeClassName: string;
  borderClassName: string;
};

function getStatusVisual(status?: string | null): StatusVisual {
  const normalized = String(status ?? "").toUpperCase();

  if (["AUTORIZADA", "AUTORIZADO", "EMITIDA"].includes(normalized)) {
    return {
      label: "Autorizada",
      Icon: ShieldCheck,
      badgeClassName: "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
      borderClassName: "border-l-emerald-600",
    };
  }
  if (["PROCESSANDO", "PROCESSANDO_AUTORIZACAO"].includes(normalized)) {
    return {
      label: "Processando",
      Icon: Clock3,
      badgeClassName: "border-sky-600/25 bg-sky-600/10 text-sky-700 dark:text-sky-400",
      borderClassName: "border-l-sky-600",
    };
  }
  if (["REJEITADA", "ERRO", "ERRO_AUTORIZACAO"].includes(normalized)) {
    return {
      label: "Rejeitada",
      Icon: XCircle,
      badgeClassName: "border-destructive/25 bg-destructive/10 text-destructive",
      borderClassName: "border-l-destructive",
    };
  }
  if (["CANCELADA", "CANCELADO"].includes(normalized)) {
    return {
      label: "Cancelada",
      Icon: Ban,
      badgeClassName: "border-amber-600/25 bg-amber-600/10 text-amber-700 dark:text-amber-400",
      borderClassName: "border-l-amber-600",
    };
  }
  return {
    label: "Pendente",
    Icon: CircleDashed,
    badgeClassName: "border-border bg-muted text-muted-foreground",
    borderClassName: "border-l-border",
  };
}

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function getMensagemErro(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = getMensagemErro(item);
      if (message) return message;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = record.mensagem ?? record.message ?? record.codigo;
    return typeof message === "string" ? message : null;
  }
  return null;
}

export function NfseServiceCard({
  servico,
  selected,
  loading,
  onToggle,
}: {
  servico: ServicoOS;
  selected: boolean;
  loading: boolean;
  onToggle: (servico: ServicoOS, selected: boolean) => void;
}) {
  const status = getStatusVisual(servico.notaFiscalStatus);
  const quantidade = Number(servico.quantidade);
  const precoUnitario = Number(servico.precounitario);
  const hasValidValue = Number.isFinite(quantidade)
    && quantidade > 0
    && Number.isFinite(precoUnitario)
    && precoUnitario > 0;
  const total = hasValidValue ? quantidade * precoUnitario : null;
  const hasPendingData = Boolean(servico.pendenciasCadastro?.length);
  const isProcessing = status.label === "Processando";
  const isAuthorized = status.label === "Autorizada";
  const canSelect = !loading && !isProcessing && !isAuthorized && !hasPendingData;
  const rejectionMessage = status.label === "Rejeitada" ? getMensagemErro(servico.notaFiscalErros) : null;
  const checkboxId = `nfse-servico-${servico.servicoid}`;

  return (
    <article
      className={cn(
        "border border-l-4 bg-card px-4 py-4 shadow-sm transition-colors",
        selected && "border-amber-500 bg-amber-500/[0.04]",
        status.borderClassName,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("rounded-sm font-medium", status.badgeClassName)}>
              <status.Icon aria-hidden="true" className="mr-1 size-3.5" />
              {status.label}
            </Badge>
            {hasPendingData && (
              <Badge variant="outline" className="rounded-sm border-amber-600/25 bg-amber-600/10 text-amber-700 dark:text-amber-400">
                <AlertTriangle aria-hidden="true" className="mr-1 size-3.5" />
                {servico.pendenciasCadastro?.length} {servico.pendenciasCadastro?.length === 1 ? "pendência" : "pendências"}
              </Badge>
            )}
          </div>

          <div>
            <h3 className="truncate text-sm font-semibold text-foreground">
              {servico.servico?.descricao?.trim() || "Descrição não cadastrada"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Serviço #{servico.servicoid}
              {hasValidValue ? ` · ${quantidade} × ${BRL_FORMATTER.format(precoUnitario)}` : " · valor original pendente"}
            </p>
          </div>

          {rejectionMessage && (
            <p className="line-clamp-2 max-w-[72ch] text-xs leading-relaxed text-destructive" role="status">
              {rejectionMessage}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t pt-3 sm:min-w-64 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Valor original</p>
            <p className={cn("mt-1 text-base font-bold tabular-nums", total === null && "text-muted-foreground")}>
              {total === null ? "Definir na revisão" : BRL_FORMATTER.format(total)}
            </p>
          </div>

          <div className="flex min-h-11 items-center gap-3 border px-3">
            <Checkbox
              id={checkboxId}
              checked={selected}
              disabled={!canSelect}
              onCheckedChange={(checked) => onToggle(servico, checked === true)}
            />
            <Label htmlFor={checkboxId} className={cn("cursor-pointer text-sm font-semibold", !canSelect && "cursor-not-allowed text-muted-foreground")}>
              {isAuthorized ? "Já emitido" : isProcessing ? "Processando" : hasPendingData ? "Indisponível" : "Incluir"}
            </Label>
          </div>
        </div>
      </div>
    </article>
  );
}
