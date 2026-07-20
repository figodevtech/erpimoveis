"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import { CarFront, Link2, Loader2, Replace, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";

import LoteSelect, { type LoteSelectItem } from "@/app/(app)/components/loteSelect";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import formatarEmReal from "@/utils/formatarEmReal";

type ProdutoLoteCardProps = {
  mode: "create" | "edit";
  produtoId?: number;
  lotePendente?: LoteSelectItem | null;
  onLotePendenteChange?: (lote: LoteSelectItem | null) => void;
  onAfterChange?: () => void;
};

type VinculoResponse = {
  vinculo: {
    id: number;
    lote_id: number;
    produto_id: number;
    lote: LoteSelectItem | null;
  } | null;
};

function descricaoLote(lote: LoteSelectItem) {
  return [lote.marca, lote.modelo, lote.versao].filter(Boolean).join(" ") || `Lote #${lote.id}`;
}

export function ProdutoLoteCard({
  mode,
  produtoId,
  lotePendente,
  onLotePendenteChange,
  onAfterChange,
}: ProdutoLoteCardProps) {
  const [loteVinculado, setLoteVinculado] = React.useState<LoteSelectItem | null>(null);
  const [selectOpen, setSelectOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(mode === "edit");
  const [isMutating, setIsMutating] = React.useState(false);

  const loteAtual = mode === "create" ? lotePendente ?? null : loteVinculado;

  React.useEffect(() => {
    if (mode !== "edit" || !produtoId) return;

    let active = true;
    setIsLoading(true);
    axios
      .get<VinculoResponse>(`/api/products/${produtoId}/lote`)
      .then((response) => {
        if (active) setLoteVinculado(response.data.vinculo?.lote ?? null);
      })
      .catch((error) => {
        if (active && isAxiosError(error)) {
          toast.error("Erro ao buscar lote da peça", {
            description: error.response?.data?.error ?? error.message,
          });
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mode, produtoId]);

  const selecionarLote = async (lote: LoteSelectItem) => {
    if (mode === "create") {
      onLotePendenteChange?.(lote);
      return;
    }
    if (!produtoId || isMutating) return;

    setIsMutating(true);
    try {
      const response = await axios.put<VinculoResponse>(`/api/products/${produtoId}/lote`, {
        loteId: lote.id,
      });
      setLoteVinculado(response.data.vinculo?.lote ?? lote);
      toast.success(loteAtual ? "Lote da peça alterado." : "Peça vinculada ao lote.");
      onAfterChange?.();
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao vincular lote", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    } finally {
      setIsMutating(false);
    }
  };

  const removerVinculo = async () => {
    if (isMutating) return;

    if (mode === "create") {
      onLotePendenteChange?.(null);
      setRemoveOpen(false);
      return;
    }
    if (!produtoId) return;

    setIsMutating(true);
    try {
      await axios.delete(`/api/products/${produtoId}/lote`);
      setLoteVinculado(null);
      setRemoveOpen(false);
      toast.success("Vínculo com o lote removido.");
      onAfterChange?.();
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao remover vínculo", {
          description: error.response?.data?.error ?? error.message,
        });
      }
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-lg bg-primary/10 p-2 text-primary">
            <CarFront className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Lote de origem</h3>
            <p className="text-xs text-muted-foreground">
              Relacione esta peça ao veículo do qual ela foi retirada.
            </p>
          </div>
        </div>

        {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : null}
      </div>

      {!isLoading && !loteAtual ? (
        <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-lg border border-dashed bg-muted/20 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium">Nenhum lote vinculado</p>
            <p className="text-xs text-muted-foreground">
              A peça continuará sem veículo de origem até um lote ser selecionado.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isMutating}
            onClick={() => setSelectOpen(true)}
          >
            {isMutating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            Selecionar lote
          </Button>
        </div>
      ) : null}

      {!isLoading && loteAtual ? (
        <div className="mt-4 rounded-xl border bg-muted/20 p-4">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{descricaoLote(loteAtual)}</p>
                <Badge variant="secondary">Lote #{loteAtual.id}</Badge>
                {mode === "create" ? <Badge variant="outline">Vincular ao salvar</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {loteAtual.placa ? `Placa ${loteAtual.placa}` : "Veículo sem placa informada"}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Tipo</p>
              <p className="mt-0.5 font-medium">{loteAtual.tipo ?? "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Ano</p>
              <p className="mt-0.5 font-medium">
                {loteAtual.ano ?? "-"}/{loteAtual.ano_modelo ?? "-"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Valor de compra</p>
              <p className="mt-0.5 font-medium">
                {formatarEmReal(Number(loteAtual.valor_compra ?? 0))}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Peças relacionadas</p>
              <p className="mt-0.5 font-medium">{loteAtual.pecas?.length ?? 0}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isMutating}
              onClick={() => setSelectOpen(true)}
            >
              <Replace className="mr-2 h-4 w-4" />
              Selecionar outro lote
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={isMutating}
              onClick={() => setRemoveOpen(true)}
            >
              {isMutating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Remover vínculo
            </Button>
          </div>
        </div>
      ) : null}

      <LoteSelect
        open={selectOpen}
        setOpen={setSelectOpen}
        onSelect={(lote) => void selecionarLote(lote)}
        selectedLoteId={loteAtual?.id}
      />

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover vínculo com o lote?</AlertDialogTitle>
            <AlertDialogDescription>
              A peça deixará de estar relacionada ao lote #{loteAtual?.id}. O produto e o lote
              continuarão cadastrados normalmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isMutating}
              onClick={(event) => {
                event.preventDefault();
                void removerVinculo();
              }}
            >
              {isMutating ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Removendo
                </span>
              ) : (
                "Remover vínculo"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
