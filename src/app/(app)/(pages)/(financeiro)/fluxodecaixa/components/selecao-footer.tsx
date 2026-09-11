"use client";

import { Banknote, CheckCircle2, Loader2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import formatarEmReal from "@/utils/formatarEmReal";

import type { Transaction } from "../types";

/**
 * Rodapé fixo do modo de seleção.
 *
 * Fica acima da lista (z-index alto) e só existe enquanto o modo está ativo. A
 * lista continua rolando atrás, então o usuário vê o que está marcando e o total
 * ao mesmo tempo — que é a razão de a barra ser fixa em vez de um dialog.
 *
 * A barra não decide a ação: ela oferece as que existem, e cada uma diz por si
 * quando não cabe. Dar baixa só vale para título em aberto — marcar uma
 * liquidada apaga o botão, com o motivo no `title`. Desabilitar é certo aqui,
 * ao contrário do alerta de exclusão, que esconde: o botão é o próprio lugar
 * onde a regra se aprende, e desmarcar a liquidada é uma ação que cabe ali.
 *
 * O total soma o **líquido**: é o que de fato entra ou sai da conta. Somar o
 * bruto mostraria um número que não bate com o extrato quando há taxa ou juros.
 */
export function SelecaoFooter({
  selecionadas,
  transacoes,
  processando,
  podeBaixar,
  liquidadas,
  podeDarBaixa,
  podeExcluir,
  onCancelar,
  onConfirmar,
  onAdiantamento,
  onExcluir,
}: {
  selecionadas: Set<number>;
  transacoes: Transaction[];
  processando: boolean;
  /** Toda a seleção está em aberto? */
  podeBaixar: boolean;
  /** Quantas das marcadas já estão liquidadas. Explica o botão apagado. */
  liquidadas: number;
  podeDarBaixa: boolean;
  podeExcluir: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
  onAdiantamento: () => void;
  onExcluir: () => void;
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
      aria-label="Seleção de transações"
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
              Marque as transações e escolha o que fazer com elas.
            </p>
          ) : null}

          {/*
            A composição da seleção, quando ela é mista. É o que explica o botão
            de baixa apagado antes de o usuário passar o mouse nele.
          */}
          {!nada && liquidadas > 0 ? (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Situação
              </p>
              <p className="text-sm tabular-nums">
                {escolhidas.length - liquidadas} em aberto
                <span className="text-muted-foreground"> · {liquidadas} liquidada
                  {liquidadas === 1 ? "" : "s"}</span>
              </p>
            </div>
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
          {podeExcluir ? (
            /*
              Só abre a prévia — não apaga nada. Por isso `outline` com texto
              destrutivo, e não um botão vermelho cheio: quem decide o que sai é
              o diálogo, depois de classificar linha a linha.
            */
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-destructive/40 text-destructive hover:cursor-pointer hover:bg-destructive/10 hover:text-destructive"
              onClick={onExcluir}
              disabled={nada || processando}
              title="Revisar o que acontece antes de excluir"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Excluir
              {escolhidas.length > 0 ? ` (${escolhidas.length})` : ""}
            </Button>
          ) : null}
          {podeDarBaixa ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 hover:cursor-pointer"
            onClick={onAdiantamento}
            disabled={nada || processando || misturado || !podeBaixar}
            title={
              misturado
                ? "Um adiantamento não pode misturar receita e despesa."
                : podeBaixar
                ? "Liquidar tudo por um lançamento único"
                : `${liquidadas} das selecionadas já estão liquidadas — baixa só vale para título em aberto.`
            }
          >
            <Banknote className="h-4 w-4" aria-hidden />
            Baixa adiantamento
          </Button>
          ) : null}
          {podeDarBaixa ? (
          <Button
            size="sm"
            className="h-9 bg-emerald-600 text-white hover:cursor-pointer hover:bg-emerald-700 focus-visible:ring-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            onClick={onConfirmar}
            disabled={nada || processando || !podeBaixar}
            title={
              podeBaixar
                ? undefined
                : `${liquidadas} das selecionadas já estão liquidadas — baixa só vale para título em aberto.`
            }
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
