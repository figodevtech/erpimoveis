"use client";

import { useState, type ReactNode } from "react";
import { HandCoins } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor || 0);

/**
 * Perdoa um título a receber sem lançar nada no banco. Mora aqui junto do
 * diálogo, como `estornarBaixa` mora com o dele — as telas que listam
 * transação chamam a mesma função.
 */
export async function abonarTransacao(id: number, motivo?: string) {
  const resposta = await fetch(`/api/transaction/${id}/abonar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo: motivo?.trim() || undefined }),
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(corpo?.error ?? "Não foi possível abonar a cobrança.");
  }
  return (corpo?.data ?? {}) as { id: number; abonado?: boolean };
}

/**
 * Confirmação de "Abonar cobrança".
 *
 * Diferente da baixa, não pede banco nem método: o abono não move dinheiro
 * nenhum. O texto precisa deixar isso muito claro, porque na lista o título
 * vai parecer "pago" igual a qualquer outro liquidado — só o badge "Abonado"
 * e este aviso é que contam a diferença.
 */
export function TransactionAbonoAlert({
  children,
  transactionId,
  valor,
  onAbonar,
}: {
  children: ReactNode;
  transactionId: number;
  valor: number;
  onAbonar: (id: number, motivo?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setMotivo("");
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 shrink-0 text-muted-foreground" />
            Abonar cobrança?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <span className="block">
                O saldo de <strong>{moeda(valor)}</strong> é perdoado. Não entra no
                banco nem no fluxo de caixa — mas a OS ou venda continua{" "}
                <strong>quitada</strong>, e o título aparece na aba Liquidadas
                marcado como <strong>Abonado</strong>.
              </span>
              <span className="block text-muted-foreground">
                Pode ser desfeito depois, do mesmo jeito que uma baixa comum.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="abono-motivo">Motivo (opcional)</Label>
          <Textarea
            id="abono-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: acordo com o cliente, cobrança incobrável..."
            rows={3}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onAbonar(transactionId, motivo);
              setOpen(false);
            }}
          >
            Abonar cobrança
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
