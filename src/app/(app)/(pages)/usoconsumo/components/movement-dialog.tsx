"use client";

import axios, { isAxiosError } from "axios";
import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import type { UsoConsumoItem } from "@/types/usoconsumo";
import { rotuloDeEscopo, type UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";
import DialogEntrada from "../../estoque/components/dialog-entrada/dialog-entrada-unica";
import DialogSaida from "../../estoque/components/dialog-saida/dialog-saida-unica";

type Props = {
  item: UsoConsumoItem | null;
  type: "entrada" | "saida" | "inventario" | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  escopo?: UsoConsumoEscopo;
};

function errorText(error: unknown) {
  return isAxiosError(error) ? error.response?.data?.error ?? error.message : "Erro inesperado.";
}

export function MovementDialog({ item, type, onClose, onSaved, escopo = "USOCONSUMO" }: Props) {
  const [newBalance, setNewBalance] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item && type === "inventario") {
      setNewBalance(item.estoque);
      setNote("");
    }
  }, [item, type]);

  if (item && type === "entrada") {
    return (
      <DialogEntrada
        inventory="usoconsumo"
        escopo={escopo}
        isOpen
        setIsOpen={(open) => { if (!open) onClose(); }}
        productId={item.id}
        productDescription={item.titulo}
        currentQuantity={item.estoque}
        onSuccess={onSaved}
      />
    );
  }

  if (item && type === "saida") {
    return (
      <DialogSaida
        inventory="usoconsumo"
        escopo={escopo}
        isOpen
        setIsOpen={(open) => { if (!open) onClose(); }}
        productId={item.id}
        productDescription={item.titulo}
        currentQuantity={item.estoque}
        onSuccess={onSaved}
      />
    );
  }

  async function saveInventory() {
    if (!item) return;
    if (!Number.isInteger(newBalance) || newBalance < 0) return toast.error("Informe um saldo inteiro maior ou igual a zero.");
    if (note.trim().length < 3) return toast.error("Informe a justificativa do inventário.");
    setSaving(true);
    try {
      await axios.post(`/api/usoconsumo/itens/${item.id}/inventario`, { novo_saldo: newBalance, observacao: note.trim() });
      toast.success("Inventário ajustado.");
      onClose();
      await onSaved();
    } catch (error) {
      toast.error("Inventário não ajustado.", { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(item && type === "inventario")} onOpenChange={(open) => !saving && !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Ajuste de inventário · {rotuloDeEscopo(escopo).nome}</DialogTitle>
          <DialogDescription>{item?.titulo} · saldo atual {item?.estoque} {item?.unidade}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2"><Label htmlFor="inventario-novo-saldo">Novo saldo</Label><Input id="inventario-novo-saldo" type="number" min={0} step={1} value={newBalance} onChange={(event) => setNewBalance(Number(event.target.value))} /></div>
          <div className="space-y-2"><Label htmlFor="inventario-justificativa">Justificativa</Label><Textarea id="inventario-justificativa" value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={() => void saveInventory()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Confirmar ajuste</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
