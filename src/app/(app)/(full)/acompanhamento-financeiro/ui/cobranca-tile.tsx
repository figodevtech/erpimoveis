"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ShoppingBag, Wrench } from "lucide-react";
import type { CobrancaItem } from "../lib/api";

const real = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function textoNormalizado(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export default function CobrancaTile({
  item,
  situacao,
}: {
  item: CobrancaItem;
  situacao: "AGUARDANDO" | "RECEBIDO";
}) {
  const quitado = item.total > 0 && item.pago >= item.total - 0.009;
  const parcial = item.pago > 0 && !quitado;
  const cardClass = {
    AGUARDANDO:
      "border-sky-500/30 bg-sky-50 shadow-sm shadow-sky-950/5 dark:bg-sky-950/35 dark:shadow-black/20",
    RECEBIDO:
      "border-emerald-500/30 bg-emerald-50 shadow-sm shadow-emerald-950/5 dark:bg-emerald-950/30 dark:shadow-black/20",
  }[situacao];
  const progressClass = situacao === "RECEBIDO"
    ? "border-emerald-500/30 bg-emerald-950/15 [&>div]:bg-emerald-500 dark:bg-black/35"
    : parcial
      ? "border-amber-500/35 bg-amber-950/15 [&>div]:bg-amber-500 dark:bg-black/35"
      : "border-sky-500/30 bg-sky-950/15 [&>div]:bg-sky-500 dark:bg-black/35";
  const detalhe = item.referencia || item.descricao;
  const mostrarDetalhe =
    Boolean(detalhe) &&
    textoNormalizado(detalhe) !== textoNormalizado(item.cliente) &&
    !textoNormalizado(detalhe).includes(textoNormalizado(item.cliente));

  return (
    <Card className={`gap-3 border p-3 transition-all hover:-translate-y-0.5 hover:shadow-md ${cardClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={item.origem === "OS"
                ? "border-sky-500/30 bg-sky-500/10 text-sky-500"
                : "border-violet-500/30 bg-violet-500/10 text-violet-500"}
            >
              {item.origem === "OS" ? <Wrench className="mr-1 h-3 w-3" /> : <ShoppingBag className="mr-1 h-3 w-3" />}
              {item.origem} #{item.id}
            </Badge>
            <Badge
              variant="outline"
              className={quitado
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : parcial
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                  : "border-muted-foreground/25 text-muted-foreground"}
            >
              {quitado ? "Recebido" : parcial ? `${item.percentual}% pago` : "Aguardando"}
            </Badge>
          </div>
          <p className="mt-2 truncate text-sm font-semibold" title={item.cliente}>{item.cliente}</p>
          {mostrarDetalhe ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {detalhe}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums">{real.format(quitado ? item.pago : item.saldo)}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{quitado ? "recebido" : "em aberto"}</p>
        </div>
      </div>

      <div className="space-y-1">
        <Progress
          value={item.total > 0 ? item.percentual : 0}
          className={`h-3 border shadow-inner ${progressClass}`}
        />
        <div className="flex justify-between text-xs font-semibold tabular-nums">
          <span className={parcial || quitado ? "text-foreground" : "text-muted-foreground"}>
            Pago: {real.format(item.pago)}
          </span>
          <span className="text-foreground">Total: {real.format(item.total)}</span>
        </div>
      </div>

    </Card>
  );
}
