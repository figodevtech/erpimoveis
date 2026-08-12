"use client";

import { useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import { Loader2, Minus, PackageMinus, Plus, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type MotivoSaidaOption = { codigo: string; nome: string };

interface DialogSaidaProps {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  productId: number;
  productDescription: string;
  currentQuantity: number;
  onSuccess?: () => void | Promise<void>;
  inventory?: "produto" | "usoconsumo";
}

export default function DialogSaida({
  isOpen,
  setIsOpen,
  productId,
  productDescription,
  currentQuantity,
  onSuccess,
  inventory = "produto",
}: DialogSaidaProps) {
  const [quantidade, setQuantidade] = useState(0);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [motivos, setMotivos] = useState<MotivoSaidaOption[]>([]);
  const [loadingMotivos, setLoadingMotivos] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setQuantidade(0);
      setMotivo("");
      setObservacao("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let ativo = true;
    setLoadingMotivos(true);
    const escopo = inventory === "usoconsumo" ? "USOCONSUMO" : "PRODUTO";
    axios
      .get(`/api/tipos/motivos-saida?ativo=true&escopo=${escopo}`)
      .then(({ data }) => {
        if (!ativo) return;
        setMotivos((data?.items ?? []).map((item: any) => ({ codigo: String(item.codigo), nome: String(item.nome) })));
      })
      .catch(() => {
        if (ativo) toast.error("Não foi possível carregar os motivos de saída.");
      })
      .finally(() => {
        if (ativo) setLoadingMotivos(false);
      });
    return () => {
      ativo = false;
    };
  }, [isOpen, inventory]);

  const saldoResultante = currentQuantity - quantidade;
  const saidaValida = Number.isInteger(quantidade) && quantidade > 0 && quantidade <= currentQuantity;

  const registrarSaida = async () => {
    if (!saidaValida) {
      toast.error("Informe uma quantidade válida, sem ultrapassar o estoque disponível.");
      return;
    }
    if (!motivo) {
      toast.error("Selecione o motivo da saída.");
      return;
    }
    if (motivo === "OUTRO" && !observacao.trim()) {
      toast.error("Descreva o motivo da saída.");
      return;
    }

    setIsSubmitting(true);
    try {
      await axios.post(inventory === "usoconsumo" ? "/api/usoconsumo/saidas" : "/api/estoque/saidas", inventory === "usoconsumo"
        ? { motivo, observacao: observacao.trim() || undefined, itens: [{ item_id: productId, quantidade }] }
        : { produtoId: productId, quantidade, motivo, descricao: observacao.trim() || null });
      toast.success("Saída registrada e estoque atualizado.");
      setIsOpen(false);
      await onSuccess?.();
    } catch (error) {
      toast.error("Erro ao registrar saída", {
        description: isAxiosError(error)
          ? error.response?.data?.error ?? error.message
          : "Nao foi possivel concluir a operacao.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSubmitting && setIsOpen(open)}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none motion-reduce:animate-none motion-reduce:duration-0 sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[min(36rem,calc(100dvh-2rem))] sm:w-full sm:max-w-[520px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border sm:shadow-lg"
        onEscapeKeyDown={(event) => isSubmitting && event.preventDefault()}
        onInteractOutside={(event) => isSubmitting && event.preventDefault()}
      >
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Fechar saída"
            disabled={isSubmitting}
            className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-20 size-12 sm:right-4 sm:top-4 sm:size-9"
          >
            <X aria-hidden="true" />
          </Button>
        </DialogClose>

        <DialogHeader className="shrink-0 border-b bg-background px-4 pb-4 pr-16 pt-[max(1rem,env(safe-area-inset-top))] text-left sm:px-6 sm:py-4 sm:pr-14">
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="h-5 w-5 text-red-600" aria-hidden="true" />
            Saída de {inventory === "usoconsumo" ? "uso/consumo" : "estoque"}
          </DialogTitle>
          <DialogDescription className="line-clamp-2 text-left" title={productDescription}>
            {productDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-muted/20 px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 [&_input]:min-h-12 [&_[data-slot=button]]:min-h-12 [&_[data-slot=select-trigger]]:min-h-12 sm:[&_input]:min-h-9 sm:[&_[data-slot=button]]:min-h-9 sm:[&_[data-slot=select-trigger]]:min-h-9">
          <div className="space-y-5 rounded-2xl border bg-card p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <div>
              <p className="text-muted-foreground">Estoque atual</p>
              <p className="text-lg font-semibold">{currentQuantity}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Após a saída</p>
              <p className={`text-lg font-semibold ${saldoResultante < 0 ? "text-destructive" : ""}`}>
                {saldoResultante}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="saida-quantidade">Quantidade</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-12 shrink-0 sm:hidden"
                onClick={() => setQuantidade((atual) => Math.max(0, (Number.isFinite(atual) ? atual : 0) - 1))}
                disabled={quantidade <= 0}
                aria-label="Diminuir quantidade"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                id="saida-quantidade"
                type="number"
                min={1}
                max={currentQuantity}
                step={1}
                value={quantidade || ""}
                onChange={(event) => setQuantidade(Number(event.target.value))}
                placeholder="0"
                className="text-center sm:text-left"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-12 shrink-0 sm:hidden"
                onClick={() => setQuantidade((atual) => Math.min(currentQuantity, (Number.isFinite(atual) ? atual : 0) + 1))}
                disabled={quantidade >= currentQuantity}
                aria-label="Aumentar quantidade"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {quantidade > currentQuantity ? (
              <p className="text-xs text-destructive">A quantidade supera o estoque disponível.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo} disabled={loadingMotivos}>
              <SelectTrigger>
                <SelectValue placeholder={loadingMotivos ? "Carregando motivos..." : "Selecione o motivo"} />
              </SelectTrigger>
              <SelectContent>
                {motivos.map((item) => (
                  <SelectItem key={item.codigo} value={item.codigo}>
                    {item.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="saida-observacao">Descrição {motivo === "OUTRO" ? "*" : "(opcional)"}</Label>
            <Textarea
              id="saida-observacao"
              value={observacao}
              onChange={(event) => setObservacao(event.target.value)}
              placeholder="Detalhes sobre a retirada do estoque"
              maxLength={500}
              rows={3}
            />
          </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:px-6 sm:py-4">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isSubmitting} className="min-h-12 w-full sm:min-h-9 sm:w-auto">
              Cancelar
            </Button>
          </DialogClose>
          <Button type="button" className="min-h-12 w-full sm:min-h-9 sm:w-auto" variant="destructive" onClick={() => void registrarSaida()} disabled={isSubmitting || !saidaValida || !motivo}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <PackageMinus className="mr-2 h-4 w-4" aria-hidden="true" />}
            Registrar saída
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
