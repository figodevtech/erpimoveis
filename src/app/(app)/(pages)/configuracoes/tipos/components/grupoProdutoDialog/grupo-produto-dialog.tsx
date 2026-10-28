"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { ProductCheckoutSettings } from '@/app/(app)/(pages)/estoque/components/dialog-produto/tabs/product-checkout-settings';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type GrupoProduto = {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean | null;
  exibirPdv: boolean;
  exibirSite: boolean;
};

type GrupoForm = {
  nome: string;
  descricao: string;
  ativo: boolean;
  exibirPdv: boolean;
  exibirSite: boolean;
};

const emptyForm: GrupoForm = {
  nome: "",
  descricao: "",
  ativo: true,
  exibirPdv: true,
  exibirSite: true,
};

interface GrupoProdutoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem grupo, o dialog cadastra um novo. */
  editing?: GrupoProduto | null;
  /** Recebe o grupo como a API o devolveu, depois de salvo. */
  onSaved?: (grupo: GrupoProduto) => void | Promise<void>;
  children?: ReactNode;
}

function grupoDaApi(g: any): GrupoProduto {
  return {
    id: Number(g.id),
    nome: String(g.nome ?? ""),
    descricao: (g.descricao as string | null) ?? null,
    ativo: typeof g.ativo === "boolean" ? (g.ativo as boolean) : true,
    exibirPdv: g.exibirPdv ?? true,
    exibirSite: g.exibirSite ?? true,
  };
}

// Instalacoes sem loja tambem passam por aqui; so avisa da falha quando o
// usuario mexeu justamente no "Exibir no site".
async function syncSite(avisarFalha: boolean) {
  try {
    const res = await fetch("/api/integracoes/site/catalog/sync", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error || "Falha ao sincronizar com o site.");
    if (avisarFalha) toast.success("Site atualizado.");
  } catch (e: any) {
    if (avisarFalha) {
      toast.warning("Grupo salvo, mas o site não foi atualizado.", {
        description: e?.message || "Sincronize o catálogo no módulo Marketplace.",
      });
    }
  }
}

export default function GrupoProdutoDialog({
  open,
  onOpenChange,
  editing = null,
  onSaved,
  children,
}: GrupoProdutoDialogProps) {
  const [form, setForm] = useState<GrupoForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  // Cada abertura parte do grupo em edicao, ou do formulario vazio.
  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            nome: editing.nome ?? "",
            descricao: editing.descricao ?? "",
            ativo: editing.ativo ?? true,
            exibirPdv: editing.exibirPdv,
            exibirSite: editing.exibirSite,
          }
        : emptyForm,
    );
  }, [open, editing]);

  function handleChange<K extends keyof GrupoForm>(key: K, value: GrupoForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.nome.trim()) {
      toast.error("Informe o nome do grupo.");
      return;
    }

    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      ativo: form.ativo,
      exibirPdv: form.exibirPdv,
      exibirSite: form.exibirSite,
    };

    try {
      setIsSaving(true);
      let salvo: GrupoProduto;

      if (editing) {
        const res = await fetch(`/api/tipos/grupos-produto/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao atualizar grupo de produto");
        toast.success("Grupo de produto atualizado.");
        salvo = grupoDaApi(j?.item ?? { ...editing, ...payload });

        // Nome, status e exibirSite chegam ao site; o banco ja enfileirou os
        // produtos do grupo, falta enviar.
        const exibirSiteMudou = editing.exibirSite !== form.exibirSite;
        if (exibirSiteMudou || editing.nome !== payload.nome || editing.ativo !== form.ativo) {
          await syncSite(exibirSiteMudou);
        }
      } else {
        const res = await fetch("/api/tipos/grupos-produto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Falha ao cadastrar grupo de produto");
        toast.success("Grupo de produto cadastrado.");
        salvo = grupoDaApi(j.item);
      }

      onOpenChange(false);
      await onSaved?.(salvo);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar grupo de produto");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar grupo de produto" : "Novo grupo de produto"}</DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Nome do grupo</label>
            <Input value={form.nome} onChange={(e) => handleChange("nome", e.target.value)} placeholder="Ex.: MOTOR, FREIOS..." />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Descricao</label>
            <Input
              value={form.descricao}
              onChange={(e) => handleChange("descricao", e.target.value)}
              placeholder="Descricao amigavel para relatorios (opcional)"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Status do grupo</span>
              <p className="text-xs text-muted-foreground">
                Defina se este grupo pode ser usado nos produtos.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {form.ativo ? "Ativo" : "Inativo"}
              </span>
              <Switch checked={form.ativo} onCheckedChange={(val) => handleChange("ativo", val)} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 bg-muted/40">
            <div className="space-y-0.5">
              <label htmlFor="grupo-exibir-pdv" className="text-sm font-medium">Exibir no PDV</label>
              <p id="grupo-exibir-pdv-descricao" className="text-xs text-muted-foreground">
                Ao desativar, todos os produtos deste grupo ficam ocultos no PDV,
                mesmo que estejam habilitados individualmente.
              </p>
            </div>
            <Switch
              id="grupo-exibir-pdv"
              aria-describedby="grupo-exibir-pdv-descricao"
              checked={form.exibirPdv}
              onCheckedChange={(val) => handleChange("exibirPdv", val)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 bg-muted/40">
            <div className="space-y-0.5">
              <label htmlFor="grupo-exibir-site" className="text-sm font-medium">Exibir no site</label>
              <p id="grupo-exibir-site-descricao" className="text-xs text-muted-foreground">
                Ao desativar, a categoria e todos os produtos deste grupo ficam ocultos no site,
                mesmo que estejam publicados individualmente.
              </p>
            </div>
            <Switch
              id="grupo-exibir-site"
              aria-describedby="grupo-exibir-site-descricao"
              checked={form.exibirSite}
              onCheckedChange={(val) => handleChange("exibirSite", val)}
            />
          </div>
        </div>

        {open&&editing?<ProductCheckoutSettings key={editing.id} groupId={editing.id}/>:<p className="text-xs text-muted-foreground">Salve o grupo para configurar o parcelamento dos seus produtos.</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
