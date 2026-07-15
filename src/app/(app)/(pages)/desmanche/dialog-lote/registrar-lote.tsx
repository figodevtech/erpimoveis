"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Lote } from "../types";
import LoteFormFields from "./form-lote-fields";

type RegistrarLoteProps = {
  novoLote: Lote;
  setNovoLote: (value: Lote) => void;
  onRegister?: (lote: Lote) => void;
  isOpen: boolean;
};

export default function RegistrarLote({
  novoLote,
  setNovoLote,
  onRegister,
  isOpen,
}: RegistrarLoteProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleCreateLote = async () => {
    setIsSubmitting(true);
    try {
      const response = await axios.post("/api/lotes", { novoLote });
      if (response.status === 201) {
        toast.success("Sucesso!", {
          description: "Lote cadastrado.",
          duration: 2000,
        });
        onRegister?.(response.data.data);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? error.message,
          duration: 2000,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[850px] sm:w-[95vw] sm:max-w-[1100px] sm:min-w-0">
      <div className="flex h-full min-h-0 flex-col">
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <DialogTitle className="text-sm sm:text-lg">
            Lote
            <span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">
              | Novo
            </span>
          </DialogTitle>
          <DialogDescription>
            Preencha os dados para registrar um novo lote de desmanche
          </DialogDescription>
        </DialogHeader>

        <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
          <LoteFormFields lote={novoLote} setLote={setNovoLote} isOpen={isOpen} />
        </div>

        <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
          <div className="flex w-full flex-row justify-end gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 min-w-24 hover:cursor-pointer"
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={handleCreateLote}
              className="h-9 min-w-24 text-sm hover:cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </div>
        </DialogFooter>
      </div>
    </DialogContent>
  );
}
