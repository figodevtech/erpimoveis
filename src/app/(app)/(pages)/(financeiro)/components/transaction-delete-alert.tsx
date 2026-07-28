"use client";

import { useState, type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

type ImpactTarget = { tipo: "OS" | "VENDA"; id: number };

export function TransactionDeleteAlert({ children, transactionId, onDelete }: {
  children: ReactNode;
  transactionId: number;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [targets, setTargets] = useState<ImpactTarget[]>([]);

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setLoading(true);
    setTargets([]);
    try {
      const response = await fetch(`/api/transaction/${transactionId}/delete-impact`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setTargets(Array.isArray(payload.targets) ? payload.targets : []);
    } finally {
      setLoading(false);
    }
  }

  const hasImpact = targets.length > 0;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{hasImpact ? "Esta exclusão reabrirá um pagamento" : "Excluir transação?"}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {loading ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Verificando o impacto da exclusão...</span>
              ) : hasImpact ? (
                <>
                  <span className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    Ao excluir este pagamento, os valores serão recalculados e {targets.map((target) => `${target.tipo} #${target.id}`).join(" e ")} voltará para o status PAGAMENTO.
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
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={loading} onClick={() => onDelete(transactionId)}>Prosseguir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
