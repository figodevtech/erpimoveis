"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  WalletCards,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { cn } from "@/lib/utils";
import { efeito, moeda, type ModoLancamento, type Sentido } from "./types";

type CreditAdjustmentDialogProps = {
  modo: ModoLancamento | null;
  saldoAtual: number;
  salvando: boolean;
  onFechar: () => void;
  onConfirmar: (dados: { sentido: Sentido; valor: number; motivo: string }) => void;
};

export function CreditAdjustmentDialog({
  modo,
  saldoAtual,
  salvando,
  onFechar,
  onConfirmar,
}: CreditAdjustmentDialogProps) {
  const original = modo?.tipo === "editar" ? modo.movimento : null;
  const [sentido, setSentido] = useState<Sentido>(
    original?.sentido ?? (modo?.tipo === "criar" ? modo.sentido : "CREDITO"),
  );
  const [valor, setValor] = useState(original?.valor ?? 0);
  const [motivo, setMotivo] = useState(original?.motivo ?? "");

  const editando = original !== null;
  const adicionando = sentido === "CREDITO";

  // Na edição, o saldo de hoje já contém o lançamento original: tira ele e põe o novo.
  const saldoBase = original ? saldoAtual - efeito(original.sentido, original.valor) : saldoAtual;
  const saldoDepois = saldoBase + efeito(sentido, valor);
  const excede = saldoDepois < 0;

  const titulo = editando
    ? "Editar lançamento"
    : adicionando
      ? "Adicionar crédito à carteira"
      : "Remover crédito da carteira";

  return (
    <AlertDialog
      open={modo !== null}
      onOpenChange={(next) => {
        if (!next && !salvando) onFechar();
      }}
    >
      <AlertDialogContent className="max-w-md sm:max-w-lg">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-lg",
                adicionando
                  ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive",
              )}
              aria-hidden="true"
            >
              {adicionando ? (
                <ArrowUpRight className="size-4" />
              ) : (
                <ArrowDownLeft className="size-4" />
              )}
            </span>
            <AlertDialogTitle className="text-lg font-semibold">{titulo}</AlertDialogTitle>
          </div>

          <AlertDialogDescription asChild>
            <p className="text-xs text-muted-foreground sm:text-sm">
              {editando
                ? "O lançamento será corrigido no extrato e o saldo das linhas posteriores será recalculado."
                : adicionando
                  ? "O crédito entrará na carteira do cliente e poderá ser usado para abater futuras ordens ou vendas."
                  : "O valor será debitado da carteira do cliente, diminuindo o saldo disponível."}
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-1">
          {/* Alternância de Tipo (se editando) */}
          {editando && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Tipo de operação</Label>
              <div
                className="grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="Tipo do lançamento"
              >
                {(["CREDITO", "DEBITO"] as const).map((opcao) => {
                  const ativo = sentido === opcao;
                  const Icone = opcao === "CREDITO" ? ArrowUpRight : ArrowDownLeft;
                  return (
                    <Button
                      key={opcao}
                      type="button"
                      role="radio"
                      aria-checked={ativo}
                      variant={ativo ? "default" : "outline"}
                      className="min-h-10 gap-2"
                      disabled={salvando}
                      onClick={() => setSentido(opcao)}
                    >
                      <Icone className="size-4" aria-hidden="true" />
                      {opcao === "CREDITO" ? "Adicionar (Crédito)" : "Remover (Débito)"}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resumo Financeiro da Operação: Saldo atual -> Novo saldo */}
          <div className="rounded-xl border bg-muted/40 p-4">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground mb-2">
              <span className="flex items-center gap-1.5">
                <WalletCards className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Impacto no saldo da carteira
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-medium",
                  adicionando
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
                )}
              >
                {adicionando ? "Entrada" : "Saída"}
              </Badge>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pt-1">
              <div>
                <span className="block text-[11px] text-muted-foreground">Saldo atual</span>
                <span className="text-base font-semibold tabular-nums text-foreground sm:text-lg">
                  {moeda.format(saldoAtual)}
                </span>
              </div>

              <div className="flex items-center justify-center px-1 text-muted-foreground/60">
                <ArrowRight className="size-4" aria-hidden="true" />
              </div>

              <div className="text-right">
                <span className="block text-[11px] text-muted-foreground">Após o ajuste</span>
                <span
                  className={cn(
                    "text-base font-bold tabular-nums sm:text-lg",
                    excede
                      ? "text-destructive"
                      : adicionando
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-foreground",
                  )}
                >
                  {moeda.format(saldoDepois)}
                </span>
              </div>
            </div>

            {/* Aviso de saldo insuficiente ao debitar */}
            {excede && (
              <div
                className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
                role="alert"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                <p>
                  O saldo ficaria negativo em <strong className="tabular-nums">{moeda.format(saldoDepois)}</strong>. Não é permitido remover um valor superior ao saldo disponível na carteira ({moeda.format(saldoAtual)}).
                </p>
              </div>
            )}
          </div>

          {/* Campo de Valor */}
          <div className="space-y-1.5">
            <Label htmlFor="ajuste-valor" className="text-sm font-medium">
              Valor da operação <span className="text-destructive">*</span>
            </Label>
            <ValueInput
              id="ajuste-valor"
              value={valor}
              onValueChange={setValor}
              disabled={salvando}
              autoFocus
            />
          </div>

          {/* Campo de Motivo */}
          <div className="space-y-1.5">
            <Label htmlFor="ajuste-motivo" className="text-sm font-medium">
              Motivo ou justificativa <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Textarea
              id="ajuste-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                adicionando
                  ? "Ex.: Troco excedente de pagamento, adiantamento, crédito acordado em negociação..."
                  : "Ex.: Crédito utilizado em negociação externa, estorno de lançamento anterior..."
              }
              rows={3}
              disabled={salvando}
            />
          </div>
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel disabled={salvando}>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            disabled={salvando || valor <= 0 || excede}
            onClick={() => onConfirmar({ sentido, valor, motivo })}
            className={cn(!adicionando && !editando && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {salvando ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" />
                Salvando…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4 mr-2" aria-hidden="true" />
                {editando
                  ? "Salvar alterações"
                  : adicionando
                    ? "Confirmar crédito"
                    : "Confirmar débito"}
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
