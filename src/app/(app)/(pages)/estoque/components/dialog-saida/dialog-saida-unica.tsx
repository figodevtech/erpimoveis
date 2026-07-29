"use client";

import { useEffect, useState } from "react";
import axios, { isAxiosError } from "axios";
import { Loader2, PackageMinus } from "lucide-react";
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

const MOTIVOS = [
  ["USO_INTERNO", "Uso interno"],
  ["AVARIA", "Avaria"],
  ["PERDA", "Perda"],
  ["FURTO", "Furto"],
  ["VENCIMENTO", "Vencimento"],
  ["DOACAO", "Doação"],
  ["TRANSFERENCIA", "Transferência"],
  ["AJUSTE_INVENTARIO", "Ajuste de inventario"],
  ["OUTRO", "Outro"],
] as const;

const MOTIVOS_USOCONSUMO = [
  ["CONSUMO_INTERNO", "Consumo interno"],
  ["ENTREGA_FUNCIONARIO", "Entrega a funcionário"],
  ["MANUTENCAO_INTERNA", "Manutenção interna"],
  ["AVARIA", "Avaria"],
  ["PERDA", "Perda"],
  ["FURTO", "Furto"],
  ["VENCIMENTO", "Vencimento"],
  ["TRANSFERENCIA", "Transferência"],
  ["AJUSTE_INVENTARIO", "Ajuste de inventário"],
  ["OUTRO", "Outro"],
] as const;

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

  useEffect(() => {
    if (!isOpen) {
      setQuantidade(0);
      setMotivo("");
      setObservacao("");
    }
  }, [isOpen]);

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
            <Input
              id="saida-quantidade"
              type="number"
              min={1}
              max={currentQuantity}
              step={1}
              value={quantidade || ""}
              onChange={(event) => setQuantidade(Number(event.target.value))}
              placeholder="0"
            />
            {quantidade > currentQuantity ? (
              <p className="text-xs text-destructive">A quantidade supera o estoque disponível.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
              <SelectContent>
                {(inventory === "usoconsumo" ? MOTIVOS_USOCONSUMO : MOTIVOS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
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
