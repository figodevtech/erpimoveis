"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requestJson, useRemote } from "./shared";
import { DateChip, OccupancyCalendar, covers, monthStart, todayCivil } from "./availability-panel";
import { AirbnbCodeLink } from "./airbnb";
import { hospedesAConfirmar } from "@/lib/imobiliario/airbnb";
import { type Entity, type ModuleKind, dateInput, dateLabel, money, titleCase } from "./model";
import ProprietarioSelect from "@/app/(app)/components/proprietarioSelect";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import ImovelSelect, { type ImovelItem } from "@/app/(app)/components/imovelSelect";
import type { Customer } from "@/app/(app)/(pages)/clientes/types";
import ValueInput from "@/components/ui/value-input";
import { ComodidadesField } from "./comodidades-field";
import { AddressPlaceFields, placeKey } from "./address-fields";
import { DecimalInput, IntegerInput } from "./numeric-inputs";
import { timeOptions } from "@/components/ui/date-time-picker";
import {
  AlertCircle,
  Building2,
  Calculator,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Search,
  Sparkles,
  Trash2,
  User,
  Users,
  Mail,
  CalendarDays,
  Bed,
  Bath,
  Maximize2,
  RefreshCw,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  documentoCanonico,
  exibirDocumento,
  exibirTelefone,
  mascaraDocumento,
  mascaraTelefone,
  telefoneDigitos,
  type TipoPessoa,
} from "@/lib/format-contato";

const statusOptionClass: Record<string, string> = {
  ATIVO:
    "bg-emerald-100 text-emerald-800 focus:bg-emerald-100 focus:text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 dark:focus:bg-emerald-950/50 dark:focus:text-emerald-300",
  INATIVO:
    "bg-slate-100 text-slate-800 focus:bg-slate-100 focus:text-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:focus:bg-slate-900 dark:focus:text-slate-300",
  PENDENTE:
    "bg-amber-100 text-amber-800 focus:bg-amber-100 focus:text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 dark:focus:bg-amber-950/50 dark:focus:text-amber-300",
};

export type CepResult = {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  estado: string;
  complemento?: string;
};

export function formatCep(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export async function lookupCep(rawCep: string): Promise<CepResult> {
  const clean = rawCep.replace(/\D/g, "").slice(0, 8);
  if (clean.length !== 8) {
    throw new Error("Informe um CEP completo com 8 dígitos.");
  }

  // 1. Tenta ViaCEP
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (!data.erro) {
        return {
          cep: data.cep || `${clean.slice(0, 5)}-${clean.slice(5)}`,
          logradouro: String(data.logradouro ?? "").trim(),
          bairro: String(data.bairro ?? "").trim(),
          cidade: String(data.localidade ?? "").trim(),
          estado: String(data.uf ?? "").trim().toUpperCase(),
          complemento: String(data.complemento ?? "").trim(),
        };
      }
    }
  } catch {
    // ViaCEP falhou, tenta fallback
  }

  // 2. Fallback: BrasilAPI
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${clean}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return {
        cep: `${clean.slice(0, 5)}-${clean.slice(5)}`,
        logradouro: String(data.street ?? "").trim(),
        bairro: String(data.neighborhood ?? "").trim(),
        cidade: String(data.city ?? "").trim(),
        estado: String(data.state ?? "").trim().toUpperCase(),
      };
    }
  } catch {
    // Falha em ambos
  }

  throw new Error("CEP não encontrado. Confira os números informados.");
}

type Props = {
  kind: ModuleKind;
  value: Entity;
  onChange: (value: Entity) => void;
  editing?: boolean;
  disabled?: boolean;
  /** Reserva: abre o cadastro do imóvel ou do cliente vinculado. Sem o callback, o nome é texto puro. */
  onOpenImovel?: (id: number) => void;
  onOpenCliente?: (id: number) => void;
};

export function GeneralFields({ kind, value, onChange, editing, disabled, onOpenImovel, onOpenCliente }: Props) {
  const [cepLoading, setCepLoading] = useState(false);
  const lastSearchedCep = useRef<string>("");
  const numeroInputRef = useRef<HTMLInputElement>(null);

  const [propCepLoading, setPropCepLoading] = useState(false);
  const lastSearchedPropCep = useRef<string>("");
  const propNumeroInputRef = useRef<HTMLInputElement>(null);

  const [proprietarioSelectOpen, setProprietarioSelectOpen] = useState(false);

  const set = (key: string, field: any) => onChange({ ...value, [key]: field });

  // CEP Imóvel
  const address = value.endereco ?? {};
  const handleSearchCep = async (cepToSearch?: string) => {
    const targetCep = cepToSearch ?? address.cep ?? "";
    const clean = targetCep.replace(/\D/g, "");
    if (clean.length !== 8) {
      toast.error("Informe um CEP com 8 dígitos para consultar.");
      return;
    }
    setCepLoading(true);
    lastSearchedCep.current = clean;
    try {
      const result = await lookupCep(clean);
      onChange({
        ...value,
        endereco: {
          ...address,
          cep: result.cep,
          logradouro: result.logradouro || address.logradouro || "",
          bairro: result.bairro || address.bairro || "",
          cidade: result.cidade || address.cidade || "",
          estado: result.estado || address.estado || "",
          // Cidade nova: o código IBGE é refeito pelo combobox quando a lista da UF chega.
          codigo_municipio:
            result.cidade && placeKey(result.cidade) !== placeKey(String(address.cidade ?? ""))
              ? null
              : address.codigo_municipio ?? null,
          ...(result.complemento && !address.complemento ? { complemento: result.complemento } : {}),
        },
      });
      toast.success("Endereço localizado!", {
        description: `${result.logradouro || "Logradouro"}, ${result.bairro || "Bairro"} · ${result.cidade}/${result.estado}`,
      });
      setTimeout(() => numeroInputRef.current?.focus(), 80);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao consultar o CEP.");
    } finally {
      setCepLoading(false);
    }
  };

  const handleCepChange = (raw: string) => {
    const formatted = formatCep(raw);
    const clean = formatted.replace(/\D/g, "");
    set("endereco", { ...address, cep: formatted });
    if (clean.length === 8 && clean !== lastSearchedCep.current) {
      handleSearchCep(clean);
    }
  };

  // CEP Proprietário
  const handleSearchPropCep = async (cepToSearch?: string) => {
    const targetCep = cepToSearch ?? value.cep ?? "";
    const clean = targetCep.replace(/\D/g, "");
    if (clean.length !== 8) {
      toast.error("Informe um CEP com 8 dígitos para consultar.");
      return;
    }
    setPropCepLoading(true);
    lastSearchedPropCep.current = clean;
    try {
      const result = await lookupCep(clean);
      onChange({
        ...value,
        cep: result.cep,
        endereco: result.logradouro || value.endereco || "",
        bairro: result.bairro || value.bairro || "",
        cidade: result.cidade || value.cidade || "",
        estado: result.estado || value.estado || "",
        ...(result.complemento && !value.enderecocomplemento ? { enderecocomplemento: result.complemento } : {}),
      });
      toast.success("Endereço localizado!", {
        description: `${result.logradouro || "Logradouro"}, ${result.bairro || "Bairro"} · ${result.cidade}/${result.estado}`,
      });
      setTimeout(() => propNumeroInputRef.current?.focus(), 80);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao consultar o CEP.");
    } finally {
      setPropCepLoading(false);
    }
  };

  const handlePropCepChange = (raw: string) => {
    const formatted = formatCep(raw);
    const clean = formatted.replace(/\D/g, "");
    set("cep", formatted);
    if (clean.length === 8 && clean !== lastSearchedPropCep.current) {
      handleSearchPropCep(clean);
    }
  };

  if (kind === "proprietarios") {
    const tipoPessoa: TipoPessoa = value.tipopessoa === "JURIDICA" ? "JURIDICA" : "FISICA";
    return (
      <div className="space-y-6">
        {/* Card Topo com Avatar e Status (padrão customerDialogRegister) */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <Avatar className="h-12 w-12 sm:h-14 sm:w-14">
                  <AvatarFallback className="text-sm">
                    {value.tipopessoa === "JURIDICA" ? (
                      <Building2 className="h-5 w-5 sm:h-6 sm:w-6" />
                    ) : (
                      <User className="h-5 w-5 sm:h-6 sm:w-6" />
                    )}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {value.nomerazaosocial?.trim() || `Proprietário #${value.id || "Novo"}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {value.id ? `ID #${value.id} · ` : ""}
                  Atualize os dados cadastrais do proprietário.
                </p>
              </div>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="prop-status" className="text-sm">
                  Status
                </Label>
                <Select
                  value={value.ativo === false ? "INATIVO" : "ATIVO"}
                  onValueChange={(val) => set("ativo", val === "ATIVO")}
                  disabled={disabled}
                >
                  <SelectTrigger
                    className={cn(
                      "h-10 sm:h-11",
                      value.ativo === false ? statusOptionClass.INATIVO : statusOptionClass.ATIVO
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="ATIVO"
                      className={cn("px-2 py-1.5 text-sm font-medium hover:cursor-pointer", statusOptionClass.ATIVO)}
                    >
                      Ativo
                    </SelectItem>
                    <SelectItem
                      value="INATIVO"
                      className={cn("px-2 py-1.5 text-sm font-medium hover:cursor-pointer", statusOptionClass.INATIVO)}
                    >
                      Inativo
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="prop-tipopessoa" className="text-sm">
                  Tipo de Pessoa *
                </Label>
                <Select
                  value={value.tipopessoa ?? "FISICA"}
                  // Como no cadastro de cliente: CPF não serve de CNPJ (nem o contrário), então
                  // trocar o tipo limpa o documento para ser digitado com a máscara certa.
                  onValueChange={(val) =>
                    onChange({ ...value, tipopessoa: val, ...(val !== tipoPessoa ? { cpfcnpj: "" } : {}) })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger className="h-10 sm:h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FISICA" className="hover:cursor-pointer">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        <span>Pessoa Física</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="JURIDICA" className="hover:cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        <span>Pessoa Jurídica</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Dados Principais */}
        <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="cpfcnpj" className="text-sm">
                {value.tipopessoa === "JURIDICA" ? "CNPJ" : "CPF"} *
              </Label>
              {/* Mostra com máscara e grava o canônico (só dígitos; CNPJ alfanumérico em maiúsculas). */}
              <Input
                id="cpfcnpj"
                disabled={disabled}
                inputMode={tipoPessoa === "JURIDICA" ? "text" : "numeric"}
                autoComplete="off"
                maxLength={18}
                value={mascaraDocumento(value.cpfcnpj, tipoPessoa)}
                onChange={(e) => set("cpfcnpj", documentoCanonico(e.target.value, tipoPessoa))}
                placeholder={tipoPessoa === "JURIDICA" ? "00.000.000/0000-00" : "000.000.000-00"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nomerazaosocial" className="text-sm">
                {value.tipopessoa === "JURIDICA" ? "Razão Social" : "Nome Completo"} *
              </Label>
              <Input
                id="nomerazaosocial"
                disabled={disabled}
                value={value.nomerazaosocial || ""}
                onChange={(e) => set("nomerazaosocial", e.target.value)}
                placeholder={value.tipopessoa === "JURIDICA" ? "Empresa LTDA" : "João da Silva"}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2 text-sm">
                <Mail className="h-3 w-3 sm:h-4 sm:w-4" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                disabled={disabled}
                value={value.email || ""}
                onChange={(e) => set("email", e.target.value)}
                placeholder="proprietario@email.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefone" className="flex items-center gap-2 text-sm">
                <Phone className="h-3 w-3 sm:h-4 sm:w-4" />
                Telefone (principal)
              </Label>
              <Input
                id="telefone"
                type="tel"
                inputMode="tel"
                disabled={disabled}
                maxLength={15}
                value={mascaraTelefone(value.telefone)}
                onChange={(e) => set("telefone", telefoneDigitos(e.target.value))}
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>

          <Separator className="mt-4" />

          {/* Endereço */}
          <div className="space-y-3 sm:space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-center gap-2">
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="prop-cep" className="text-sm">
                  CEP
                </Label>
                <div className="relative">
                  {propCepLoading ? (
                    <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSearchPropCep()}
                      className="absolute right-2 top-1.5 rounded-3xl p-1 transition-all hover:bg-gray-500/20"
                      aria-label="Consultar CEP"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  )}
                  <Input
                    id="prop-cep"
                    disabled={disabled}
                    value={formatCep(value.cep) || ""}
                    onChange={(e) => handlePropCepChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSearchPropCep();
                      }
                    }}
                    placeholder="00000-000"
                    maxLength={9}
                  />
                </div>
              </div>

              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="prop-endereco" className="flex items-center gap-1.5 text-sm">
                  <MapPin className="h-4 w-4" />
                  Endereço Completo
                </Label>
                <Input
                  id="prop-endereco"
                  disabled={disabled}
                  value={value.endereco || ""}
                  onChange={(e) => set("endereco", e.target.value)}
                  placeholder="Rua, número, complemento, bairro"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prop-endereconumero" className="text-sm">
                  Número
                </Label>
                <Input
                  ref={propNumeroInputRef}
                  id="prop-endereconumero"
                  disabled={disabled}
                  value={value.endereconumero || ""}
                  onChange={(e) => set("endereconumero", e.target.value)}
                  placeholder="123"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="prop-complemento" className="text-sm">
                  Complemento
                </Label>
                <Input
                  id="prop-complemento"
                  disabled={disabled}
                  value={value.enderecocomplemento || ""}
                  onChange={(e) => set("enderecocomplemento", e.target.value)}
                  placeholder="Apto, Sala..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prop-bairro" className="text-sm">
                  Bairro
                </Label>
                <Input
                  id="prop-bairro"
                  disabled={disabled}
                  value={value.bairro || ""}
                  onChange={(e) => set("bairro", e.target.value)}
                  placeholder="Bairro"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prop-cidade" className="text-sm">
                  Cidade
                </Label>
                <Input
                  id="prop-cidade"
                  disabled={disabled}
                  value={value.cidade || ""}
                  onChange={(e) => set("cidade", e.target.value)}
                  placeholder="Cidade"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prop-estado" className="text-sm">
                  Estado (UF)
                </Label>
                <Input
                  id="prop-estado"
                  disabled={disabled}
                  maxLength={2}
                  className="uppercase"
                  value={value.estado || ""}
                  onChange={(e) => set("estado", e.target.value.toUpperCase())}
                  placeholder="UF"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Telefones adicionais */}
        <Phones value={value.telefones ?? []} onChange={(phones) => set("telefones", phones)} disabled={disabled} />

        {/* Administração e pagamento */}
        <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Administração e Repasses</p>
            <p className="text-xs text-muted-foreground">Configuração de taxas e dados bancários para depósitos.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="percentual_admin" className="text-sm">
                Taxa de Administração (%)
              </Label>
              <Input
                id="percentual_admin"
                type="number"
                step="0.01"
                min="0"
                max="100"
                disabled={disabled}
                value={value.percentual_admin ?? ""}
                onChange={(e) => set("percentual_admin", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="Ex: 15"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pix" className="text-sm">
                Chave Pix para Repasse
              </Label>
              <Input
                id="pix"
                disabled={disabled}
                value={value.dados_bancarios?.pix ?? ""}
                onChange={(e) =>
                  set("dados_bancarios", { ...value.dados_bancarios, pix: e.target.value })
                }
                placeholder="CPF, email ou chave aleatória"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="conta" className="text-sm">
                Banco / Agência / Conta
              </Label>
              <Input
                id="conta"
                disabled={disabled}
                value={value.dados_bancarios?.conta ?? ""}
                onChange={(e) =>
                  set("dados_bancarios", { ...value.dados_bancarios, conta: e.target.value })
                }
                placeholder="Banco, Ag e Conta"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="observacoes" className="text-sm">
              Observações Gerais
            </Label>
            <Textarea
              id="observacoes"
              disabled={disabled}
              rows={3}
              value={value.observacoes ?? ""}
              onChange={(e) => set("observacoes", e.target.value)}
              placeholder="Instruções de contato, observações do contrato..."
            />
          </div>
        </div>
      </div>
    );
  }

  if (kind === "imoveis") {
    return (
      <div className="space-y-6">
        {/* Card Topo com Avatar e Status (padrão customerDialogRegister) */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <Avatar className="h-12 w-12 sm:h-14 sm:w-14">
                  <AvatarFallback className="text-sm">
                    <Building2 className="h-5 w-5 sm:h-6 sm:w-6" />
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {value.titulo?.trim() || (value.id ? `Imóvel #${value.id}` : "Novo Imóvel")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {value.id ? `ID #${value.id} · ` : ""}
                  Atualize os dados cadastrais do imóvel.
                </p>
              </div>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="imovel-status" className="text-sm">
                  Status
                </Label>
                <Select
                  value={value.ativo === false ? "INATIVO" : "ATIVO"}
                  onValueChange={(val) => set("ativo", val === "ATIVO")}
                  disabled={disabled}
                >
                  <SelectTrigger
                    className={cn(
                      "h-10 sm:h-11",
                      value.ativo === false ? statusOptionClass.INATIVO : statusOptionClass.ATIVO
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="ATIVO"
                      className={cn("px-2 py-1.5 text-sm font-medium hover:cursor-pointer", statusOptionClass.ATIVO)}
                    >
                      Ativo
                    </SelectItem>
                    <SelectItem
                      value="INATIVO"
                      className={cn("px-2 py-1.5 text-sm font-medium hover:cursor-pointer", statusOptionClass.INATIVO)}
                    >
                      Inativo
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="imovel-tipo" className="text-sm">
                  Tipo de Imóvel *
                </Label>
                <Select
                  value={value.tipo ?? "FLAT"}
                  onValueChange={(val) => set("tipo", val)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-10 sm:h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["FLAT", "APARTAMENTO", "CASA", "TERRENO", "COMERCIAL", "OUTRO"].map((tipo) => (
                      <SelectItem key={tipo} value={tipo} className="hover:cursor-pointer">
                        {titleCase(tipo)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Dados Principais */}
        <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
          <div className="space-y-2">
            <Label htmlFor="titulo" className="text-sm">
              Título do Imóvel *
            </Label>
            <Input
              id="titulo"
              disabled={disabled}
              value={value.titulo || ""}
              onChange={(e) => set("titulo", e.target.value)}
              placeholder="Ex: Flat Enseada Vista Mar"
            />
          </div>

          {/* Proprietário Vinculado */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Proprietário Vinculado</Label>
              {value.proprietario_id ? (
                <span className="text-[11px] text-muted-foreground">
                  (Vínculo confirmado ao salvar)
                </span>
              ) : null}
            </div>

            {value.proprietario_id ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-border/70 bg-muted/20">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
                    {value.proprietario?.tipopessoa === "JURIDICA" ? (
                      <Building2 className="h-5 w-5" />
                    ) : (
                      <User className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground truncate">
                        {value.proprietario?.nomerazaosocial || `Proprietário #${value.proprietario_id}`}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono px-1.5 py-0 bg-muted text-muted-foreground"
                      >
                        ID #{value.proprietario_id}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {value.proprietario?.cpfcnpj ? (
                        <span>Documento: {exibirDocumento(value.proprietario.cpfcnpj)}</span>
                      ) : null}
                      {value.proprietario?.telefone ? (
                        <span>Tel: {exibirTelefone(value.proprietario.telefone)}</span>
                      ) : null}
                      {value.proprietario?.email ? (
                        <span>{value.proprietario.email}</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {!disabled ? (
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setProprietarioSelectOpen(true)}
                      className="h-8 text-xs hover:cursor-pointer"
                    >
                      Alterar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onChange({ ...value, proprietario_id: null, proprietario: null });
                      }}
                      className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:cursor-pointer"
                    >
                      Remover
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl border border-dashed border-border/80 bg-muted/10">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground border">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Nenhum proprietário vinculado</p>
                    <p className="text-xs text-muted-foreground">
                      Selecione o proprietário responsável por este imóvel para repasses e contratos.
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => setProprietarioSelectOpen(true)}
                  className="h-9 px-3.5 text-xs gap-1.5 hover:cursor-pointer font-medium shadow-2xs shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  <span>Vincular Proprietário</span>
                </Button>
              </div>
            )}

            <ProprietarioSelect
              open={proprietarioSelectOpen}
              setOpen={setProprietarioSelectOpen}
              OnSelect={(proprietario) => {
                onChange({
                  ...value,
                  proprietario_id: proprietario.id,
                  proprietario: proprietario,
                });
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao" className="text-sm">
              Descrição
            </Label>
            <Textarea
              id="descricao"
              disabled={disabled}
              rows={3}
              value={value.descricao || ""}
              onChange={(e) => set("descricao", e.target.value)}
              placeholder="Descreva detalhes, acabamentos e diferenciais do imóvel..."
            />
          </div>

          <Separator className="mt-4" />

          {/* Endereço Interno com Busca de CEP */}
          <div className="space-y-3 sm:space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-center gap-2">
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="cep" className="text-sm">
                  CEP
                </Label>
                <div className="relative">
                  {cepLoading ? (
                    <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSearchCep()}
                      className="absolute right-2 top-1.5 rounded-3xl p-1 transition-all hover:bg-gray-500/20"
                      aria-label="Consultar CEP"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  )}
                  <Input
                    id="cep"
                    disabled={disabled}
                    value={formatCep(address.cep) || ""}
                    onChange={(e) => handleCepChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSearchCep();
                      }
                    }}
                    placeholder="00000-000"
                    maxLength={9}
                  />
                </div>
              </div>

              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="logradouro" className="flex items-center gap-1.5 text-sm">
                  <MapPin className="h-4 w-4" />
                  Endereço Completo
                </Label>
                <Input
                  id="logradouro"
                  disabled={disabled}
                  value={address.logradouro || ""}
                  onChange={(e) => set("endereco", { ...address, logradouro: e.target.value })}
                  placeholder="Rua, número, complemento, bairro"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="numero" className="text-sm">
                  Número
                </Label>
                <Input
                  ref={numeroInputRef}
                  id="numero"
                  disabled={disabled}
                  value={address.numero || ""}
                  onChange={(e) => set("endereco", { ...address, numero: e.target.value })}
                  placeholder="123"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="complemento" className="text-sm">
                  Complemento
                </Label>
                <Input
                  id="complemento"
                  disabled={disabled}
                  value={address.complemento || ""}
                  onChange={(e) => set("endereco", { ...address, complemento: e.target.value })}
                  placeholder="Apto 101, Bloco A"
                />
              </div>

              {/* Estado → cidade (IBGE) → bairro (já cadastrados ou novo); o CEP preenche os três. */}
              <AddressPlaceFields
                address={address}
                disabled={disabled}
                onChange={(next) => set("endereco", next)}
              />
            </div>
          </div>
        </div>

        {/* Capacidade e Dimensões */}
        <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Capacidade e Dimensões</p>
            <p className="text-xs text-muted-foreground">Informe a estrutura e acomodações do imóvel.</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="capacidade" className="text-sm">
                Máx. Hóspedes *
              </Label>
              <IntegerInput
                id="capacidade"
                fallback={1}
                disabled={disabled}
                value={value.capacidade}
                onChange={(n) => set("capacidade", n)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="area" className="text-sm">
                Área (m²)
              </Label>
              <DecimalInput
                id="area"
                placeholder="0,00"
                disabled={disabled}
                value={value.area}
                onChange={(n) => set("area", n)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quartos" className="text-sm">
                Quartos
              </Label>
              <IntegerInput
                id="quartos"
                disabled={disabled}
                value={value.quartos}
                onChange={(n) => set("quartos", n)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="banheiros" className="text-sm">
                Banheiros
              </Label>
              <IntegerInput
                id="banheiros"
                disabled={disabled}
                value={value.banheiros}
                onChange={(n) => set("banheiros", n)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vagas" className="text-sm">
                Vagas
              </Label>
              <IntegerInput
                id="vagas"
                disabled={disabled}
                value={value.vagas}
                onChange={(n) => set("vagas", n)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comodidades" className="text-sm">
              Comodidades
            </Label>
            <ComodidadesField
              value={value.comodidades}
              disabled={disabled}
              onChange={(next) => set("comodidades", next)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="regras" className="text-sm">
              Regras da Hospedagem
            </Label>
            <Textarea
              id="regras"
              disabled={disabled}
              rows={2}
              value={value.regras ?? ""}
              onChange={(e) => set("regras", e.target.value)}
              placeholder="Proibido animais, silêncio após 22h, proibido festas..."
            />
          </div>
        </div>

        {/* Valores e Administração */}
        <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Tabela de Preços e Taxas</p>
            <p className="text-xs text-muted-foreground">Valores padrões para as cotações das reservas.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="diaria" className="text-sm">
                Diária Padrão
              </Label>
              <ValueInput
                id="diaria"
                disabled={disabled}
                allowEmpty
                value={value.diaria != null && value.diaria !== "" ? Number(value.diaria) : null}
                onValueChange={(val) => set("diaria", val)}
                onEmpty={() => set("diaria", null)}
                placeholder="R$ 0,00"
                className="h-10 sm:h-11"
              />
            </div>
            {/* Sem taxa de limpeza fixa nem caução no imóvel: a limpeza é lançada na reserva,
                como evento financeiro (custo da imobiliária ou despesa do proprietário). */}
            <div className="space-y-2">
              <Label htmlFor="percentual_admin" className="text-sm">
                Taxa de Administração (%)
              </Label>
              <Input
                id="percentual_admin"
                type="number"
                step="0.01"
                min="0"
                max="100"
                disabled={disabled}
                value={value.percentual_admin ?? ""}
                onChange={(e) => set("percentual_admin", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="Ex: 15"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "reservas") {
    return (
      <ReservationGeneralFields
        value={value}
        onChange={onChange}
        editing={editing}
        disabled={disabled}
        onOpenImovel={onOpenImovel}
        onOpenCliente={onOpenCliente}
      />
    );
  }

  return null;
}

function formatDocument(val?: string | null): string {
  if (!val) return "—";
  const digits = val.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return val;
}

function formatPhone(phone?: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function calculateNights(inicio?: string | null, fim?: string | null): number | null {
  if (!inicio || !fim) return null;
  const d1 = new Date(`${inicio.slice(0, 10)}T12:00:00`);
  const d2 = new Date(`${fim.slice(0, 10)}T12:00:00`);
  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return isNaN(diffDays) ? null : diffDays;
}

/** "14:00:00" → "14:00". */
const hhmm = (value: unknown) => (value ? String(value).slice(0, 5) : "");

/** Diz se o horário é o do imóvel ou foi trocado nesta reserva. */
function defaultHint(own: unknown, property: unknown, fallback: string) {
  const padrao = hhmm(property) || fallback;
  if (!hhmm(own) || hhmm(own) === padrao) return `Padrão do imóvel: ${padrao}`;
  return `Alterado nesta reserva (padrão do imóvel: ${padrao})`;
}

/** Horário de entrada ou saída da reserva, de meia em meia hora (como o seletor de data e hora). */
function HorarioSelect({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} title={label} className="h-[3.25rem] w-24 shrink-0 rounded-xl tabular-nums">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {timeOptions(value).map((option) => (
          <SelectItem key={option} value={option} className="tabular-nums">
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Nome que abre o cadastro vinculado; segue clicável mesmo com o formulário bloqueado, pois só navega. */
function LinkedName({ label, title, onOpen }: { label: string; title: string; onOpen?: () => void }) {
  if (!onOpen) return <>{label}</>;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="text-left underline-offset-4 transition-colors hover:cursor-pointer hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
    >
      {label}
    </button>
  );
}

/**
 * Reserva do Airbnb: de onde veio (código que abre no Airbnb) e se o calendário do Airbnb ainda
 * confirma as mesmas datas. O ERP não cancela nem muda a reserva sozinho: avisa e deixa o operador agir.
 */
function AirbnbReservationNotice({
  codigo,
  value,
  inicio,
  fim,
  evento,
  carregado,
  onUseDates,
}: {
  codigo: string;
  value: Entity;
  inicio: string | null;
  fim: string | null;
  evento: Entity | null;
  carregado: boolean;
  onUseDates?: () => void;
}) {
  const status = String(value.status ?? "CONFIRMADA");
  const aberta = ["CONFIRMADA", "EM_ANDAMENTO"].includes(status);
  // Reserva já encerrada sai do calendário do Airbnb com o tempo; aí não é sinal de cancelamento.
  const sumiu = carregado && !evento && aberta && (!value.id || !fim || fim >= todayCivil());
  const eventoFim = evento ? dateInput(evento.fim) : null;
  // O iCal só traz de hoje em diante: na estadia em andamento a entrada chega cortada em hoje.
  const hoje = todayCivil();
  const eventoInicioBruto = evento ? dateInput(evento.inicio) : null;
  const eventoInicio =
    eventoInicioBruto && inicio && eventoInicioBruto > inicio && eventoInicioBruto <= hoje ? inicio : eventoInicioBruto;
  const mudou = Boolean(evento && aberta && inicio && fim && (eventoInicio !== inicio || eventoFim !== fim));
  // O que a reserva cadastrada sozinha ainda espera do operador (o iCal não traz hóspede nem valores).
  const pendencias = [
    value.cliente?.codigo_sistema === "hospede_airbnb" ? "trocar o Hóspede Airbnb pelo hóspede real (cliente com CPF ou CNPJ)" : null,
    hospedesAConfirmar(value) ? "confirmar o número de hóspedes (o Airbnb não informa)" : null,
    value.id && Number(value.valor_total ?? 0) <= 0 ? "informar os valores da reserva (obrigatório para o check-in)" : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-[#e0565b]/25 bg-[#e0565b]/[0.06] p-4">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[#e0565b]" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            Reserva do Airbnb <AirbnbCodeLink codigo={codigo} />
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {value.cotacao_snapshot?.registro_automatico || value.cliente?.codigo_sistema === "hospede_airbnb"
              ? "Cadastrada automaticamente pelo calendário do Airbnb. "
              : ""}
            O imóvel e as datas seguem o Airbnb (mudanças lá chegam aqui sozinhas). Cancelamento é feito no Airbnb: na
            sincronização do calendário, o ERP cancela a reserva aqui. Ela não pode ser cancelada nem excluída no ERP.
          </p>
          {pendencias.length ? (
            <p className="text-xs font-medium leading-relaxed text-foreground">
              Falta {pendencias.join(" e ")}.
            </p>
          ) : null}
        </div>
      </div>
      {sumiu ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300" role="status">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {!value.id
              ? "Esta reserva não está no calendário do Airbnb deste imóvel. Atualize o calendário na aba Booking e Airbnb e tente de novo."
              : status === "EM_ANDAMENTO"
              ? "Esta reserva saiu do calendário do Airbnb com o hóspede em check-in. Confira no Airbnb e registre o check-out."
              : "Esta reserva não aparece mais no calendário do Airbnb: na próxima sincronização, o ERP a cancela aqui."}
          </span>
        </div>
      ) : null}
      {mudou && eventoInicio && eventoFim ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300" role="status">
          <span className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No Airbnb, a entrada agora é {dateLabel(eventoInicio)} e a saída {dateLabel(eventoFim)}.
          </span>
          {onUseDates ? (
            <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs hover:cursor-pointer" onClick={onUseDates}>
              Usar as datas do Airbnb
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReservationGeneralFields({
  value,
  onChange,
  disabled,
  onOpenImovel,
  onOpenCliente,
}: {
  value: Entity;
  onChange: (value: Entity) => void;
  editing?: boolean;
  disabled?: boolean;
  onOpenImovel?: (id: number) => void;
  onOpenCliente?: (id: number) => void;
}) {
  const [imovelSelectOpen, setImovelSelectOpen] = useState(false);
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);

  const set = (key: string, fieldVal: any) => onChange({ ...value, [key]: fieldVal });

  const imovel = value.imovel;
  const cliente = value.cliente;
  const nights = calculateNights(value.inicio, value.fim);
  // Sem horário próprio, a reserva mostra (e o banco grava) o padrão do imóvel.
  const checkin = hhmm(value.horario_checkin) || hhmm(imovel?.horario_checkin) || "14:00";
  const checkout = hhmm(value.horario_checkout) || hhmm(imovel?.horario_checkout) || "12:00";

  // Disponibilidade do imóvel: o calendário aparece sempre e marca as ocupações quando há imóvel.
  const imovelId = value.imovel_id ? Number(value.imovel_id) : null;
  const reservaId = value.id ? Number(value.id) : null;
  // Reserva do Airbnb: imóvel e datas seguem o evento do calendário do Airbnb com este código.
  const codigoAirbnb = value.codigo_externo ? String(value.codigo_externo) : null;
  const ocupacao = useRemote<{ items?: Entity[] }>(imovelId ? `/api/imoveis/${imovelId}/disponibilidade` : null);
  const tarifas = useRemote<{ items?: Entity[] }>(imovelId ? `/api/imoveis/${imovelId}/tarifas` : null);
  // A ocupação da própria reserva não conta (na do Airbnb, o evento dela); dados de outro imóvel
  // (troca em andamento) também não.
  const ocupadas = useMemo(
    () =>
      (ocupacao.data?.items ?? []).filter(
        (row) =>
          Number(row.imovel_id) === imovelId &&
          !(reservaId && Number(row.reserva_id) === reservaId) &&
          !(codigoAirbnb && row.calendario_codigo === codigoAirbnb)
      ),
    [ocupacao.data, imovelId, reservaId, codigoAirbnb]
  );
  const eventoAirbnb = codigoAirbnb
    ? (ocupacao.data?.items ?? []).find((row) => Number(row.imovel_id) === imovelId && row.calendario_codigo === codigoAirbnb) ?? null
    : null;
  const tarifasDoImovel = useMemo(
    () => (tarifas.data?.items ?? []).filter((row) => Number(row.imovel_id) === imovelId),
    [tarifas.data, imovelId]
  );
  const disponibilidadeCarregada = Boolean(imovelId && ocupacao.data && !ocupacao.loading);
  const inicio = dateInput(value.inicio) || null;
  const fim = dateInput(value.fim) || null;
  const [mes, setMes] = useState(() => monthStart(inicio ?? todayCivil()));
  // Reserva carregada depois de abrir o diálogo: o calendário vai para o mês da entrada.
  const mesAjustado = useRef(Boolean(inicio));
  useEffect(() => {
    if (inicio && !mesAjustado.current) {
      mesAjustado.current = true;
      setMes(monthStart(inicio));
    }
  }, [inicio]);

  const noiteOcupada = (dia: string) => ocupadas.some((row) => covers(row, dia));
  // Escolhendo a saída: vai até a primeira noite ocupada depois da entrada (a saída pode ser o
  // dia em que outra reserva entra).
  const limiteSaida =
    inicio && !fim
      ? ocupadas.map((row) => String(row.inicio)).filter((dia) => dia > inicio).sort()[0] ?? null
      : null;
  const diaIndisponivel = (dia: string) =>
    inicio && !fim && dia > inicio ? Boolean(limiteSaida && dia > limiteSaida) : noiteOcupada(dia);
  // 1º clique: entrada. 2º clique: saída (no dia da entrada ou antes, recomeça). Período fechado: recomeça.
  const escolherDia = (dia: string) =>
    onChange(!inicio || fim || dia <= inicio ? { ...value, inicio: dia, fim: "" } : { ...value, fim: dia });

  // Datas escolhidas antes do imóvel que caem em período ocupado saem sem aviso.
  useEffect(() => {
    if (disabled || !disponibilidadeCarregada || !inicio) return;
    const conflito = fim
      ? ocupadas.some((row) => String(row.inicio) < fim && (!row.fim || String(row.fim) > inicio))
      : ocupadas.some((row) => covers(row, inicio));
    if (conflito) onChange({ ...value, inicio: "", fim: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, disponibilidadeCarregada, ocupadas, inicio, fim]);

  // Fallback seguro caso imovel_id exista mas os detalhes ainda não tenham sido injetados
  useEffect(() => {
    if (value.imovel_id && (!imovel || !imovel.titulo)) {
      requestJson(`/api/imoveis/${value.imovel_id}`)
        .then((res) => {
          const item = res?.item ?? res;
          if (item) {
            onChange({ ...value, imovel: item });
          }
        })
        .catch(() => {});
    }
  }, [value.imovel_id]);

  // Fallback seguro caso cliente_id exista mas os detalhes ainda não tenham sido injetados
  useEffect(() => {
    if (value.cliente_id && (!cliente || !cliente.nomerazaosocial)) {
      axios
        .get("/api/customers/busca", {
          params: { search: String(value.cliente_id), limit: 1 },
        })
        .then((res) => {
          const item = res.data?.data?.[0];
          if (item) {
            onChange({ ...value, cliente: item });
          }
        })
        .catch(() => {});
    }
  }, [value.cliente_id]);

  const imovelEndereco = [
    imovel?.endereco?.bairro || imovel?.endereco_publico?.bairro,
    imovel?.endereco?.cidade || imovel?.endereco_publico?.cidade,
    imovel?.endereco?.estado || imovel?.endereco_publico?.estado,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      {codigoAirbnb ? (
        <AirbnbReservationNotice
          codigo={codigoAirbnb}
          value={value}
          inicio={inicio}
          fim={fim}
          evento={eventoAirbnb}
          carregado={disponibilidadeCarregada}
          onUseDates={
            disabled || !eventoAirbnb
              ? undefined
              : () => onChange({ ...value, inicio: dateInput(eventoAirbnb.inicio), fim: dateInput(eventoAirbnb.fim) })
          }
        />
      ) : null}

      {/* 1. CARD: IMÓVEL VINCULADO */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                Imóvel da Hospedagem
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Propriedade vinculada à estadia e parâmetros da hospedagem.
            </p>
          </div>

          {imovel || value.imovel_id ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || Boolean(codigoAirbnb)}
                title={codigoAirbnb ? "A reserva do Airbnb fica no imóvel do anúncio" : undefined}
                onClick={() => setImovelSelectOpen(true)}
                className="h-8 text-xs gap-1.5 hover:cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Trocar Imóvel
              </Button>
              {!disabled && !codigoAirbnb ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ ...value, imovel_id: null, imovel: null })}
                  className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 hover:cursor-pointer"
                  title="Desvincular imóvel"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {imovel || value.imovel_id ? (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-4 rounded-lg border border-border/70 bg-muted/20 p-3.5 sm:p-4">
            {/* Foto ou Placeholder */}
            <div className="relative h-32 sm:h-28 sm:w-36 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted/50">
              {imovel?.foto_capa ? (
                <img
                  src={imovel.foto_capa}
                  alt={imovel?.titulo || "Foto do imóvel"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                  <Building2 className="h-8 w-8 stroke-[1.5]" />
                  <span className="text-[10px] uppercase font-medium tracking-wide">Sem foto</span>
                </div>
              )}
              <span className="absolute bottom-1.5 left-1.5 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground backdrop-blur-xs border border-border/40 shadow-xs">
                #{imovel?.codigo || imovel?.id || value.imovel_id}
              </span>
            </div>

            {/* Conteúdo Imóvel */}
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-sm sm:text-base text-foreground leading-snug">
                    <LinkedName
                      label={imovel?.titulo || `Imóvel #${value.imovel_id}`}
                      title="Abrir cadastro do imóvel"
                      onOpen={value.imovel_id && onOpenImovel ? () => onOpenImovel(Number(value.imovel_id)) : undefined}
                    />
                  </h4>
                  {imovel?.tipo ? (
                    <Badge variant="secondary" className="text-[11px] font-normal">
                      {titleCase(imovel.tipo)}
                    </Badge>
                  ) : null}
                  {imovel?.situacao_operacional ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[11px]",
                        imovel.situacao_operacional === "DISPONIVEL"
                          ? "border-emerald-500/30 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400"
                          : "border-slate-500/30 text-slate-700 bg-slate-500/10 dark:text-slate-300"
                      )}
                    >
                      {titleCase(imovel.situacao_operacional)}
                    </Badge>
                  ) : null}
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
                  <span className="truncate">{imovelEndereco || "Endereço cadastrado no imóvel"}</span>
                </div>
              </div>

              {/* Especificações */}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs border border-border/50 text-foreground">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  Até {imovel?.capacidade ?? 1} hóspedes
                </span>
                {imovel?.quartos != null ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs border border-border/50 text-foreground">
                    <Bed className="h-3.5 w-3.5 text-muted-foreground" />
                    {imovel.quartos} {imovel.quartos === 1 ? "quarto" : "quartos"}
                  </span>
                ) : null}
                {imovel?.banheiros != null ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs border border-border/50 text-foreground">
                    <Bath className="h-3.5 w-3.5 text-muted-foreground" />
                    {imovel.banheiros} {imovel.banheiros === 1 ? "banheiro" : "banheiros"}
                  </span>
                ) : null}
                {imovel?.area ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs border border-border/50 text-foreground">
                    <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {imovel.area} m²
                  </span>
                ) : null}
                {imovel?.diaria ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    Diária base: {money(imovel.diaria)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/80 bg-muted/10 p-6 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Nenhum imóvel vinculado</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Selecione o imóvel de temporada para vincular a esta reserva e calcular as diárias.
              </p>
            </div>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => setImovelSelectOpen(true)}
              className="h-9 gap-1.5 text-xs hover:cursor-pointer"
            >
              <Search className="h-3.5 w-3.5" />
              Selecionar Imóvel
            </Button>
          </div>
        )}
      </div>

      {/* 2. CARD: HÓSPEDE PRINCIPAL */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                Hóspede Principal (Cliente)
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Pessoa responsável pela hospedagem e titular da reserva.
            </p>
          </div>

          {cliente || value.cliente_id ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setCustomerSelectOpen(true)}
                className="h-8 text-xs gap-1.5 hover:cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Trocar Hóspede
              </Button>
              {!disabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ ...value, cliente_id: null, cliente: null })}
                  className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 hover:cursor-pointer"
                  title="Desvincular hóspede"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {cliente || value.cliente_id ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-lg border border-border/70 bg-muted/20 p-3.5 sm:p-4">
            <Avatar className="h-12 w-12 sm:h-14 sm:w-14 border border-border/60 shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                {cliente?.nomerazaosocial
                  ? cliente.nomerazaosocial.slice(0, 2).toUpperCase()
                  : <User className="h-5 w-5" />}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-sm sm:text-base text-foreground leading-snug">
                  <LinkedName
                    label={cliente?.nomerazaosocial || `Cliente #${value.cliente_id}`}
                    title="Abrir cadastro do cliente"
                    onOpen={value.cliente_id && onOpenCliente ? () => onOpenCliente(Number(value.cliente_id)) : undefined}
                  />
                </h4>
                {cliente?.cpfcnpj ? (
                  <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
                    {formatDocument(cliente.cpfcnpj)}
                  </Badge>
                ) : null}
                {cliente?.tipopessoa ? (
                  <Badge variant="secondary" className="text-[11px] font-normal">
                    {cliente.tipopessoa === "FISICA" ? "Pessoa Física" : "Pessoa Jurídica"}
                  </Badge>
                ) : null}
                {cliente?.status ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[11px]",
                      cliente.status === "ATIVO"
                        ? "border-emerald-500/30 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400"
                        : "border-slate-500/30 text-slate-700 bg-slate-500/10 dark:text-slate-300"
                    )}
                  >
                    {titleCase(cliente.status)}
                  </Badge>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {cliente?.telefone ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground/80" />
                    {formatPhone(cliente.telefone)}
                  </span>
                ) : null}
                {cliente?.email ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground/80" />
                    {cliente.email}
                  </span>
                ) : null}
                {(cliente?.cidade || cliente?.estado) ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground/80" />
                    {[cliente.cidade, cliente.estado].filter(Boolean).join(" - ")}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/80 bg-muted/10 p-6 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <User className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Nenhum hóspede vinculado</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Selecione o cliente responsável pelo contrato e faturamento desta reserva.
              </p>
            </div>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => setCustomerSelectOpen(true)}
              className="h-9 gap-1.5 text-xs hover:cursor-pointer"
            >
              <Search className="h-3.5 w-3.5" />
              Selecionar Hóspede
            </Button>
          </div>
        )}
      </div>

      {/* 3. CARD: PERÍODO E OCUPAÇÃO */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs space-y-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Período da Estadia & Ocupação
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Defina as datas de check-in, check-out e total de hóspedes da reserva.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Mesmo calendário da aba Disponibilidade do imóvel: 1º clique na entrada, 2º na saída. */}
          <div className="space-y-2">
            <OccupancyCalendar
              month={mes}
              onMonth={setMes}
              rows={ocupadas}
              tariffs={tarifasDoImovel}
              selection={{ start: inicio, end: fim }}
              onDayClick={disabled || codigoAirbnb ? undefined : escolherDia}
              isDayDisabled={diaIndisponivel}
              allowPast
              checkinTime={imovel?.horario_checkin}
              checkoutTime={imovel?.horario_checkout}
            />
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              {!imovelId ? (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  Escolha o imóvel para ver os dias ocupados.
                </span>
              ) : ocupacao.error && !ocupacao.data ? (
                <span className="flex items-center gap-1.5 text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Não foi possível carregar a disponibilidade.
                  <button type="button" onClick={ocupacao.reload} className="font-semibold underline underline-offset-2 hover:cursor-pointer">
                    Tentar de novo
                  </button>
                </span>
              ) : !disponibilidadeCarregada ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  Carregando a disponibilidade do imóvel…
                </span>
              ) : disabled ? (
                <span />
              ) : codigoAirbnb ? (
                <span>Entrada e saída definidas pelo Airbnb.</span>
              ) : !inicio ? (
                <span>Clique no dia da entrada e depois no dia da saída.</span>
              ) : !fim ? (
                <span>Agora clique no dia da saída.</span>
              ) : (
                <span />
              )}
              {inicio && !disabled && !codigoAirbnb ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-3 text-xs text-muted-foreground hover:cursor-pointer"
                  onClick={() => onChange({ ...value, inicio: "", fim: "" })}
                >
                  Limpar datas
                </Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <DateChip label="Check-in *" date={inicio} placeholder="Escolha no calendário" />
                <HorarioSelect
                  id="res-horario-checkin"
                  label="Horário de entrada"
                  value={checkin}
                  disabled={disabled}
                  onChange={(hora) => set("horario_checkin", hora)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {defaultHint(value.horario_checkin, imovel?.horario_checkin, "14:00")}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <DateChip label="Check-out *" date={fim} placeholder="Escolha no calendário" />
                <HorarioSelect
                  id="res-horario-checkout"
                  label="Horário de saída"
                  value={checkout}
                  disabled={disabled}
                  onChange={(hora) => set("horario_checkout", hora)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {defaultHint(value.horario_checkout, imovel?.horario_checkout, "12:00")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="res-hospedes" className="text-sm">
                Quantidade de Hóspedes *
              </Label>
              <IntegerInput
                id="res-hospedes"
                fallback={1}
                maxDigits={3}
                disabled={disabled}
                value={value.hospedes}
                onChange={(n) => set("hospedes", n)}
                className="h-10 sm:h-11"
              />
              {hospedesAConfirmar(value) ? (
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  A confirmar: o Airbnb não informa quantos são. Confira na reserva do Airbnb e salve.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {imovel?.capacidade
                    ? `Capacidade máx: ${imovel.capacidade} hóspedes`
                    : "Total de pessoas hospedadas"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Resumo da Estadia */}
        {nights != null ? (
          nights > 0 ? (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 font-semibold text-xs py-1 px-2.5 gap-1.5">
                  🌙 {nights} {nights === 1 ? "noite de estadia" : "noites de estadia"}
                </Badge>
                <span className="text-xs text-muted-foreground font-medium">
                  • {value.hospedes ?? 1} {Number(value.hospedes) === 1 ? "hóspede" : "hóspedes"}
                  {hospedesAConfirmar(value) ? " (a confirmar)" : ""}
                </span>
                {imovel?.diaria ? (
                  <span className="text-xs text-muted-foreground">
                    • Subtotal estimado: <strong className="text-foreground">{money(Number(imovel.diaria) * nights)}</strong>
                  </span>
                ) : null}
              </div>

              {imovel?.capacidade && Number(value.hospedes) > Number(imovel.capacidade) ? (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Atenção: excede a capacidade máxima do imóvel ({imovel.capacidade} pessoas)
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 flex items-center gap-2 text-xs text-destructive font-medium">
              <AlertCircle className="h-4 w-4 shrink-0" />
              A data de check-out deve ser posterior à data de check-in.
            </div>
          )
        ) : null}
      </div>

      {/* 4. CARD: OBSERVAÇÕES */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs space-y-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Observações e Instruções da Hospedagem
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Instruções de check-in, solicitações especiais, avisos para a equipe ou portaria.
          </p>
        </div>

        <Textarea
          id="res-observacoes"
          disabled={disabled}
          rows={3}
          value={value.observacoes ?? ""}
          onChange={(e) => set("observacoes", e.target.value)}
          placeholder="Ex: Check-in previsto para às 19:30. Hóspede solicitou berço adicional. Acompanhantes: João e Maria. Liberar acesso na portaria."
        />
      </div>

      {/* Modais de Seleção */}
      <ImovelSelect
        open={imovelSelectOpen}
        setOpen={setImovelSelectOpen}
        OnSelect={(selectedImovel) => {
          onChange({
            ...value,
            imovel_id: selectedImovel.id,
            imovel: selectedImovel,
          });
        }}
      />

      <CustomerSelect
        open={customerSelectOpen}
        setOpen={setCustomerSelectOpen}
        OnSelect={(selectedCustomer) => {
          onChange({
            ...value,
            cliente_id: selectedCustomer.id,
            cliente: selectedCustomer,
          });
        }}
      />
    </div>
  );
}

function Phones({
  value,
  onChange,
  disabled,
}: {
  value: Entity[];
  onChange: (phones: Entity[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Contatos Adicionais</p>
          <p className="text-xs text-muted-foreground">Números secundários de telefone ou WhatsApp.</p>
        </div>
        {!disabled ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5 hover:cursor-pointer"
            onClick={() => onChange([...value, { telefone: "", contato: "", observacao: "" }])}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar telefone
          </Button>
        ) : null}
      </div>

      {value.map((phone, index) => (
        <div
          key={index}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-lg border border-border/50 bg-muted/20 p-3"
        >
          <div className="space-y-2">
            <Label className="text-sm">Telefone</Label>
            <Input
              disabled={disabled}
              type="tel"
              inputMode="tel"
              maxLength={15}
              placeholder="(00) 00000-0000"
              value={mascaraTelefone(phone.telefone)}
              onChange={(event) =>
                onChange(
                  value.map((item, position) =>
                    position === index ? { ...item, telefone: telefoneDigitos(event.target.value) } : item
                  )
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Contato</Label>
            <Input
              disabled={disabled}
              placeholder="Ex: Secretária, Sócio"
              value={phone.contato ?? ""}
              onChange={(event) =>
                onChange(
                  value.map((item, position) =>
                    position === index ? { ...item, contato: event.target.value } : item
                  )
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Observação</Label>
            <Input
              disabled={disabled}
              placeholder="Ex: Somente WhatsApp"
              value={phone.observacao ?? ""}
              onChange={(event) =>
                onChange(
                  value.map((item, position) =>
                    position === index ? { ...item, observacao: event.target.value } : item
                  )
                )
              }
            />
          </div>
          {!disabled ? (
            <Button
              className="h-9 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive hover:cursor-pointer"
              type="button"
              variant="ghost"
              onClick={() => onChange(value.filter((_, position) => position !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ))}

      {!value.length ? (
        <p className="text-xs text-muted-foreground italic">Nenhum contato adicional cadastrado.</p>
      ) : null}
    </div>
  );
}

export type Quote = {
  available: boolean;
  total: number;
  subtotal: number;
  fees?: any;
  taxes?: any;
  nightlyBreakdown?: Entity[];
  currency?: string;
  /** Regras de tarifa que o período quebra (pacote fechado, mínimo/máximo de noites). No ERP, pede confirmação ao salvar. */
  violacoes?: { codigo: string; mensagem: string }[];
};

const centavos = (n: number) => Math.round(n * 100) / 100;

/** "3× R$ 300,00 · 2× R$ 450,00": as diárias da cotação agrupadas por valor. */
function nightlySummary(nights: Entity[]) {
  const groups = new Map<number, number>();
  for (const night of nights) groups.set(Number(night.amount), (groups.get(Number(night.amount)) ?? 0) + 1);
  return [...groups.entries()].map(([amount, count]) => `${count}× ${money(amount)}`).join(" · ");
}

export function ReservationQuote({
  value,
  onQuote,
  onAdjust,
}: {
  value: Entity;
  onQuote: (quote: Quote | null) => void;
  /** Diárias e limpeza da reserva: nascem da cotação e o operador pode alterar. */
  onAdjust: (patch: { valor_diarias?: number | null; taxa_limpeza?: number | null }) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const isFormValid =
    Boolean(value.imovel_id) &&
    Boolean(value.inicio) &&
    Boolean(value.fim) &&
    value.fim > value.inicio;

  /*
   * Calcula sozinho. O componente é remontado (key) a cada troca de imóvel, datas ou
   * hóspedes, então cada combinação faz a sua consulta; a espera curta evita uma
   * consulta por tecla ao digitar os hóspedes, e a resposta de uma combinação já
   * trocada é descartada.
   */
  useEffect(() => {
    if (!isFormValid) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          inicio: value.inicio,
          fim: value.fim,
          hospedes: String(value.hospedes ?? 1),
        });
        // Regras de tarifa voltam como aviso: no ERP dá para passar por cima, com confirmação ao salvar.
        params.set("regras", "avisar");
        // Reserva do Airbnb: o evento dela no calendário não conta como ocupado.
        if (value.codigo_externo) params.set("codigo_externo", String(value.codigo_externo));
        const result = await requestJson(`/api/imoveis/${value.imovel_id}/cotacao?${params}`);
        if (!active) return;
        setQuote(result);
        if (result.available) {
          onQuote(result);
          // Valores padrão do imóvel e das tarifas; daqui em diante, editáveis. Na reserva do Airbnb
          // ficam os da reserva (zerados até alguém informar): a tarifa do ERP não é o preço do Airbnb.
          if (value.codigo_externo)
            onAdjust({ valor_diarias: Number(value.valor_diarias ?? 0), taxa_limpeza: Number(value.taxa_limpeza ?? 0) });
          else onAdjust({ valor_diarias: Number(result.subtotal), taxa_limpeza: Number(result.fees ?? 0) });
        } else setError("O imóvel não está disponível no período solicitado.");
      } catch (error) {
        if (!active) return;
        setError((error as Error).message);
        setQuote(null);
      } finally {
        if (active) setLoading(false);
      }
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // A combinação já está na key do componente; `attempt` é o "tentar de novo".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Calculator className="h-4 w-4 text-primary" />
            Cotação da Hospedagem & Disponibilidade
          </p>
          <p className="text-xs text-muted-foreground">
            {isFormValid
              ? "Calculada automaticamente com o imóvel, as datas e os hóspedes informados."
              : "Escolha o imóvel, a entrada e a saída para calcular as diárias."}
          </p>
        </div>
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Calculando…
          </span>
        ) : error && isFormValid ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setAttempt((n) => n + 1)}
            className="h-9 text-xs gap-1.5 hover:cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Tentar de novo
          </Button>
        ) : null}
      </div>

      {error ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive font-medium"
          role="alert"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {quote && quote.available ? (
        <QuoteValues quote={quote} value={value} onAdjust={onAdjust} loading={loading} />
      ) : null}
    </div>
  );
}

/** Diária, total das diárias e limpeza: vêm da cotação e podem ser alterados nesta reserva. */
function QuoteValues({
  quote,
  value,
  onAdjust,
  loading,
}: {
  quote: Quote;
  value: Entity;
  onAdjust: (patch: { valor_diarias?: number | null; taxa_limpeza?: number | null }) => void;
  loading: boolean;
}) {
  const nights = quote.nightlyBreakdown ?? [];
  const noites = nights.length || 1;
  const diarias = Number(value.valor_diarias ?? quote.subtotal ?? 0);
  const limpeza = Number(value.taxa_limpeza ?? quote.fees ?? 0);
  const total = centavos(diarias + limpeza);
  const cotado = { diarias: Number(quote.subtotal ?? 0), limpeza: Number(quote.fees ?? 0) };
  const alterado = centavos(diarias) !== centavos(cotado.diarias) || centavos(limpeza) !== centavos(cotado.limpeza);
  const violacoes = quote.violacoes ?? [];

  return (
    <div className={cn("space-y-3 pt-1 border-t border-border/40 transition-opacity", loading && "opacity-50")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className="border-emerald-500/30 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400 text-xs gap-1.5 py-1 px-2.5"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Disponível no período
        </Badge>
        <span className="text-xs text-muted-foreground">
          {noites} {noites === 1 ? "noite" : "noites"} · tarifa: {nightlySummary(nights)}
        </span>
      </div>

      {violacoes.length ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1.5" role="status">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Regras de tarifa não atendidas
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {violacoes.map((violacao) => (
              <li key={violacao.codigo + violacao.mensagem}>{violacao.mensagem}</li>
            ))}
          </ul>
          <p className="text-amber-700/90 dark:text-amber-300/80">Você pode prosseguir: ao salvar, será pedida confirmação.</p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="res-diaria" className="text-xs text-muted-foreground">Diária (por noite)</Label>
          <ValueInput
            id="res-diaria"
            value={centavos(diarias / noites)}
            onValueChange={(diaria) => onAdjust({ valor_diarias: centavos(diaria * noites) })}
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="res-diarias" className="text-xs text-muted-foreground">Total das diárias</Label>
          <ValueInput
            id="res-diarias"
            value={diarias}
            onValueChange={(valor) => onAdjust({ valor_diarias: valor })}
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="res-limpeza" className="text-xs text-muted-foreground">Taxa de limpeza</Label>
          <ValueInput
            id="res-limpeza"
            value={limpeza}
            onValueChange={(valor) => onAdjust({ taxa_limpeza: valor })}
            className="h-10"
          />
        </div>
        <div className="rounded-lg bg-primary/10 px-3 py-2 border border-primary/20 flex flex-col justify-center">
          <p className="text-xs text-primary font-semibold">Valor total da reserva</p>
          <p className="text-lg font-extrabold text-foreground tabular-nums">{money(total)}</p>
        </div>
      </div>

      {alterado ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Valores alterados nesta reserva. Pela tarifa: diárias {money(cotado.diarias)} + limpeza {money(cotado.limpeza)} ={" "}
            {money(cotado.diarias + cotado.limpeza)}.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onAdjust({ valor_diarias: cotado.diarias, taxa_limpeza: cotado.limpeza })}
          >
            Restaurar valores da tarifa
          </Button>
        </div>
      ) : null}
    </div>
  );
}
