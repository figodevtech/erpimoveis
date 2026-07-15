import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, AlertCircle } from "lucide-react";
import { toast } from "@/lib/toast";

interface CancelarNotaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipo: "NFE" | "NFSE";
  id: number;
  onSuccess?: () => void;
}

export function CancelarNotaDialog({
  open,
  onOpenChange,
  tipo,
  id,
  onSuccess,
}: CancelarNotaDialogProps) {
  const [justificativa, setJustificativa] = useState("");
  const [loading, setLoading] = useState(false);

  const endpoint = tipo === "NFE" ? `/api/nfe/cancelar/${id}` : `/api/nfse/cancelar/${id}`;
  const label = tipo === "NFE" ? "NF-e" : "NFS-e";

  const handleHandleCancel = async () => {
    if (justificativa.length < 15) {
      toast.error("A justificativa deve ter no mínimo 15 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ justificativa }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const msg = data?.message || data?.mensagem || "Erro ao realizar o cancelamento.";
        toast.error(msg);
        return;
      }

      toast.success(`${label} enviada para cancelamento com sucesso!`);
      onOpenChange(false);
      setJustificativa("");
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error(`Erro ao cancelar ${label}:`, error);
      toast.error("Ocorreu um erro inesperado ao processar o cancelamento.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Cancelar {label}
          </DialogTitle>
          <DialogDescription>
            Essa ação enviará um pedido de cancelamento para a SEFAZ/Prefeitura.
            Informe o motivo abaixo (mínimo 15 caracteres).
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Textarea
            placeholder="Ex: Nota emitida com valor incorreto / Erro na digitação dos dados do tomador..."
            className="min-h-[100px] resize-none"
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            disabled={loading}
          />
          <div className="mt-1 flex justify-end">
             <span className={`text-[10px] ${justificativa.length < 15 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
               {justificativa.length}/15 caracteres mínimos
             </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="hover:cursor-pointer"
          >
            Voltar
          </Button>
          <Button
            variant="destructive"
            onClick={handleHandleCancel}
            disabled={loading || justificativa.length < 15}
            className="hover:cursor-pointer"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar Cancelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
