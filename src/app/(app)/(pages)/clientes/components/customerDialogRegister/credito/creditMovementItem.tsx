"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  autoria,
  descrever,
  documento,
  formatarHora,
  formatarQuando,
  valorSemMoeda,
  type SaldoMovimentoCliente,
} from "./types";

/** Colunas do extrato no desktop: hora, histórico, valor, saldo, ações. */
export const COLUNAS_EXTRATO =
  "sm:grid-cols-[3.5rem_minmax(0,1fr)_7.5rem_7.5rem_2rem]";

type CreditMovementItemProps = {
  movimento: SaldoMovimentoCliente;
  podeAjustar: boolean;
  onEditar: () => void;
  onExcluir: () => void;
  onAbrirDocumento: (doc: NonNullable<ReturnType<typeof documento>>) => void;
};

export function CreditMovementItem({
  movimento,
  podeAjustar,
  onEditar,
  onExcluir,
  onAbrirDocumento,
}: CreditMovementItemProps) {
  const entrada = movimento.sentido === "CREDITO";
  const estorno = movimento.acao === "ESTORNO";
  const manual = movimento.origem === "MANUAL";
  const doc = manual ? null : documento(movimento);
  const autor = autoria(movimento);
  const editavel = manual && movimento.acao === "REGISTRO" && podeAjustar;

  return (
    <li
      className={cn(
        "grid grid-cols-[3rem_minmax(0,1fr)_2rem] gap-x-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6",
        COLUNAS_EXTRATO,
      )}
    >
      <span className="row-start-1 pt-px text-xs tabular-nums text-muted-foreground">
        {formatarHora(movimento.created_at)}
      </span>

      <div className="row-start-1 min-w-0">
        <p className="max-w-[68ch] break-words text-sm leading-relaxed text-foreground">
          {estorno && (
            <Badge
              variant="outline"
              className="mr-1.5 border-amber-300 bg-amber-50 px-1.5 py-0 align-[1px] text-[11px] font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
            >
              Estorno
            </Badge>
          )}
          {descrever(movimento)}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {manual ? (
            <span>Ajuste manual</span>
          ) : doc?.tipo === "venda" ? (
            <button
              type="button"
              onClick={() => onAbrirDocumento(doc)}
              title={`Abrir ${doc.rotulo}. Para desfazer este lançamento, estorne a baixa correspondente.`}
              className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {doc.rotulo}
            </button>
          ) : (
            <span>{doc?.rotulo ?? (movimento.transacao_id ? `Título #${movimento.transacao_id}` : "Baixa de título")}</span>
          )}
          {autor && <span>{autor}</span>}
          {movimento.updated_at && (
            <span>
              Editado{movimento.updated_by_nome ? ` por ${movimento.updated_by_nome}` : ""} em{" "}
              {formatarQuando(movimento.updated_at)}
            </span>
          )}
        </div>
      </div>

      {/* No celular, valor e saldo descem para uma linha própria, alinhada à direita. */}
      <div className="col-start-2 row-start-2 mt-2 flex items-baseline justify-end gap-5 sm:contents">
        <span
          className={cn(
            "text-sm font-medium tabular-nums sm:col-start-3 sm:row-start-1 sm:text-right",
            entrada ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
          )}
        >
          {entrada ? "+" : "−"}
          {valorSemMoeda.format(movimento.valor)}
        </span>
        <span className="text-sm tabular-nums text-foreground sm:col-start-4 sm:row-start-1 sm:text-right">
          <span className="mr-1.5 text-xs text-muted-foreground sm:hidden">Saldo</span>
          {movimento.saldo_resultante != null ? valorSemMoeda.format(movimento.saldo_resultante) : "—"}
        </span>
      </div>

      {editavel && (
        <div className="col-start-3 row-start-1 -mt-1 flex justify-end sm:col-start-5">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                aria-label="Ações do lançamento"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={onEditar}>
                <Pencil className="size-4" aria-hidden="true" />
                Editar lançamento
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onExcluir}>
                <Trash2 className="size-4" aria-hidden="true" />
                Excluir lançamento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}
