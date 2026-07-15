"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { Loader2, Trash2 } from "lucide-react";

type Props = {
  nfeId: number;
  status: string;
  /**
   * Callback para o pai recarregar a lista de NF-e
   * após exclusão bem-sucedida.
   */
  onAfterDelete?: () => void;
};

export function ExcluirRascunhoNfeButton({
  nfeId,
  status,
  onAfterDelete,
}: Props) {
  const [loading, setLoading] = useState(false);

  const statusUpper = (status || "").toUpperCase();
  const disabled = statusUpper !== "RASCUNHO" || loading;

  async function handleClick() {
    if (statusUpper !== "RASCUNHO") {
      toast.error("Apenas NF-e em RASCUNHO pode ser excluída.");
      return;
    }

    const confirmado = window.confirm(
      "Tem certeza que deseja excluir este rascunho de NF-e?\nEssa ação não poderá ser desfeita."
    );

    if (!confirmado) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/nfe/deletar-rascunho/${nfeId}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const msg =
          data?.message ||
          data?.mensagem ||
          "Falha ao excluir o rascunho da NF-e.";
        toast.error(msg);
        return;
      }

      toast.success(
        data.mensagem || data.message || "Rascunho de NF-e excluído com sucesso."
      );

      if (onAfterDelete) {
        onAfterDelete();
      }
    } catch (e: any) {
      console.error("[ExcluirRascunhoNfeButton] erro inesperado:", e);
      toast.error("Erro inesperado ao excluir o rascunho da NF-e.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      disabled={disabled}
      onClick={handleClick}
      className="size-full flex items-center gap-1 text-xs justify-start px-0 rounded-sm py-2 hover:cursor-pointer not-dark:text-gray-800 bg-red-500/20 hover:bg-red-900 group hover:text-white transition-all"
    >
      {loading ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Excluindo...
        </>
      ) : (
        <>
          <Trash2 className="h-3 w-3" />
          Excluir rascunho
        </>
      )}
    </Button>
  );
}
