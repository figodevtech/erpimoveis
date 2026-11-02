"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type TipoComodidade = {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
};

type ComodidadeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem `editing`, o diálogo cria um tipo novo. */
  editing?: TipoComodidade | null;
  /** Nome sugerido ao criar (ex.: o texto que já estava digitado no imóvel). */
  initialName?: string;
  onSaved: (item: TipoComodidade) => void;
};

/**
 * Sem <form> de propósito: o diálogo também abre de dentro do formulário do imóvel, e o
 * submit de um form no portal sobe pela árvore do React até o formulário de fora.
 */
export function ComodidadeDialog({ open, onOpenChange, editing, initialName, onSaved }: ComodidadeDialogProps) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(editing?.nome ?? initialName ?? "");
    setDescricao(editing?.descricao ?? "");
    setAtivo(editing?.ativo ?? true);
  }, [open, editing, initialName]);

  async function save() {
    if (!nome.trim()) {
      toast.error("Informe o nome da comodidade.");
      return;
    }
    try {
      setSaving(true);
      const res = await fetch(editing ? `/api/tipos/comodidades/${editing.id}` : "/api/tipos/comodidades", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), descricao: descricao.trim() || null, ativo }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Falha ao salvar tipo de comodidade");
      toast.success(editing ? "Tipo de comodidade atualizado." : "Tipo de comodidade cadastrado.");
      onSaved(j.item as TipoComodidade);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar tipo de comodidade");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar tipo de comodidade" : "Novo tipo de comodidade"}</DialogTitle>
          <DialogDescription>
            Aparece na lista de comodidades do cadastro de imóveis.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="space-y-1">
            <label htmlFor="comodidade-nome" className="text-sm font-medium">
              Nome
            </label>
            <Input
              id="comodidade-nome"
              autoFocus
              maxLength={120}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void save();
                }
              }}
              placeholder="Ex.: Piscina aquecida"
            />
            {editing ? (
              <p className="text-xs text-muted-foreground">
                Renomear não altera os imóveis que já usam o nome antigo.
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label htmlFor="comodidade-descricao" className="text-sm font-medium">
              Descrição (opcional)
            </label>
            <Textarea
              id="comodidade-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Uso interno: quando marcar esta comodidade"
              rows={2}
              maxLength={300}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Status</span>
              <p className="text-xs text-muted-foreground">Somente tipos ativos aparecem no cadastro do imóvel.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">{ativo ? "Ativo" : "Inativo"}</span>
              <Switch checked={ativo} onCheckedChange={setAtivo} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" type="button" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
