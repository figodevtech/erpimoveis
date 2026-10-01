"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { cn } from "@/lib/utils";
import { efeito, moeda, valorSemMoeda, type ModoLancamento, type Sentido } from "./types";

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
      ? "Adicionar crédito"
      : "Remover crédito";

  return (
    <AlertDialog
      open={modo !== null}
      onOpenChange={(next) => {
        if (!next && !salvando) onFechar();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>
            {editando
              ? "O lançamento é corrigido no extrato e o saldo das linhas seguintes é recalculado."
              : adicionando
                ? "O valor entra na carteira e pode abater cobranças de OS e vendas deste cliente."
                : "O valor sai da carteira e deixa de estar disponível para abatimentos."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {editando && (
            <div
              className="grid grid-cols-2 rounded-lg bg-muted p-1"
              role="radiogroup"
              aria-label="Tipo do lançamento"
            >
              {(["CREDITO", "DEBITO"] as const).map((opcao) => {
                const ativo = sentido === opcao;
                return (
                  <button
                    key={opcao}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    disabled={salvando}
                    onClick={() => setSentido(opcao)}
                    className={cn(
                      "min-h-9 rounded-md text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      ativo
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opcao === "CREDITO" ? "Adicionar" : "Remover"}
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ajuste-valor">Valor</Label>
            <ValueInput
              id="ajuste-valor"
              value={valor}
              onValueChange={setValor}
              disabled={salvando}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ajuste-motivo">
              Motivo <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              id="ajuste-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                adicionando
                  ? "Ex.: troco excedente, adiantamento, crédito acordado em negociação"
                  : "Ex.: crédito usado em negociação fora do sistema"
              }
              rows={3}
              disabled={salvando}
            />
          </div>

          {/* A conta do ajuste, no mesmo vocabulário do extrato. */}
          <dl className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm tabular-nums">
            <div className="flex justify-between gap-4 py-0.5">
              <dt className="text-muted-foreground">{editando ? "Saldo sem este lançamento" : "Saldo atual"}</dt>
              <dd>{valorSemMoeda.format(saldoBase)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-0.5">
              <dt className="text-muted-foreground">{adicionando ? "Adicionar" : "Remover"}</dt>
              <dd className={adicionando ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                {adicionando ? "+" : "−"}
                {valorSemMoeda.format(valor)}
              </dd>
            </div>
            <div className="mt-1.5 flex justify-between gap-4 border-t pt-2 font-semibold">
              <dt>Novo saldo</dt>
              <dd className={cn(excede && "text-destructive")}>{moeda.format(saldoDepois)}</dd>
            </div>
          </dl>

          {excede && (
            <p className="text-sm text-destructive" role="alert">
              O valor passa do saldo disponível de {moeda.format(saldoBase)}. Remova no máximo esse valor.
            </p>
          )}
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel disabled={salvando}>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            variant={!adicionando && !editando ? "destructive" : "default"}
            disabled={salvando || valor <= 0 || excede}
            onClick={() => onConfirmar({ sentido, valor, motivo })}
            className="gap-2"
          >
            {salvando && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {salvando ? "Salvando…" : editando ? "Salvar alterações" : titulo}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
