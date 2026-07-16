"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import { Car, Image as ImageIcon, Loader2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Lote } from "../types";
import type { ProdutoImagemPendente } from "../../estoque/components/dialog-produto/tabs/produto-imagens-gallery";
import LoteFormFields from "./form-lote-fields";
import { TabLoteImagens } from "./tab-lote-imagens";

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
  const [currentTab, setCurrentTab] = React.useState("Geral");
  const [imagensPendentes, setImagensPendentes] = React.useState<
    ProdutoImagemPendente[]
  >([]);
  const [ordemImagensPendentes, setOrdemImagensPendentes] = React.useState<string[]>(
    [],
  );
  const [progressoUploadImagens, setProgressoUploadImagens] = React.useState<
    Record<string, number>
  >({});
  const imagensPendentesRef = React.useRef<ProdutoImagemPendente[]>([]);
  const ordemImagensPendentesRef = React.useRef<string[]>([]);

  const pendingKey = (id: string) => `pending-${id}`;

  const setOrdemPendentes = React.useCallback((keys: string[]) => {
    ordemImagensPendentesRef.current = keys;
    setOrdemImagensPendentes(keys);
  }, []);

  const limparImagensSelecionadas = React.useCallback(() => {
    imagensPendentesRef.current.forEach((img) =>
      URL.revokeObjectURL(img.previewUrl),
    );
    imagensPendentesRef.current = [];
    ordemImagensPendentesRef.current = [];
    setImagensPendentes([]);
    setOrdemImagensPendentes([]);
    setProgressoUploadImagens({});
  }, []);

  const handlePickImages = React.useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const novas = files.map((file) => ({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));

      imagensPendentesRef.current = [...imagensPendentesRef.current, ...novas];
      setImagensPendentes(imagensPendentesRef.current);
      setOrdemPendentes([
        ...ordemImagensPendentesRef.current,
        ...novas.map((img) => pendingKey(img.id)),
      ]);
    },
    [setOrdemPendentes],
  );

  const handleRemoverImagemPendente = React.useCallback(
    (id: string) => {
      const alvo = imagensPendentesRef.current.find((img) => img.id === id);
      if (alvo) URL.revokeObjectURL(alvo.previewUrl);

      imagensPendentesRef.current = imagensPendentesRef.current.filter(
        (img) => img.id !== id,
      );
      setImagensPendentes(imagensPendentesRef.current);
      setOrdemPendentes(
        ordemImagensPendentesRef.current.filter((key) => key !== pendingKey(id)),
      );
      setProgressoUploadImagens((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
    [setOrdemPendentes],
  );

  const uploadImagensDoLote = React.useCallback(async (loteId: number) => {
    const pendentesPorKey = new Map(
      imagensPendentesRef.current.map((img) => [pendingKey(img.id), img]),
    );
    const ordenadas = ordemImagensPendentesRef.current
      .map((key) => pendentesPorKey.get(key))
      .filter(Boolean) as ProdutoImagemPendente[];

    for (const pending of ordenadas) {
      const formData = new FormData();
      formData.append("files", pending.file);

      await axios.post(`/api/lotes/${loteId}/images`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          const total = event.total ?? pending.file.size;
          const pct =
            total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
          setProgressoUploadImagens((current) => ({
            ...current,
            [pending.id]: pct,
          }));
        },
      });
    }
  }, []);

  const handleCreateLote = async () => {
    setIsSubmitting(true);
    try {
      const response = await axios.post("/api/lotes", { novoLote });
      if (response.status === 201) {
        const loteCriado = response.data.data as Lote;
        if (imagensPendentesRef.current.length > 0 && loteCriado.id) {
          await uploadImagensDoLote(loteCriado.id);
          limparImagensSelecionadas();
        }

        toast.success("Sucesso!", {
          description: "Lote cadastrado.",
          duration: 2000,
        });
        onRegister?.(loteCriado);
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

  React.useEffect(() => {
    return () => {
      limparImagensSelecionadas();
    };
  }, [limparImagensSelecionadas]);

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

        <Tabs
          value={currentTab}
          onValueChange={setCurrentTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 overflow-x-auto border-b bg-background px-4 py-2 sm:px-6">
            <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
              <TabsTrigger
                value="Geral"
                className="h-9 rounded-xl px-4 text-xs data-[state=active]:shadow-sm sm:text-sm"
              >
                <span className="flex items-center gap-2">
                  <Car className="h-3.5 w-3.5" />
                  Geral
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="Imagens"
                className="h-9 rounded-xl px-4 text-xs data-[state=active]:shadow-sm sm:text-sm"
              >
                <span className="flex items-center gap-2">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Imagens
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="Geral"
            className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6"
          >
            <LoteFormFields lote={novoLote} setLote={setNovoLote} isOpen={isOpen} />
          </TabsContent>

          <TabLoteImagens
            mode="create"
            pendentes={imagensPendentes}
            ordemItens={ordemImagensPendentes}
            progressoUpload={progressoUploadImagens}
            saving={isSubmitting}
            onPick={handlePickImages}
            onReordenar={setOrdemPendentes}
            onRemoverPendente={handleRemoverImagemPendente}
          />
        </Tabs>

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
