"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Lote } from "../types";
import RegistrarLote from "./registrar-lote";
import EditarLote from "./editar-lote";

type DialogLoteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loteId?: number;
  onSaved?: () => void;
};

export function DialogLote({ open, onOpenChange, loteId, onSaved }: DialogLoteProps) {
  const [novoLote, setNovoLote] = React.useState<Lote>({});

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setNovoLote({});
      }}
    >
      {loteId ? (
        <EditarLote loteId={loteId} isOpen={open} onUpdated={onSaved} />
      ) : (
        <RegistrarLote
          novoLote={novoLote}
          setNovoLote={setNovoLote}
          isOpen={open}
          onRegister={() => {
            onSaved?.();
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}
