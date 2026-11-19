"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
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
import { endpoint } from "./model";
import { requestJson } from "./shared";

/**
 * Confirmação de "Concluir limpeza" do imóvel (cadastro e lista de imóveis): conclui a limpeza
 * pendente dele, como faria o responsável na Execução.
 */
export function ConcluirLimpezaDialog({
  imovel,
  onClose,
  onDone,
}: {
  /** Imóvel em LIMPEZA; sem ele, o diálogo fica fechado. */
  imovel: { id: number; titulo?: string | null } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const titulo = imovel?.titulo?.trim() || (imovel ? `Imóvel #${imovel.id}` : "");

  const concluir = async () => {
    if (!imovel) return;
    setBusy(true);
    try {
      await requestJson(`${endpoint("imoveis", imovel.id)}/limpeza/concluir`, { method: "POST", body: "{}" });
      toast.success("Limpeza concluída", { description: `${titulo} saiu da situação Limpeza.` });
      onDone();
    } catch (error) {
      toast.error("Não foi possível concluir a limpeza", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={Boolean(imovel)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Concluir limpeza</AlertDialogTitle>
          <AlertDialogDescription>
            {titulo} deixa a situação Limpeza e volta a ficar pronto para o próximo hóspede. A limpeza sai
            da Execução do responsável.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={busy} className="hover:cursor-pointer w-full sm:w-auto">
            Voltar
          </AlertDialogCancel>
          {/* Botão comum, e não AlertDialogAction: o diálogo só fecha depois da resposta. */}
          <Button onClick={() => void concluir()} disabled={busy} className="gap-1.5 hover:cursor-pointer w-full sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Concluir limpeza
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
