"use client";

import { useState, type ReactNode } from "react";
import { Ban, Loader2, TriangleAlert } from "lucide-react";

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

type ImpactTarget = { tipo: "OS" | "VENDA"; id: number };
type Bloqueio = { bloqueado: true; motivo: string; quantidade?: number };

/**
 * Confirmação de exclusão de transação.
 *
 * A verificação de impacto pode chegar a três respostas, e as três precisam
 * aparecer:
 *
 *   - **bloqueio**: a transação faz parte de uma antecipação e não sai;
 *   - **impacto**: a exclusão reabre uma OS ou venda já concluída;
 *   - **sem impacto**: sai sem mexer em documento nenhum.
 *
 * Havia uma quarta, invisível: quando a verificação **falhava**, o componente
 * caía no texto de "sem impacto" e o usuário confirmava achando que estava
 * verificado. Falha agora é um estado próprio, e o botão sai do caminho fácil.
 */
export function TransactionDeleteAlert({
  children,
  transactionId,
  onDelete,
}: {
  children: ReactNode;
  transactionId: number;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [targets, setTargets] = useState<ImpactTarget[]>([]);
  const [bloqueio, setBloqueio] = useState<Bloqueio | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;

    setLoading(true);
    setTargets([]);
    setBloqueio(null);
    setFalhou(null);

    try {
      const response = await fetch(`/api/transaction/${transactionId}/delete-impact`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFalhou(payload?.error ?? "Não foi possível verificar o impacto da exclusão.");
        return;
      }

      setTargets(Array.isArray(payload.targets) ? payload.targets : []);
      setBloqueio(payload?.adiantamento?.bloqueado ? payload.adiantamento : null);
    } catch {
      setFalhou("Não foi possível verificar o impacto da exclusão.");
    } finally {
      setLoading(false);
    }
  }

  const hasImpact = targets.length > 0;
  const titulo = bloqueio
    ? "Esta transação não pode ser excluída"
    : falhou
      ? "Não foi possível verificar"
      : hasImpact
        ? "Esta exclusão reabrirá um pagamento"
        : "Excluir transação?";

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Verificando o impacto da
                  exclusão...
                </span>
              ) : bloqueio ? (
                <span className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                  <Ban className="mt-0.5 h-4 w-4 shrink-0" />
                  {bloqueio.motivo}
                </span>
              ) : falhou ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {falhou}
                  </span>
                  <span>
                    Sem essa conferência não dá para saber se a exclusão reabre uma OS ou
                    venda. Feche e tente de novo.
                  </span>
                </>
              ) : hasImpact ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    Ao excluir este pagamento, os valores serão recalculados e{" "}
                    {targets.map((target) => `${target.tipo} #${target.id}`).join(" e ")}{" "}
                    voltará para o status PAGAMENTO.
                  </span>
                  <span>Deseja realmente prosseguir? Esta ação não pode ser desfeita.</span>
                </>
              ) : (
                <span>Esta ação não pode ser desfeita e removerá a transação.</span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{bloqueio ? "Fechar" : "Cancelar"}</AlertDialogCancel>
          {/*
            Bloqueio esconde o botão em vez de desabilitá-lo: não há o que
            prosseguir, e um botão apagado convida a insistir. Falha na
            verificação apenas desabilita — o problema pode ser momentâneo.
          */}
          {bloqueio ? null : (
            <AlertDialogAction
              disabled={loading || Boolean(falhou)}
              onClick={() => onDelete(transactionId)}
            >
              Prosseguir
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
