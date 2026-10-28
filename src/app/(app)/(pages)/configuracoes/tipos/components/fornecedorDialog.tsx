import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { UppercaseInput } from "@/components/ui/uppercase-input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import {
  formatCpfCnpj,
  hasValidCpfCnpjLength,
  isValidCnpj,
  onlyFiscalDigits,
} from "@/lib/nfe/recipientNormalization";
import { isValidCpf, normalizeCnpj, normalizeCpfOrCnpj } from "@/lib/fiscal-identifiers";
import { formatCep } from "../../../clientes/components/customerDialogRegister/utils";

type Fornecedor = {
  id: number;
  cpfcnpj: string;
  inscricaoestadual?: string | null;
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
  inscricaoestadual?: string;
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
  inscricaoestadual: "",
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
  const [isLoadingCnpj, setIsLoadingCnpj] = useState(false);
  const lastCnpjRequested = useRef("");
  const cnpjRequestSequence = useRef(0);
  const cnpjRequestController = useRef<AbortController | null>(null);

  function handleChange<K extends keyof FornecedorForm>(
    key: K,
    value: FornecedorForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleGetCnpj(document?: string) {
    const cnpj = normalizeCnpj(document ?? form.cpfcnpj);
    if (!isValidCnpj(cnpj)) {
      toast.warning("Informe um CNPJ válido para realizar a consulta.");
      return;
    }
    if (!/^\d{14}$/.test(cnpj)) {
      toast.info("A consulta automática ainda não aceita CNPJ alfanumérico. Preencha os dados manualmente.");
      return;
    }

    const requestId = ++cnpjRequestSequence.current;
    cnpjRequestController.current?.abort();
    const controller = new AbortController();
    cnpjRequestController.current = controller;
    lastCnpjRequested.current = cnpj;
    setIsLoadingCnpj(true);

    try {
      const response = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            "Muitas consultas foram realizadas. Aguarde um pouco e tente novamente.",
          );
        }
        if (response.status === 400 || response.status === 404) {
          throw new Error("CNPJ não encontrado. Confira o número informado.");
        }
        throw new Error("Não foi possível consultar os dados do CNPJ.");
      }

      const company = await response.json();
      const establishment = company?.estabelecimento;
      const state = String(establishment?.estado?.sigla ?? "").trim().toUpperCase();
      const city = String(establishment?.cidade?.nome ?? "").trim();
      const cityCode = onlyFiscalDigits(establishment?.cidade?.ibge_id).slice(0, 7);

      if (!company?.razao_social || !establishment || !state || !city || !cityCode) {
        throw new Error("A consulta não retornou dados cadastrais suficientes.");
      }

      const phone = onlyFiscalDigits(
        `${establishment.ddd1 ?? establishment.ddd2 ?? ""}${
          establishment.telefone1 ?? establishment.telefone2 ?? ""
        }`,
      ).slice(0, 14);
      const stateRegistrations = Array.isArray(establishment.inscricoes_estaduais)
        ? establishment.inscricoes_estaduais
        : [];
      const stateRegistration = stateRegistrations.find(
        (entry: any) => entry?.ativo !== false && String(entry?.estado?.sigla ?? "").toUpperCase() === state,
      ) ?? stateRegistrations.find((entry: any) => entry?.ativo !== false) ?? stateRegistrations[0];

      if (requestId !== cnpjRequestSequence.current) return;

      setForm((current) => ({
        ...current,
        cpfcnpj: cnpj,
        inscricaoestadual: String(stateRegistration?.inscricao_estadual ?? "").trim(),
        nomerazaosocial: String(company.razao_social ?? "").trim(),
        nomefantasia: String(establishment.nome_fantasia ?? "").trim(),
        endereco: String(establishment.logradouro ?? "").trim(),
        endereconumero: String(establishment.numero ?? "").trim(),
        cidade: city,
        bairro: String(establishment.bairro ?? "").trim(),
        codigomunicipio: cityCode,
        estado: state,
        cep: onlyFiscalDigits(establishment.cep).slice(0, 8),
        contato: phone,
      }));
      toast.success("Dados do CNPJ preenchidos com sucesso.");
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      toast.error(error?.message || "Erro ao consultar o CNPJ.");
    } finally {
      if (requestId === cnpjRequestSequence.current) {
        setIsLoadingCnpj(false);
      }
    }
  }

  async function handleSave() {
    const cpfCnpj = normalizeCpfOrCnpj(form.cpfcnpj);

    if (!hasValidCpfCnpjLength(cpfCnpj) || !(isValidCpf(cpfCnpj) || isValidCnpj(cpfCnpj))) {
      toast.error("Digite um CPF ou CNPJ válido.");
      return;
    }

    if (!form.nomerazaosocial.trim()) {
      toast.error("Nome/Razão Social é obrigatório.");
      return;
    }

    const payload = {
      cpfcnpj: cpfCnpj,
      inscricaoestadual: form.inscricaoestadual?.trim() || null,
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
        inscricaoestadual: fornecedorToEdit.inscricaoestadual ?? "",
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

  useEffect(() => {
    if (!dialogOpen) {
      cnpjRequestSequence.current += 1;
      cnpjRequestController.current?.abort();
      lastCnpjRequested.current = "";
      setIsLoadingCnpj(false);
    }
  }, [dialogOpen]);

  useEffect(() => () => cnpjRequestController.current?.abort(), []);

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
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}

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
                  <div className="relative">
                    <Input
                      className="pr-10"
                      inputMode="text"
                      value={formatCpfCnpj(form.cpfcnpj || "")}
                      onChange={(event) => {
                        const cnpj = normalizeCnpj(event.target.value).slice(0, 14);
                        handleChange("cpfcnpj", cnpj);

                        if (cnpj.length < 14) {
                          cnpjRequestSequence.current += 1;
                          cnpjRequestController.current?.abort();
                          lastCnpjRequested.current = "";
                          setIsLoadingCnpj(false);
                        } else if (
                          /^\d{14}$/.test(cnpj) &&
                          isValidCnpj(cnpj) &&
                          cnpj !== lastCnpjRequested.current
                        ) {
                          void handleGetCnpj(cnpj);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleGetCnpj();
                        }
                      }}
                      placeholder="00.000.000/0000-00"
                      maxLength={18}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-9 w-9"
                      disabled={
                        isLoadingCnpj ||
                        !/^\d{14}$/.test(normalizeCnpj(form.cpfcnpj))
                      }
                      onClick={() => void handleGetCnpj()}
                      aria-label="Consultar CNPJ"
                      title="Consultar CNPJ"
                    >
                      {isLoadingCnpj ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
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
                <Label>Inscrição estadual (opcional)</Label>
                <UppercaseInput
                  value={form.inscricaoestadual}
                  format={(valor) => valor.trim()}
                  onValueChange={(ie) => handleChange("inscricaoestadual", ie)}
                />
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
              <Button
                type="button"
                onClick={handleSave}
                disabled={isSaving || isLoadingCnpj}
              >
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
