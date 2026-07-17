"use client";

import type React from "react";
import { ReactNode, useEffect, useState } from "react";
import axios from "axios";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Veiculo } from "../types";
import RegisterContent from "./registrar-veiculo";
import EditContent from "./editar-veiculo";

interface CustomerDialogProps {
  veiculoId?: number;
  children?: ReactNode;
  isOpen: boolean;
  setIsOpen?: (value: boolean) => void;
  setSelectedVeiculoId?: (value: number | undefined) => void;
  onRegister?:(c: Veiculo)=> void;
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

  const [, setSelectedVeiculo] = useState<
    Veiculo | undefined
  >(undefined);
  const [, setIsLoading] = useState(false);
  const [novoVeiculo, setNovoVeiculo] = useState<Veiculo>({
  });

  const handleGetVeiculo = async (id: number) => {
    setIsLoading(true);
    try {
      const response = await axios.get(`/api/veiculos/cliente/${id}`);
      if (response.status === 200) {
        const { data } = response;
        setSelectedVeiculo(data.data);
      }
    } catch (error) {
      console.log("Erro ao buscar veiculo:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Busca o cliente sempre que o dialog abrir e existir um customerId
  useEffect(() => {
    if (open && veiculoId) {
      handleGetVeiculo(veiculoId);
    }
  }, [open, veiculoId]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // sempre sincroniza o estado (controlado ou interno)
        setOpen(nextOpen);
        

        if (!nextOpen) {
          setSelectedVeiculoId?.(undefined);
          setSelectedVeiculo(undefined);
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
