"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Servico } from "@/types/servico";

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function parsePrecoBRL(value: string) {
  const clean = value.replace(/[^\d,.-]/g, "").trim();
  if (!clean) return Number.NaN;

  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  return Number(normalized);
}

function formatPrecoBRL(value: string) {
  if (!value) return "";

  const parsed = parsePrecoBRL(value);
  if (!Number.isFinite(parsed)) return "";

  return brlFormatter.format(parsed);
}

function formatPrecoDigitado(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  return brlFormatter.format(Number(digits) / 100);
}

type ServicoForm = {
  codigo: string;
  descricao: string;
  precohora: string;
  ativo: boolean;
  permite_agendamento: boolean;
};

interface ServicoDialogProps {
  loadServicos?: () => Promise<void>;
  editing?: Servico | null;
  setEditing?: (value: Servico | null) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
  openNovo?: () => void;
  openEditar?: () => void;
  form: ServicoForm;
  setForm: (form: ServicoForm) => void;
  onRegister?: () => void;
}

const emptyForm: ServicoForm = {
  codigo: "",
  descricao: "",
  precohora: "",
  ativo: true,
  permite_agendamento: false,
};

export default function ServicoDialog({
  loadServicos,
  editing,
  setEditing,
  open,
  setOpen,
  form,
  setForm,
  onRegister,
}: ServicoDialogProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (field: keyof ServicoForm, value: string | boolean) => {
    setForm({
      ...form,
      [field]: value,
    });
  };

  const handlePrecoChange = (value: string) => {
    handleChange("precohora", formatPrecoDigitado(value));
  };

  async function handleSave() {
    if (!form.codigo.trim() || !form.descricao.trim()) {
      toast.error("Insira uma descrição.");
      return;
    }

    const precohora = parsePrecoBRL(form.precohora);
    if (!form.precohora.trim() || !Number.isFinite(precohora)) {
      toast.error("Preço inválido.");
      return;
    }

    const payload = {
      codigo: form.codigo.trim(),
      descricao: form.descricao.trim(),
      precohora,
      ativo: form.ativo,
      permite_agendamento: form.permite_agendamento,
    };

    try {
      setIsSaving(true);

      const res = await fetch(editing ? `/api/tipos/servicos/${editing.id}` : "/api/tipos/servicos", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || (editing ? "Erro ao atualizar serviço" : "Erro ao criar serviço"));
      }

      toast.success(editing ? "Serviço atualizado" : "Serviço cadastrado");
      setOpen?.(false);
      setEditing?.(null);
      setForm(emptyForm);
      onRegister?.();
      await loadServicos?.();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Erro ao salvar serviço");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar serviço" : "Novo serviço"}</DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-4 rounded-2xl bg-card p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
            <div className="space-y-2">
              <label className="text-sm font-medium">Código</label>
              <Input
                value={form.codigo}
                onChange={(e) => handleChange("codigo", e.target.value)}
                placeholder="Ex.: ALINH001"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição</label>
              <Input
                value={form.descricao}
                onChange={(e) => handleChange("descricao", e.target.value)}
                placeholder="Ex.: Alinhamento e balanceamento"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Preço</label>
              <Input
                value={formatPrecoBRL(form.precohora)}
                onChange={(e) => handlePrecoChange(e.target.value)}
                inputMode="numeric"
                placeholder="R$ 0,00"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Status do serviço</span>
              <p className="text-xs text-muted-foreground">
                Defina se este serviço está ativo para uso nas ordens de serviço.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {form.ativo ? "Ativo" : "Inativo"}
              </span>
              <Switch checked={form.ativo} onCheckedChange={(val) => handleChange("ativo", val)} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Permite agendamento</span>
              <p className="text-xs text-muted-foreground">
                Defina se este servico pode ser selecionado em agendamentos.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {form.permite_agendamento ? "Sim" : "Nao"}
              </span>
              <Switch
                checked={form.permite_agendamento}
                onCheckedChange={(val) => handleChange("permite_agendamento", val)}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              setOpen?.(false);
              setEditing?.(null);
              setForm(emptyForm);
            }}
          >
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
