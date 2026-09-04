"use client";

import { useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

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

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor || 0);

/**
 * Tira a transação do fluxo de caixa: desfaz a baixa e devolve o título para em
 * aberto. Mora aqui junto do diálogo, como `excluirPagamentoMultiplo` mora com o
 * seu — as três telas que listam transação chamam a mesma função.
 */
export async function estornarBaixa(id: number) {
  const resposta = await fetch(`/api/transaction/${id}/estornar-baixa`, { method: "POST" });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(corpo?.error ?? "Não foi possível tirar a transação do fluxo de caixa.");
  }
  return (corpo?.data ?? {}) as { acrescimos_removidos?: number };
}

/**
 * Confirmação de "Excluir do fluxo de caixa".
 *
 * Não consulta impacto no servidor, ao contrário da exclusão: tudo o que o
 * aviso precisa dizer já está na linha da tabela. E `delete-impact` exige
 * permissão de exclusão — pedir a conferência por lá negaria a operação a quem
 * só tem edição, que é justamente quem pode estornar.
 *
 * O aviso dos acréscimos não é detalhe: o título não reabre pelo valor que está
 * na tela. Juros e multa vieram do atraso até aquela data de pagamento, e saem
 * junto com ela.
 */
export function TransactionEstornoAlert({
  children,
  transactionId,
  sentido,
  valorReaberto,
  acrescimos = 0,
  abonado = false,
  creditoCliente = false,
  onEstornar,
}: {
  children: ReactNode;
  transactionId: number;
  sentido: "RECEBER" | "PAGAR";
  valorReaberto: number;
  acrescimos?: number;
  /** Nunca passou pelo banco — foi perdoado, não pago. Troca o aviso inteiro. */
  abonado?: boolean;
  /** Pago com a carteira do cliente: estornar devolve o crédito para ela. */
  creditoCliente?: boolean;
  onEstornar: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const destino = sentido === "PAGAR" ? "a pagar" : "a receber";

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {abonado
              ? "Desfazer abono?"
              : creditoCliente
                ? "Devolver o crédito ao cliente?"
                : "Tirar do fluxo de caixa?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  {abonado ? (
                    <>
                      Este título foi <strong>abonado</strong> — nunca passou pelo
                      banco nem pelo fluxo de caixa. Desfazer devolve o título para{" "}
                      <strong>{destino}</strong>, no vencimento original.
                    </>
                  ) : creditoCliente ? (
                    <>
                      Este título foi quitado com o <strong>crédito do cliente</strong>.
                      O valor volta para a carteira dele e o título fica{" "}
                      <strong>{destino}</strong> de novo, no vencimento original. Nenhuma
                      conta bancária se move.
                    </>
                  ) : (
                    <>
                      O pagamento sai do caixa e o título volta a ficar{" "}
                      <strong>{destino}</strong>, no vencimento original. O saldo do
                      banco muda junto.
                    </>
                  )}
                </span>
              </span>
              {acrescimos > 0 ? (
                <span className="block">
                  Os juros lançados na baixa saem com ela: o título reabre valendo{" "}
                  <strong>{moeda(valorReaberto)}</strong>, sem os {moeda(acrescimos)} de
                  acréscimo.
                </span>
              ) : (
                <span className="block">
                  O título reabre valendo <strong>{moeda(valorReaberto)}</strong>.
                </span>
              )}
              <span className="block">
                {abonado
                  ? "O abono continua registrado no histórico, e o estorno entra ao lado dele."
                  : creditoCliente
                    ? "A baixa continua no histórico, e a devolução entra como uma nova linha no extrato de crédito do cliente."
                    : "A baixa continua registrada no histórico, e o estorno entra ao lado dela."}
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => onEstornar(transactionId)}>
            {abonado
              ? "Desfazer abono"
              : creditoCliente
                ? "Devolver o crédito"
                : "Tirar do fluxo de caixa"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
