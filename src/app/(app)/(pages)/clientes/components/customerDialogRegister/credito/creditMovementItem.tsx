"use client";

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Cog,
  FileText,
  MoreHorizontal,
  Pencil,
  ShoppingCart,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  autoria,
  descrever,
  documento,
  formatarQuando,
  moeda,
  type SaldoMovimentoCliente,
} from "./types";

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
  const temAcoes = editavel || doc !== null;

  const Icone = estorno ? Undo2 : entrada ? ArrowUpRight : ArrowDownLeft;

  const temEvolucao =
    movimento.saldo_anterior != null && movimento.saldo_resultante != null;

  return (
    <li className="group relative transition-colors hover:bg-muted/40">
      <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        {/* Lado Esquerdo: Ícone + Descrição + Badges + Metadados */}
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105 motion-reduce:transition-none",
              estorno
                ? "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                : entrada
                  ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive dark:bg-destructive/20",
            )}
            aria-hidden="true"
          >
            <Icone className="size-5" />
          </span>

          <div className="min-w-0 flex-1 space-y-1">
            {/* Título e Badges da linha */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="font-semibold text-sm leading-snug text-foreground break-words">
                {descrever(movimento)}
              </span>

              {/* Badge de Sentido / Ação */}
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 px-1.5 py-0.5 text-[10px] font-medium sm:text-[11px]",
                  estorno
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                    : entrada
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
                )}
              >
                <Icone className="size-3" aria-hidden="true" />
                {estorno ? "Estorno" : entrada ? "Crédito" : "Débito"}
              </Badge>

              {/* Badge de Origem */}
              {manual ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-border/80 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground sm:text-[11px]"
                >
                  <UserRound className="size-3" aria-hidden="true" />
                  Manual
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="gap-1 px-1.5 py-0.5 text-[10px] font-normal sm:text-[11px]"
                >
                  {doc?.tipo === "venda" ? (
                    <ShoppingCart className="size-3" aria-hidden="true" />
                  ) : doc?.tipo === "os" ? (
                    <FileText className="size-3" aria-hidden="true" />
                  ) : (
                    <Cog className="size-3" aria-hidden="true" />
                  )}
                  {doc ? doc.rotulo : movimento.transacao_id ? `Título #${movimento.transacao_id}` : "Sistema"}
                </Badge>
              )}
            </div>

            {/* Metadados: Data/Hora, Operador e Auditoria */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 tabular-nums">
                <Clock className="size-3" aria-hidden="true" />
                {formatarQuando(movimento.created_at)}
              </span>

              {autor && (
                <span className="inline-flex items-center gap-1">
                  <UserRound className="size-3" aria-hidden="true" />
                  {autor}
                </span>
              )}

              {movimento.updated_at && (
                <span className="italic text-muted-foreground/80">
                  (Editado{movimento.updated_by_nome ? ` por ${movimento.updated_by_nome}` : ""} em{" "}
                  {formatarQuando(movimento.updated_at)})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Lado Direito: Valor Financeiro, Evolução do Saldo e Menu de Ações */}
        <div className="flex shrink-0 items-center justify-between border-t border-border/40 pt-2 sm:border-t-0 sm:pt-0 sm:justify-end sm:gap-3">
          {/* Valores */}
          <div className="text-left sm:text-right">
            <p
              className={cn(
                "text-base font-bold tracking-tight tabular-nums sm:text-lg",
                entrada
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive",
              )}
            >
              {entrada ? "+" : "−"} {moeda.format(movimento.valor)}
            </p>

            {temEvolucao ? (
              <div className="mt-0.5 flex items-center gap-1 text-xs tabular-nums text-muted-foreground sm:justify-end">
                <span>{moeda.format(movimento.saldo_anterior!)}</span>
                <ArrowRight className="size-3 text-muted-foreground/60" aria-hidden="true" />
                <span className="font-semibold text-foreground">
                  {moeda.format(movimento.saldo_resultante!)}
                </span>
              </div>
            ) : movimento.saldo_resultante != null ? (
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                Saldo:{" "}
                <span className="font-semibold text-foreground">
                  {moeda.format(movimento.saldo_resultante)}
                </span>
              </p>
            ) : null}
          </div>

          {/* Menu Dropdown de Ações */}
          {temAcoes && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  aria-label="Ações do lançamento financeiro"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {editavel && (
                  <>
                    <DropdownMenuItem onSelect={onEditar}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Editar lançamento
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onExcluir}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      Excluir lançamento
                    </DropdownMenuItem>
                  </>
                )}
                {doc && (
                  <>
                    <DropdownMenuItem onSelect={() => onAbrirDocumento(doc)}>
                      {doc.tipo === "venda" ? (
                        <ShoppingCart className="size-4" aria-hidden="true" />
                      ) : (
                        <FileText className="size-4" aria-hidden="true" />
                      )}
                      Ver {doc.tipo === "venda" ? "venda" : "OS"} #{doc.id}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      Lançado pelo sistema. Para desfazer, estorne a baixa correspondente.
                    </DropdownMenuLabel>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </li>
  );
}
