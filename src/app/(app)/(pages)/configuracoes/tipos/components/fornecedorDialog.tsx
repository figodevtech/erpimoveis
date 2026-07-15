import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { formatCpfCnpj } from "../../../(financeiro)/fluxodecaixa/utils";
import { formatCep } from "../../../clientes/components/customerDialogRegister/utils";

type Fornecedor = {
  id: number;
  cpfcnpj: string;
  nomerazaosocial: string;
  nomefantasia: string | null;
  endereco: string | null;
  endereconumero: string | null;
  cidade: string | null;
  bairro: string | null;
  codigomunicipio: string | null;
  estado: string | null;
  cep: string | null;
  contato: string | null;
  ativo: boolean | null;
};

type FornecedorForm = {
  cpfcnpj: string;
  nomerazaosocial: string;
  nomefantasia: string;
  endereco: string;
  endereconumero: string;
  cidade: string;
  bairro: string;
  codigomunicipio: string;
  estado: string;
  cep: string;
  contato: string;
  ativo: boolean;
};

const emptyForm: FornecedorForm = {
  cpfcnpj: "",
  nomerazaosocial: "",
  nomefantasia: "",
  endereco: "",
  endereconumero: "",
  cidade: "",
  bairro: "",
  codigomunicipio: "",
  estado: "",
  cep: "",
  contato: "",
  ativo: true,
};

interface FornecedorDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  loadFornecedores?: () => Promise<void>;
  fornecedorToEdit?: Fornecedor | null;
  setFornecedorToEdit?: (fornecedor: Fornecedor | null) => void;
  children?: React.ReactNode;
  dadosNovoFornecedor?: FornecedorForm;
  handleGetFornecedor?: () => Promise<void>;
}

export default function FornecedorDialog({
  dialogOpen,
  setDialogOpen,
  loadFornecedores,
  fornecedorToEdit,
  setFornecedorToEdit,
  dadosNovoFornecedor,
  children,
  handleGetFornecedor,
}: FornecedorDialogProps) {
  const [form, setForm] = useState<FornecedorForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  function handleChange<K extends keyof FornecedorForm>(
    key: K,
    value: FornecedorForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.cpfcnpj.trim() || !form.nomerazaosocial.trim()) {
      toast.error("CNPJ e Razão Social são obrigatórios.");
      return;
    }

    const payload = {
      cpfcnpj: form.cpfcnpj?.trim(),
      nomerazaosocial: form.nomerazaosocial?.trim(),
      nomefantasia: form.nomefantasia?.trim() || null,
      endereco: form.endereco?.trim() || null,
      endereconumero: form.endereconumero?.trim() || null,
      cidade: form.cidade?.trim() || null,
      codigomunicipio: form.codigomunicipio?.trim() || null,
      bairro: form.bairro?.trim() || null,
      estado: form.estado?.trim() || null,
      cep: form.cep?.trim() || null,
      contato: form.contato?.trim() || null,
      ativo: form.ativo,
    };

    try {
      setIsSaving(true);

      if (fornecedorToEdit) {
        const res = await fetch(
          `/api/tipos/fornecedores/${fornecedorToEdit.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        const json = await res.json();
        if (!res.ok)
          throw new Error(json?.error || "Falha ao atualizar fornecedor");
        toast.success("Fornecedor atualizado");
      } else {
        const res = await fetch("/api/tipos/fornecedores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok)
          throw new Error(json?.error || "Falha ao cadastrar fornecedor");
        toast.success("Fornecedor cadastrado");
        handleGetFornecedor?.();
      }

      setDialogOpen(false);

      setFornecedorToEdit?.(null);

      setForm(emptyForm);
      await loadFornecedores?.();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Erro ao salvar fornecedor");
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (fornecedorToEdit) {
      setForm({
        cpfcnpj: fornecedorToEdit.cpfcnpj ?? "",
        nomerazaosocial: fornecedorToEdit.nomerazaosocial ?? "",
        nomefantasia: fornecedorToEdit.nomefantasia ?? "",
        endereco: fornecedorToEdit.endereco ?? "",
        endereconumero: fornecedorToEdit.endereconumero ?? "",
        cidade: fornecedorToEdit.cidade ?? "",
        bairro: fornecedorToEdit.bairro ?? "",
        codigomunicipio: fornecedorToEdit.codigomunicipio ?? "",
        estado: fornecedorToEdit.estado ?? "",
        cep: fornecedorToEdit.cep ?? "",
        contato: fornecedorToEdit.contato ?? "",
        ativo: fornecedorToEdit.ativo ?? true,
      });
    }
  }, [fornecedorToEdit]);

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(nextOpen) => {
        setDialogOpen(nextOpen);
        if (dadosNovoFornecedor && nextOpen) {
          setForm(dadosNovoFornecedor);
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="h-svh min-w-screen p-0 overflow-hidden sm:max-w-[500px] sm:max-h-[600px] sm:w-[55vw] sm:min-w-0">
      <div className="flex h-full min-h-0 flex-col">
        <DialogHeader className="shrink-0 px-6 py-4 border-b-1">
            <DialogTitle>
              {fornecedorToEdit ? "Editar fornecedor" : "Novo fornecedor"}
            </DialogTitle>
          </DialogHeader>
          <div className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 p-4 space-y-2">
            <div className="mt-4 space-y-4 rounded-lg border p-4 bg-card">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
                <div className="space-y-1.5">
                  <Label>CPF/CNPJ</Label>
                  <Input
                    value={formatCpfCnpj(form.cpfcnpj || "")}
                    onChange={(e) => handleChange("cpfcnpj", e.target.value)}
                    placeholder="Somente números"
                    maxLength={18}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Nome/Razão Social</Label>
                  <Input
                    value={form.nomerazaosocial || ""}
                    onChange={(e) =>
                      handleChange("nomerazaosocial", e.target.value)
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Nome Fantasia (opcional)</Label>
                <Input
                  value={form.nomefantasia || ""}
                  onChange={(e) => handleChange("nomefantasia", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Endereço</Label>
                <Input
                  value={form.endereco || ""}
                  onChange={(e) => handleChange("endereco", e.target.value)}
                  placeholder="Rua, Avenida, etc."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Número</Label>
                <Input
                  value={form.endereconumero || ""}
                  onChange={(e) =>
                    handleChange("endereconumero", e.target.value)
                  }
                  placeholder="Número"
                  type="number"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
                <div className="space-y-1.5">
                  <Label>Estado</Label>
                  <Input
                    value={form.estado || ""}
                    onChange={(e) => handleChange("estado", e.target.value)}
                    placeholder="UF"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Cidade</Label>
                  <Input
                    value={form.cidade || ""}
                    onChange={(e) => handleChange("cidade", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-nowrap">Código Município</Label>
                  <Input
                    value={form.codigomunicipio || ""}
                    onChange={(e) =>
                      handleChange("codigomunicipio", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Bairro</Label>
                  <Input
                    value={form.bairro || ""}
                    onChange={(e) => handleChange("bairro", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>CEP</Label>
                  <Input
                    value={formatCep(form.cep || "") || ""}
                    onChange={(e) => handleChange("cep", e.target.value)}
                    maxLength={9}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Contato (telefone/email)</Label>
                <Input
                  value={form.contato || ""}
                  onChange={(e) => handleChange("contato", e.target.value)}
                />
              </div>

              {/* Status dentro do diálogo */}
              <div className="mt-4 flex items-center justify-between rounded-md border px-3 py-2 bg-muted/40">
                <div className="space-y-0.5">
                  <Label>Status do fornecedor</Label>
                  <p className="text-xs text-muted-foreground">
                    Defina se este fornecedor está ativo para uso nas telas do
                    sistema.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {form.ativo ? "Ativo" : "Inativo"}
                  </span>
                  <Switch
                    checked={form.ativo}
                    onCheckedChange={(val) => handleChange("ativo", val)}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="px-6 py-4">
            <div className="flex sm:flex-row gap-3 sm:gap-4">
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setDialogOpen(false);
                  if (setFornecedorToEdit) {
                    setFornecedorToEdit(null);
                  }
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
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
