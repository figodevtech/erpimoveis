"use client";

import { QuadItem } from "../lib/api";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { CarFront, Wrench, Clock, Building2 } from "lucide-react";

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function statusColors(s?: string | null) {
  const k = (s || "").toUpperCase();

  if (k === "ORCAMENTO" || k === "ORCAMENTO_RECUSADO") return "bg-amber-600/15 text-amber-400 border-amber-600/30";
  if (k === "APROVACAO_ORCAMENTO" || k === "ORCAMENTO_APROVADO")
    return "bg-yellow-600/15 text-yellow-400 border-yellow-600/30";
  if (k === "EM_ANDAMENTO") return "bg-sky-600/15 text-sky-400 border-sky-600/30";
  if (k === "PAGAMENTO") return "bg-fuchsia-600/15 text-fuchsia-400 border-fuchsia-600/30";
  if (k === "CONCLUIDO") return "bg-emerald-600/15 text-emerald-400 border-emerald-600/30";
  if (k === "CANCELADO") return "bg-rose-600/15 text-rose-400 border-rose-600/30";
  return "bg-zinc-600/15 text-zinc-200 border-zinc-600/30";
}

function prioridadePill(p?: "BAIXA" | "NORMAL" | "ALTA" | null) {
  if (p === "ALTA") return "bg-rose-600/15 text-rose-400 border-rose-600/30";
  if (p === "BAIXA") return "bg-zinc-600/10 text-zinc-300 border-zinc-600/20";
  return "bg-indigo-600/10 text-indigo-300 border-indigo-600/20";
}

function hhmmssFromMs(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function diffHHMMSS(inicioIso?: string | null, fimIso?: string | null, nowMs?: number) {
  if (!inicioIso) return "—";
  const ini = new Date(inicioIso).getTime();
  const fim = fimIso ? new Date(fimIso).getTime() : (nowMs ?? Date.now());
  return hhmmssFromMs(Math.max(0, fim - ini));
}

function tempoExecucaoTecnica(os: QuadItem, nowMs?: number) {
  const st = (os.status || "").toUpperCase();

  if (os.execucaoInicioEm) {
    if (st === "EM_ANDAMENTO") return diffHHMMSS(os.execucaoInicioEm, null, nowMs);
    if (os.execucaoFimEm) return diffHHMMSS(os.execucaoInicioEm, os.execucaoFimEm, nowMs);
  }

  if (st === "EM_ANDAMENTO") return diffHHMMSS(os.dataEntrada, null, nowMs);

  return "—";
}

export default function OsTile({ os, now, compact = false }: { os: QuadItem; now?: number; compact?: boolean }) {
  const isPeca = os.alvoTipo === "PECA";

  const tituloPrincipal = isPeca
    ? os.peca?.titulo || "Peça"
    : [os.veiculo?.marca, os.veiculo?.modelo].filter(Boolean).join(" ");

  const secundaria = isPeca ? os.peca?.descricao || "" : [os.veiculo?.cor].filter(Boolean).join(" • ");
  const placaBadge = !isPeca ? os.veiculo?.placa || "" : "";
  const lacreBadge = isPeca ? os.peca?.lacre || "" : "";

  const statusLabel = (os.status || "—").replace(/_/g, " ");
  const statusKey = (os.status || "").toUpperCase();

  const emAndamento = statusKey === "EM_ANDAMENTO";
  const temExecucaoSalva = Boolean(os.execucaoInicioEm && os.execucaoFimEm);

  const tempo = tempoExecucaoTecnica(os, now);

  const produtos = (os.produtos ?? []).slice(0, 3);
  const servicos = (os.servicos ?? []).slice(0, 3);
  const temItens = (os.produtos?.length ?? 0) > 0 || (os.servicos?.length ?? 0) > 0;

  return (
    <Card className={cx("border border-muted bg-primary/1 hover:bg-primary/3 transition-all gap-2", compact ? "p-3" : "p-3.5")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx("font-semibold text-muted-foreground", compact ? "text-xs" : "text-sm")}>
              OS {os.id}
            </span>

            <Badge variant="outline" className={cx("border", compact ? "text-xs" : "text-xs", statusColors(os.status))}>
              {statusLabel}
            </Badge>

            {os.prioridade ? (
              <Badge
                variant="outline"
                className={cx("border", compact ? "text-xs" : "text-xs", prioridadePill(os.prioridade))}
              >
                {os.prioridade}
              </Badge>
            ) : null}
          </div>

          <p
            className={cx(
              "mt-1 truncate font-semibold tracking-tight leading-tight",
              compact ? "text-base" : "text-base",
            )}
          >
            {tituloPrincipal || "—"}
          </p>

          {secundaria ? (
            <p className={cx("truncate text-muted-foreground", compact ? "text-sm" : "text-sm")}>{secundaria}</p>
          ) : null}

          {(placaBadge && !isPeca) || (lacreBadge && isPeca) ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {placaBadge ? (
                <Badge
                  variant="default"
                  className="text-[11px] font-semibold uppercase tracking-wide bg-primary text-primary-foreground border-primary"
                >
                  Placa: {placaBadge}
                </Badge>
              ) : null}
              {lacreBadge ? (
                <Badge
                  variant="outline"
                  className="text-[11px] font-semibold uppercase tracking-wide border-amber-500/60 bg-amber-500/15 text-muted-foreground"
                >
                  Identificação: {lacreBadge}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <div className={cx("inline-flex items-center gap-1 text-muted-foreground", compact ? "text-xs" : "text-sm")}>
            <Clock className={cx(compact ? "h-4 w-4" : "h-4 w-4")} />
            <span
              className={cx(
                (emAndamento || temExecucaoSalva) && tempo !== "—" ? "font-mono font-semibold text-foreground" : "",
              )}
            >
              {tempo}
            </span>
          </div>

          {emAndamento ? <div className="mt-0.5 text-xs text-muted-foreground">Tempo em execução</div> : null}
          {!emAndamento && temExecucaoSalva ? (
            <div className="mt-0.5 text-xs text-muted-foreground">Tempo de execução</div>
          ) : null}
        </div>
      </div>

      <div className={cx("mt-2.5 grid grid-cols-1 gap-2 text-muted-foreground", compact ? "text-sm" : "text-sm")}>
        {/* <div className="flex items-center gap-2">
          <User2 className="h-4 w-4" />
          <span className="truncate">{os.cliente?.nome ?? "—"}</span>
        </div> */}

        {os.setor?.nome ? (
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span className="truncate">{os.setor.nome}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {isPeca ? <Wrench className="h-4 w-4" /> : <CarFront className="h-4 w-4" />}
          <span className="truncate">{isPeca ? "Ordem de peça" : "Ordem de veículo"}</span>
        </div>
      </div>

      {temItens ? (
        <div className="mt-3 rounded-md border border-amber-600/20 bg-amber-600/10 p-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Itens do orçamento</div>

          {produtos.length ? (
            <div className="mt-2">
              <div className="text-xs font-semibold text-muted-foreground">Produtos</div>
              <ul className="mt-1 space-y-1 text-sm text-primary/90">
                {produtos.map((p, i) => (
                  <li key={`p-${i}`} className="truncate">
                    • {p.quantidade ?? 1}x {p.produto?.titulo ?? "Produto"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {servicos.length ? (
            <div className={cx("mt-3", !produtos.length && "mt-2")}>
              <div className="text-xs font-semibold text-muted-foreground">Serviços</div>

              <ul className="mt-1 space-y-1 text-sm text-primary/90">
                {servicos.map((s: any, i) => (
                  <li key={`s-${i}`} className="min-w-0 flex items-center gap-2">
                    <span className="min-w-0 truncate">
                      • {s.quantidade ?? 1}x {s.servico?.descricao ?? "Serviço"}
                    </span>

                    {s.realizador?.nome ? (
                      <Badge variant="destructive" className="shrink-0 text-xs">
                        {s.realizador.nome}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
