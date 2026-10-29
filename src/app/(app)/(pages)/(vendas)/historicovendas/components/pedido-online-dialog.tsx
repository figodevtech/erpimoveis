"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Truck } from "lucide-react";
import { DialogShell } from "@/components/dialog-shell";
import { PedidoOnlineForm } from "./pedido-online-form";

type Props = {
  vendaId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

export function PedidoOnlineDialog({ vendaId, open, onOpenChange, onSaved }: Props) {
  const saveRef = useRef<null | (() => Promise<void>)>(null);

  const [saving, setSaving] = useState(false);
  const [headerData, setHeaderData] = useState<{
    id: number;
    status?: string | null;
    status_entrega?: string | null;
    ultimo_evento_rastreio?: string | null;
  } | null>(null);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          Pedido marketplace{headerData?.id ? ` #${headerData.id}` : ""}
        </span>
      }
      description="Rastreio, entrega e NF-e/DANFE do pedido de marketplace."
      maxW="lg:max-w-5xl xl:max-w-6xl"
      footer={
        <>
          <Button
            variant="outline"
            className="bg-transparent"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>

          <Button onClick={() => saveRef.current?.()} disabled={saving || !headerData}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        </>
      }
    >
      <PedidoOnlineForm
        vendaId={vendaId}
        open={open}
        exposeSave={(fn) => (saveRef.current = fn)}
        onSavingChange={setSaving}
        onDataChange={setHeaderData}
        onSaved={() => onSaved?.()}
        onDone={() => onOpenChange(false)}
      />
    </DialogShell>
  );
}
