"use client";

import { Banknote, CheckCircle2, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import formatarEmReal from "@/utils/formatarEmReal";

import type { Transaction } from "../types";

/**
 * Rodapé fixo da baixa múltipla.
 *
 * Fica acima da lista (z-index alto) e só existe enquanto o modo está ativo. A
 * lista continua rolando atrás, então o usuário vê o que está marcando e o total
 * ao mesmo tempo — que é a razão de a barra ser fixa em vez de um dialog.
 *
 * O total soma o **líquido**: é o que de fato entra ou sai da conta. Somar o
 * bruto mostraria um número que não bate com o extrato quando há taxa ou juros.
 */
export function BaixaMultiplaFooter({
  selecionadas,
  transacoes,
  processando,
  onCancelar,
  onConfirmar,
  onAdiantamento,
}: {
  selecionadas: Set<number>;
  transacoes: Transaction[];
  processando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
  onAdiantamento: () => void;
}) {
  const escolhidas = transacoes.filter((t) => selecionadas.has(t.id));

  // Receita e despesa somam para lados opostos; misturar num total só esconderia
  // o que está sendo feito. A barra mostra os dois separados.
  const receitas = escolhidas.filter((t) => String(t.tipo).toUpperCase() === "RECEITA");
  const despesas = escolhidas.filter((t) => String(t.tipo).toUpperCase() === "DESPESA");

  const somar = (linhas: Transaction[]) =>
    linhas.reduce((total, t) => total + Math.round(valorLiquidoEfetivo(t) * 100), 0) / 100;

  const totalReceitas = somar(receitas);
  const totalDespesas = somar(despesas);
  const nada = escolhidas.length === 0;
  const misturado = receitas.length > 0 && despesas.length > 0;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-card/95 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.35)] backdrop-blur supports-[backdrop-filter]:bg-card/85"
      role="region"
      aria-label="Baixa múltipla"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Selecionadas
            </p>
            <p className="text-sm font-semibold tabular-nums">
              {escolhidas.length}{" "}
              <span className="font-normal text-muted-foreground">
                de {transacoes.length} na página
              </span>
            </p>
          </div>

          {receitas.length > 0 ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                A receber ({receitas.length})
              </p>
              <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatarEmReal(totalReceitas)}
              </p>
            </div>
          ) : null}

          {despesas.length > 0 ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                A pagar ({despesas.length})
              </p>
              <p className="text-sm font-semibold tabular-nums text-destructive">
                {formatarEmReal(totalDespesas)}
              </p>
            </div>
          ) : null}

          {nada ? (
            <p className="text-sm text-muted-foreground">
              Marque as transações que deseja dar baixa.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 hover:cursor-pointer"
            onClick={onCancelar}
            disabled={processando}
          >
            <X className="h-4 w-4" />
            Cancelar
          </Button>
          {/*
            Antecipação exige um sentido só: o dinheiro entra ou sai, e um
            lançamento único não representa os dois. Misturar receita e despesa
            desabilita o botão aqui, e a RPC recusa de qualquer forma.
          */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 hover:cursor-pointer"
            onClick={onAdiantamento}
            disabled={nada || processando || misturado}
            title={
              misturado
                ? "Um adiantamento não pode misturar receita e despesa."
                : "Liquidar tudo por um lançamento único"
            }
          >
            <Banknote className="h-4 w-4" aria-hidden />
            Baixa adiantamento
          </Button>
          <Button
            size="sm"
            className="h-9 bg-emerald-600 text-white hover:cursor-pointer hover:bg-emerald-700 focus-visible:ring-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            onClick={onConfirmar}
            disabled={nada || processando}
          >
            {processando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Dando baixa...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Confirmar baixa
                {escolhidas.length > 0 ? ` (${escolhidas.length})` : ""}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
