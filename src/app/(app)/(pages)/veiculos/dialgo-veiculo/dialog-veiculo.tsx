"use client";

import { type ReactNode, useState } from "react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import type { Veiculo } from "../types";
import RegisterContent from "./registrar-veiculo";
import EditContent from "./editar-veiculo";

interface CustomerDialogProps {
  veiculoId?: number;
  children?: ReactNode;
  isOpen: boolean;
  setIsOpen?: (value: boolean) => void;
  setSelectedVeiculoId?: (value: number | undefined) => void;
  onRegister?: (c: Veiculo) => void;
  clienteId?: number;
}

export function VeiculoDialog({
  veiculoId,
  children,
  isOpen,
  setIsOpen,
  setSelectedVeiculoId,
  onRegister,
  clienteId,
}: CustomerDialogProps) {
  // estado interno caso o componente não seja controlado por props
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = setIsOpen ?? setInternalOpen;

  const [novoVeiculo, setNovoVeiculo] = useState<Veiculo>({});

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // sempre sincroniza o estado (controlado ou interno)
        setOpen(nextOpen);

        if (!nextOpen) {
          setSelectedVeiculoId?.(undefined);
          setNovoVeiculo({
            ...(clienteId ? { clienteid: clienteId } : {})
          });
        }

      }}
    >
      <DialogTrigger autoFocus={false} asChild>
        {children}
      </DialogTrigger>

      {veiculoId ? (
        <EditContent
          isOpen={isOpen}
          veiculoId={veiculoId}
        />
      ) : (
        <RegisterContent
          setSelectedVeiculoId={setSelectedVeiculoId}
          novoVeiculo={novoVeiculo}
          setNovoVeiculo={setNovoVeiculo}
          onRegister={onRegister}
          onCloseAfterRegister={() => setOpen(false)}
          clienteId={clienteId}
          isOpen={isOpen}
        />
      )}
    </Dialog>
  );
}
