"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { Loader2, XCircle } from "lucide-react";
import { CancelarNotaDialog } from "./cancelar-nota-dialog";

type Props = {
  nfeId: number;
  status: string;
  /**
   * Callback opcional pra o componente pai (EmissaoNotaDialog)
   * recarregar a lista de NF-e sem dar reload na página toda.
   */
  onAfterCancel?: () => void;
};

export function CancelarNfeButton({ nfeId, status, onAfterCancel }: Props) {
  const loading = false;

  const statusUpper = (status || "").toUpperCase();
  const disabled = statusUpper !== "AUTORIZADA" || loading;
  function handleClick() {
    if (statusUpper !== "AUTORIZADA") {
      toast.error("Apenas NF-e AUTORIZADA pode ser cancelada.");
      return;
    }
    setOpenCancelDialog(true);
  }

  const [openCancelDialog, setOpenCancelDialog] = useState(false);

  return (
    <>
      <Button
        size="sm"
        onClick={handleClick}
        disabled={disabled}
        className="size-full flex items-center gap-1 text-xs justify-start px-0 rounded-sm py-2 hover:cursor-pointer not-dark:text-gray-800 bg-red-500/20 hover:bg-red-900 group hover:text-white transition-all"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Cancelando...
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4" />
            Cancelar NF-e
          </>
        )}
      </Button>

      <CancelarNotaDialog
        open={openCancelDialog}
        onOpenChange={setOpenCancelDialog}
        tipo="NFE"
        id={nfeId}
        onSuccess={onAfterCancel}
      />
    </>
  );
}
