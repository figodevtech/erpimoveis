"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import {
  BadgeCheck,
  Image as ImageIcon,
  Loader2,
  PackagePlus,
  ShieldCheck,
  ShieldX,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";

import ProductSelect from "@/app/(app)/components/productSelect";
import { Badge } from "@/components/ui/badge";
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
import formatarEmReal from "@/utils/formatarEmReal";

import type { Produto } from "../../estoque/types";
import { Lote, LotePeca } from "../types";
import LoteFormFields from "./form-lote-fields";
import { TabLoteImagens } from "./tab-lote-imagens";
import { useLoteImagens } from "./use-lote-imagens";

type EditarLoteProps = {
  loteId?: number;
  isOpen: boolean;
  onUpdated?: () => void;
};

function produtoLabel(produto?: Produto | null) {
  if (!produto) return "Produto não encontrado";
  return [produto.titulo, produto.referencia ? `Ref. ${produto.referencia}` : null]
    .filter(Boolean)
    .join(" - ");
}

function ConservacaoBadge({ value }: { value?: string | null }) {
  if (value === "NOVO") {
    return (
      <Badge variant="outline" className="gap-1">
        <BadgeCheck className="h-3 w-3 text-primary" />
        Novo
      </Badge>
    );
  }
  if (value === "USADO") {
    return (
      <Badge variant="outline" className="gap-1">
        <ShieldX className="h-3 w-3 text-yellow-500" />
        Usado
      </Badge>
    );
  }
  if (value === "RECONDICIONADO") {
    return (
      <Badge variant="outline" className="gap-1">
        <ShieldCheck className="h-3 w-3 text-emerald-500" />
        Recondicionado
      </Badge>
    );
  }
  return null;
}

export default function EditarLote({ loteId, isOpen, onUpdated }: EditarLoteProps) {
  const [selectedLote, setSelectedLote] = React.useState<Lote | undefined>(undefined);
  const [isLoadingLote, setIsLoadingLote] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [currentTab, setCurrentTab] = React.useState("Geral");
  const [productSelectOpen, setProductSelectOpen] = React.useState(false);

  const pecas = selectedLote?.pecas ?? [];

  const handleGetLote = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!loteId) return;

    if (!options?.silent) setIsLoadingLote(true);
    try {
      const response = await axios.get<{ lote: Lote }>(`/api/lotes/${loteId}`);
      if (response.status === 200) {
        setSelectedLote(response.data.lote);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? "Falha ao buscar lote",
        });
      }
    } finally {
      if (!options?.silent) setIsLoadingLote(false);
    }
  }, [loteId]);

  const imagensHook = useLoteImagens({
    loteId,
    onAfterChangeCapa: () => handleGetLote({ silent: true }),
  });

  React.useEffect(() => {
    if (isOpen && loteId) void handleGetLote();
    if (!isOpen) {
      setSelectedLote(undefined);
      setCurrentTab("Geral");
    }
  }, [handleGetLote, isOpen, loteId]);

  const handleUpdateLote = async () => {
    if (!selectedLote?.id) return;

    setIsSubmitting(true);
    try {
      const response = await axios.put(`/api/lotes/${selectedLote.id}`, {
        selectedLote,
      });
      if (response.status === 200) {
        if (
          imagensHook.ordemAlterada &&
          imagensHook.imagensPendentes.length === 0
        ) {
          await imagensHook.salvarOrdem();
        }

        toast.success("Sucesso!", {
          description: "Lote atualizado.",
          duration: 2000,
        });
        await handleGetLote({ silent: true });
        onUpdated?.();
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? "Falha ao atualizar lote",
          duration: 2000,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const vincularProduto = async (produto: Produto) => {
    if (!selectedLote?.id || !produto.id) return;

    try {
      await axios.post(`/api/lotes/${selectedLote.id}/pecas`, {
        produtoId: produto.id,
      });
      toast.success("Peça vinculada ao lote.");
      await handleGetLote();
      onUpdated?.();
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao vincular peça", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    }
  };

  const removerPeca = async (peca: LotePeca) => {
    if (!selectedLote?.id) return;

    try {
      await axios.delete(`/api/lotes/${selectedLote.id}/pecas`, {
        params: { relationId: peca.id },
      });
      toast.success("Peça removida do lote.");
      await handleGetLote();
      onUpdated?.();
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao remover peça", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    }
  };

  return (
    <DialogContent className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[850px] sm:w-[95vw] sm:max-w-[1100px] sm:min-w-0">
      <div className="flex h-full min-h-0 flex-col">
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <DialogTitle className="text-sm sm:text-lg">
            Lote
            <span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">
              | #{loteId}
            </span>
          </DialogTitle>
          <DialogDescription>
            Edite os dados do lote de desmanche e gerencie as peças vinculadas
          </DialogDescription>
        </DialogHeader>

        {isLoadingLote ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : selectedLote ? (
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
                  Geral
                </TabsTrigger>
                <TabsTrigger
                  value="Pecas"
                  className="h-9 rounded-xl px-4 text-xs data-[state=active]:shadow-sm sm:text-sm"
                >
                  Peças
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
              <LoteFormFields
                lote={selectedLote}
                setLote={setSelectedLote}
                isOpen={isOpen}
              />
            </TabsContent>

            <TabLoteImagens
              mode="edit"
              carregando={imagensHook.carregandoImagens}
              subindo={imagensHook.subindoImagens}
              salvandoOrdem={imagensHook.salvandoOrdem}
              removendoImagemId={imagensHook.removendoImagemId}
              definindoCapaImagemId={imagensHook.definindoCapaImagemId}
              imagens={imagensHook.imagens}
              pendentes={imagensHook.imagensPendentes}
              ordemItens={imagensHook.ordemItens}
              progressoUpload={imagensHook.uploadProgressByPendingId}
              imgUrlPrincipal={selectedLote.imgUrl ?? null}
              saving={isSubmitting}
              onPick={imagensHook.onPick}
              onUpload={imagensHook.uploadPendentes}
              onReordenar={imagensHook.reordenarItens}
              onRemoverPendente={imagensHook.removerImagemPendente}
              onDefinirPrincipal={imagensHook.definirImagemPrincipal}
              onRemover={imagensHook.removerImagem}
            />

            <TabsContent
              value="Pecas"
              className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6"
            >
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Peças do lote</h3>
                    <p className="text-xs text-muted-foreground">
                      Cada peça pode pertencer a apenas um lote de desmanche.
                    </p>
                  </div>
                  <Button type="button" size="sm" onClick={() => setProductSelectOpen(true)}>
                    <PackagePlus className="mr-2 h-4 w-4" />
                    Vincular peça
                  </Button>
                </div>

                <ProductSelect
                  open={productSelectOpen}
                  setOpen={setProductSelectOpen}
                  OnSelect={vincularProduto}
                >
                  <span className="hidden" />
                </ProductSelect>

                {pecas.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Nenhuma peça vinculada a este lote.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pecas.map((peca) => (
                      <div
                        key={peca.id}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">
                              {produtoLabel(peca.produto)}
                            </p>
                            <ConservacaoBadge value={peca.produto?.conservacao} />
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            Estoque: {peca.produto?.estoque ?? 0} | Valor:{" "}
                            {formatarEmReal(Number(peca.produto?.precovenda ?? 0))}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removerPeca(peca)}
                          aria-label="Remover peça"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Lote não encontrado.
          </div>
        )}

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
              onClick={handleUpdateLote}
              disabled={isSubmitting || isLoadingLote || !selectedLote}
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
