"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";

import { useGetCidades } from "@/app/(app)/hooks/useGetCidades";
import { ESTADOS_BRASIL } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { UppercaseInput } from "@/components/ui/uppercase-input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatFiscalCep,
  formatCpfCnpj,
  isValidCnpj,
  isValidCpf,
  onlyFiscalDigits,
} from "@/lib/nfe/recipientNormalization";
import { NFE_XNOME_MAX_LENGTH, sanitizeString } from "@/lib/nfe/xmlUtils";
import { normalizeCnpj, normalizeCpf } from "@/lib/fiscal-identifiers";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type NFeEntrySupplierDraft = {
  fornecedorId: number | null;
  tipoPessoa: "FISICA" | "JURIDICA" | "ESTRANGEIRO";
  cpfCnpj: string;
  nomeRazaoSocial: string;
  indicadorIe: string;
  inscricaoEstadual: string;
  inscricaoMunicipal: string;
  email: string;
  telefone: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  codigoMunicipio: string;
  codigoPais: string;
  nomePais: string;
};

export const emptyEntrySupplier: NFeEntrySupplierDraft = {
  fornecedorId: null,
  tipoPessoa: "JURIDICA",
  cpfCnpj: "",
  nomeRazaoSocial: "",
  indicadorIe: "9",
  inscricaoEstadual: "",
  inscricaoMunicipal: "",
  email: "",
  telefone: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  cep: "",
  codigoMunicipio: "",
  codigoPais: "1058",
  nomePais: "BRASIL",
};

export function getEntrySupplierFieldErrors(value: NFeEntrySupplierDraft) {
  const errors: Partial<Record<keyof NFeEntrySupplierDraft, string>> = {};
  const exterior = value.tipoPessoa === "ESTRANGEIRO";
  const document = value.tipoPessoa === "JURIDICA"
    ? normalizeCnpj(value.cpfCnpj)
    : normalizeCpf(value.cpfCnpj);

  if (value.tipoPessoa === "FISICA" && !isValidCpf(document)) {
    errors.cpfCnpj = "Informe um CPF válido.";
  }
  if (value.tipoPessoa === "JURIDICA" && !isValidCnpj(document)) {
    errors.cpfCnpj = "Informe um CNPJ válido.";
  }
  if (!value.nomeRazaoSocial.trim()) errors.nomeRazaoSocial = "Informe o nome ou razão social.";
  if (value.indicadorIe === "1" && !value.inscricaoEstadual.trim()) {
    errors.inscricaoEstadual = "Informe a inscrição estadual do contribuinte ICMS.";
  }
  if (!value.endereco.trim()) errors.endereco = "Informe o endereço.";
  if (!value.bairro.trim()) errors.bairro = "Informe o bairro.";
  if (!value.cidade.trim()) errors.cidade = "Informe a cidade.";
  if (!exterior && !ESTADOS_BRASIL.includes(value.estado.trim().toUpperCase())) {
    errors.estado = "Selecione uma UF válida.";
  }
  if (exterior && value.estado.trim().toUpperCase() !== "EX") {
    errors.estado = "Use EX como UF para destinatário estrangeiro.";
  }
  if (!exterior && onlyFiscalDigits(value.cep).length !== 8) {
    errors.cep = "CEP deve ter 8 dígitos.";
  }
  if (!exterior && onlyFiscalDigits(value.codigoMunicipio).length !== 7) {
    errors.codigoMunicipio = "Código IBGE do município deve ter 7 dígitos.";
  }
  if (value.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) {
    errors.email = "Informe um e-mail válido ou deixe o campo vazio.";
  }
  return errors;
}

export function validateEntrySupplier(value: NFeEntrySupplierDraft) {
  return Object.values(getEntrySupplierFieldErrors(value));
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>
        {label}{required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function NfeEntrySupplierEditor({
  value,
  onChange,
  title = "Fornecedor da NF-e de entrada",
  description = "Estes dados serão usados somente nesta nota e não alteram o cadastro da entrada.",
  linkedLabel = "Fornecedor vinculado",
  unlinkedLabel = "Fornecedor avulso",
}: {
  value: NFeEntrySupplierDraft;
  onChange: (next: NFeEntrySupplierDraft) => void;
  title?: string;
  description?: string;
  linkedLabel?: string;
  unlinkedLabel?: string;
}) {
  const [loadingCep, setLoadingCep] = useState(false);
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const exterior = value.tipoPessoa === "ESTRANGEIRO";
  const { cidades, loading: loadingCities, error: citiesError } = useGetCidades(
    exterior ? undefined : value.estado,
  );
  const update = <K extends keyof NFeEntrySupplierDraft>(
    field: K,
    fieldValue: NFeEntrySupplierDraft[K],
  ) => onChange({ ...value, [field]: fieldValue });
  const documentValid =
    exterior ||
    (value.tipoPessoa === "FISICA"
      ? isValidCpf(value.cpfCnpj)
      : isValidCnpj(value.cpfCnpj));
  const fieldErrors = getEntrySupplierFieldErrors(value);
  const nomeFiscalTruncado =
    sanitizeString(value.nomeRazaoSocial).length > NFE_XNOME_MAX_LENGTH;

  async function searchCep() {
    const cep = onlyFiscalDigits(value.cep);
    if (cep.length !== 8) {
      toast.error("Informe um CEP com 8 dígitos.");
      return;
    }

    setLoadingCep(true);
    try {
      const response = await fetch(`https://opencep.com/v1/${cep}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(response.status === 404 ? "CEP não encontrado." : "Não foi possível consultar o CEP.");
      }
      const address = await response.json();
      if (!address?.uf || !address?.localidade || !address?.ibge) {
        throw new Error("A consulta não retornou um endereço completo.");
      }
      onChange({
        ...value,
        cep,
        endereco: String(address.logradouro ?? "").trim(),
        bairro: String(address.bairro ?? "").trim(),
        cidade: String(address.localidade ?? "").trim(),
        estado: String(address.uf ?? "").trim().toUpperCase(),
        codigoMunicipio: onlyFiscalDigits(address.ibge).slice(0, 7),
      });
      toast.success("Endereço preenchido pelo CEP.");
    } catch (error: any) {
      toast.error(error?.message || "Erro ao consultar o CEP.");
    } finally {
      setLoadingCep(false);
    }
  }

  async function searchCnpj() {
    const cnpj = normalizeCnpj(value.cpfCnpj);
    if (!isValidCnpj(cnpj)) {
      toast.error("Informe um CNPJ válido para realizar a consulta.");
      return;
    }
    if (/[A-Z]/.test(cnpj)) {
      toast.info("A consulta automática ainda não declara suporte ao CNPJ alfanumérico. Preencha os dados manualmente.");
      return;
    }

    setLoadingCnpj(true);
    try {
      const response = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Muitas consultas foram realizadas. Aguarde um pouco e tente novamente.");
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

      const registrations = Array.isArray(establishment.inscricoes_estaduais)
        ? establishment.inscricoes_estaduais
        : [];
      const stateRegistration =
        registrations.find((entry: any) =>
          entry?.ativo !== false && String(entry?.estado?.sigla ?? "").toUpperCase() === state,
        ) ?? registrations.find((entry: any) => entry?.ativo !== false) ?? registrations[0];
      const ie = onlyFiscalDigits(stateRegistration?.inscricao_estadual);
      const phone = onlyFiscalDigits(
        `${establishment.ddd1 ?? establishment.ddd2 ?? ""}${establishment.telefone1 ?? establishment.telefone2 ?? ""}`,
      ).slice(0, 14);

      onChange({
        ...value,
        tipoPessoa: "JURIDICA",
        cpfCnpj: cnpj,
        nomeRazaoSocial: String(company.razao_social ?? "").trim(),
        indicadorIe: ie ? "1" : value.indicadorIe,
        inscricaoEstadual: ie || value.inscricaoEstadual,
        email: String(establishment.email ?? "").trim().toLowerCase(),
        telefone: phone,
        endereco: String(establishment.logradouro ?? "").trim(),
        numero: String(establishment.numero ?? "").trim(),
        complemento: String(establishment.complemento ?? "").trim(),
        bairro: String(establishment.bairro ?? "").trim(),
        cidade: city,
        estado: state,
        cep: onlyFiscalDigits(establishment.cep).slice(0, 8),
        codigoMunicipio: cityCode,
      });
      toast.success("Dados do CNPJ preenchidos com sucesso.");
    } catch (error: any) {
      toast.error(error?.message || "Erro ao consultar o CNPJ.");
    } finally {
      setLoadingCnpj(false);
    }
  }

  function changeState(estado: string) {
    onChange({
      ...value,
      estado,
      cidade: "",
      codigoMunicipio: "",
    });
  }

  return (
    <section className="min-w-0 space-y-4 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {description}
          </p>
        </div>
        <Badge variant={value.fornecedorId ? "secondary" : "outline"}>
          {value.fornecedorId ? linkedLabel : unlinkedLabel}
        </Badge>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-2">
        <Field label="Tipo de pessoa" required>
          <Select
            value={value.tipoPessoa}
            onValueChange={(next: NFeEntrySupplierDraft["tipoPessoa"]) =>
              update("tipoPessoa", next)
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="JURIDICA">Pessoa jurídica</SelectItem>
              <SelectItem value="FISICA">Pessoa física</SelectItem>
              <SelectItem value="ESTRANGEIRO">Estrangeiro</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="CPF/CNPJ" required={!exterior} error={fieldErrors.cpfCnpj}>
          <div className="relative">
            <Input
              inputMode={value.tipoPessoa === "FISICA" ? "numeric" : "text"}
              aria-invalid={Boolean(value.cpfCnpj) && !documentValid}
              value={formatCpfCnpj(value.cpfCnpj)}
              maxLength={value.tipoPessoa === "FISICA" ? 14 : 18}
              className={value.tipoPessoa === "JURIDICA" ? "pr-10" : undefined}
              placeholder={value.tipoPessoa === "FISICA" ? "000.000.000-00" : "00.000.000/0000-00"}
              onChange={(event) =>
                update(
                  "cpfCnpj",
                  (value.tipoPessoa === "JURIDICA"
                    ? normalizeCnpj(event.target.value)
                    : normalizeCpf(event.target.value)).slice(
                    0,
                    value.tipoPessoa === "FISICA" ? 11 : 14,
                  ),
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && value.tipoPessoa === "JURIDICA") {
                  event.preventDefault();
                  void searchCnpj();
                }
              }}
            />
            {value.tipoPessoa === "JURIDICA" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-9 w-9"
                disabled={loadingCnpj}
                onClick={() => void searchCnpj()}
                aria-label="Consultar CNPJ"
                title="Consultar CNPJ"
              >
                {loadingCnpj
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Search className="h-4 w-4" />}
              </Button>
            ) : null}
          </div>
        </Field>
        <Field label="Nome/Razão social" required error={fieldErrors.nomeRazaoSocial}>
          <Input
            aria-invalid={Boolean(fieldErrors.nomeRazaoSocial)}
            value={value.nomeRazaoSocial}
            onChange={(event) => update("nomeRazaoSocial", event.target.value)}
          />
          {nomeFiscalTruncado ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              O nome será reduzido para {NFE_XNOME_MAX_LENGTH} caracteres no XML da NF-e.
            </p>
          ) : null}
        </Field>
        <Field label="Indicador IE" required>
          <Select value={value.indicadorIe} onValueChange={(next) => update("indicadorIe", next)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Contribuinte ICMS</SelectItem>
              <SelectItem value="2">Contribuinte isento</SelectItem>
              <SelectItem value="9">Não contribuinte</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Inscrição estadual"
          required={value.indicadorIe === "1"}
          error={fieldErrors.inscricaoEstadual}
        >
          <Input
            aria-invalid={Boolean(fieldErrors.inscricaoEstadual)}
            value={value.inscricaoEstadual}
            onChange={(event) => update("inscricaoEstadual", event.target.value)}
          />
        </Field>
        <Field label="Telefone">
          <Input
            value={value.telefone}
            onChange={(event) => update("telefone", event.target.value)}
          />
        </Field>
        <Field label="E-mail" error={fieldErrors.email}>
          <Input
            type="email"
            aria-invalid={Boolean(fieldErrors.email)}
            value={value.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </Field>
        <Field label="CEP" required={!exterior} error={fieldErrors.cep}>
          <div className="relative">
            <Input
              inputMode="numeric"
              aria-invalid={Boolean(fieldErrors.cep)}
              value={formatFiscalCep(value.cep)}
              maxLength={9}
              className="pr-10"
              placeholder="00000-000"
              onChange={(event) =>
                update("cep", onlyFiscalDigits(event.target.value).slice(0, 8))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchCep();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-9 w-9"
              disabled={loadingCep}
              onClick={() => void searchCep()}
              aria-label="Consultar CEP"
              title="Consultar CEP"
            >
              {loadingCep
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Search className="h-4 w-4" />}
            </Button>
          </div>
        </Field>
        <Field label="Endereço" required error={fieldErrors.endereco}>
          <Input
            aria-invalid={Boolean(fieldErrors.endereco)}
            value={value.endereco}
            onChange={(event) => update("endereco", event.target.value)}
          />
        </Field>
        <Field label="Número">
          <Input value={value.numero} onChange={(event) => update("numero", event.target.value)} />
        </Field>
        <Field label="Complemento">
          <Input
            value={value.complemento}
            onChange={(event) => update("complemento", event.target.value)}
          />
        </Field>
        <Field label="Bairro" required error={fieldErrors.bairro}>
          <Input
            aria-invalid={Boolean(fieldErrors.bairro)}
            value={value.bairro}
            onChange={(event) => update("bairro", event.target.value)}
          />
        </Field>
        <Field label="UF" required error={fieldErrors.estado}>
          {exterior ? (
            <UppercaseInput
              value={value.estado}
              maxLength={2}
              placeholder="EX"
              onValueChange={(estado) => update("estado", estado)}
            />
          ) : (
            <Select value={value.estado} onValueChange={changeState}>
              <SelectTrigger aria-invalid={Boolean(fieldErrors.estado)}>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {ESTADOS_BRASIL.map((estado) => (
                  <SelectItem key={estado} value={estado}>{estado}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Cidade" required error={fieldErrors.cidade}>
          {exterior ? (
            <Input
              value={value.cidade}
              onChange={(event) => update("cidade", event.target.value)}
            />
          ) : (
          <Popover open={cityOpen} onOpenChange={setCityOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-invalid={Boolean(fieldErrors.cidade)}
                className="w-full min-w-0 justify-between font-normal"
                disabled={!value.estado || exterior || loadingCities}
              >
                <span className="min-w-0 truncate">
                  {loadingCities
                    ? "Carregando cidades..."
                    : value.cidade || (value.estado ? "Selecione..." : "Selecione a UF")}
                </span>
                {loadingCities
                  ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  : <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[var(--radix-popover-trigger-width)] p-0"
              onWheel={(event) => event.stopPropagation()}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              <Command>
                <CommandInput placeholder="Buscar cidade..." />
                <CommandList className="max-h-56 overflow-y-auto overscroll-contain">
                  <CommandEmpty>
                    {citiesError ? "Não foi possível carregar as cidades." : "Nenhuma cidade encontrada."}
                  </CommandEmpty>
                  <CommandGroup>
                    {cidades.map((cidade) => (
                      <CommandItem
                        key={cidade.id}
                        value={`${cidade.nome} ${cidade.id}`}
                        onSelect={() => {
                          onChange({
                            ...value,
                            cidade: cidade.nome,
                            codigoMunicipio: String(cidade.id),
                          });
                          setCityOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{cidade.nome}</span>
                        <Check
                          className={cn(
                            "h-4 w-4 shrink-0",
                            String(value.codigoMunicipio) === String(cidade.id)
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          )}
        </Field>
        <Field
          label="Código IBGE do município"
          required={!exterior}
          error={fieldErrors.codigoMunicipio}
        >
          <Input
            inputMode="numeric"
            aria-invalid={Boolean(fieldErrors.codigoMunicipio)}
            value={value.codigoMunicipio}
            readOnly={!exterior}
            className={!exterior ? "bg-muted/40" : undefined}
            onChange={(event) => update(
              "codigoMunicipio",
              onlyFiscalDigits(event.target.value).slice(0, 7),
            )}
          />
        </Field>
      </div>
    </section>
  );
}
