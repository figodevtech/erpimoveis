"use client";

import { useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import { Loader2, Minus, PackageMinus, Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="h-5 w-5 text-red-600" />
            Saída de {inventory === "usoconsumo" ? "uso/consumo" : "estoque"}
          </DialogTitle>
          <DialogDescription>{productDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 p-4 bg-card rounded-2xl border">
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
                className="sm:hidden shrink-0"
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
                className="sm:hidden shrink-0"
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

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isSubmitting}>Cancelar</Button>
          <Button variant="destructive" onClick={() => void registrarSaida()} disabled={isSubmitting || !saidaValida || !motivo}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageMinus className="mr-2 h-4 w-4" />}
            Registrar saída
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
