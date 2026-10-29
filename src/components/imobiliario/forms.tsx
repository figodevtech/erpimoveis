"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Lookup, requestJson } from "./shared";
import { type Entity, type ModuleKind, dateInput, money, titleCase } from "./model";
import ProprietarioSelect from "@/app/(app)/components/proprietarioSelect";
import ValueInput from "@/components/ui/value-input";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

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
};

export function GeneralFields({ kind, value, onChange, editing, disabled }: Props) {
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
                  onValueChange={(val) => set("tipopessoa", val)}
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
              <Input
                id="cpfcnpj"
                disabled={disabled}
                value={value.cpfcnpj || ""}
                onChange={(e) => set("cpfcnpj", e.target.value)}
                placeholder={value.tipopessoa === "JURIDICA" ? "00.000.000/0000-00" : "000.000.000-00"}
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
                disabled={disabled}
                value={value.telefone || ""}
                onChange={(e) => set("telefone", e.target.value)}
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
                        <span>Documento: {value.proprietario.cpfcnpj}</span>
                      ) : null}
                      {value.proprietario?.telefone ? (
                        <span>Tel: {value.proprietario.telefone}</span>
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
            <Label className="text-sm">Modalidades de Negociação</Label>
            <div className="flex flex-wrap gap-4 pt-1">
              {[
                ["TEMPORADA", "Temporada"],
                ["LOCACAO", "Locação mensal"],
                ["VENDA", "Venda"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm hover:cursor-pointer touch-manipulation">
                  <Checkbox
                    disabled={disabled}
                    checked={(value.modalidades ?? []).includes(key)}
                    onCheckedChange={(checked) =>
                      set(
                        "modalidades",
                        checked === true
                          ? [...(value.modalidades ?? []), key]
                          : (value.modalidades ?? []).filter((item: string) => item !== key)
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
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

              <div className="space-y-2">
                <Label htmlFor="bairro" className="text-sm">
                  Bairro
                </Label>
                <Input
                  id="bairro"
                  disabled={disabled}
                  value={address.bairro || ""}
                  onChange={(e) => set("endereco", { ...address, bairro: e.target.value })}
                  placeholder="Bairro"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cidade" className="text-sm">
                  Cidade
                </Label>
                <Input
                  id="cidade"
                  disabled={disabled}
                  value={address.cidade || ""}
                  onChange={(e) => set("endereco", { ...address, cidade: e.target.value })}
                  placeholder="Cidade"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="estado" className="text-sm">
                  Estado (UF)
                </Label>
                <Input
                  id="estado"
                  disabled={disabled}
                  maxLength={2}
                  className="uppercase"
                  value={address.estado || ""}
                  onChange={(e) => set("endereco", { ...address, estado: e.target.value.toUpperCase() })}
                  placeholder="UF"
                />
              </div>
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
              <Input
                id="capacidade"
                type="number"
                min="1"
                disabled={disabled}
                value={value.capacidade ?? 1}
                onChange={(e) => set("capacidade", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="area" className="text-sm">
                Área (m²)
              </Label>
              <Input
                id="area"
                type="number"
                min="0"
                step="0.01"
                disabled={disabled}
                value={value.area ?? ""}
                onChange={(e) => set("area", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quartos" className="text-sm">
                Quartos
              </Label>
              <Input
                id="quartos"
                type="number"
                min="0"
                disabled={disabled}
                value={value.quartos ?? 0}
                onChange={(e) => set("quartos", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="banheiros" className="text-sm">
                Banheiros
              </Label>
              <Input
                id="banheiros"
                type="number"
                min="0"
                disabled={disabled}
                value={value.banheiros ?? 0}
                onChange={(e) => set("banheiros", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vagas" className="text-sm">
                Vagas
              </Label>
              <Input
                id="vagas"
                type="number"
                min="0"
                disabled={disabled}
                value={value.vagas ?? 0}
                onChange={(e) => set("vagas", Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comodidades" className="text-sm">
              Comodidades (uma por linha)
            </Label>
            <Textarea
              id="comodidades"
              disabled={disabled}
              rows={3}
              value={(value.comodidades ?? []).join("\n")}
              onChange={(e) => set("comodidades", e.target.value.split("\n"))}
              placeholder="Wi-Fi&#10;Ar-condicionado&#10;Piscina&#10;Churrasqueira"
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
            <p className="text-xs text-muted-foreground">Configuração de valores padrões para cotações e contratos.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="valor_locacao" className="text-sm">
                Aluguel Mensal
              </Label>
              <ValueInput
                id="valor_locacao"
                disabled={disabled}
                allowEmpty
                value={value.valor_locacao != null && value.valor_locacao !== "" ? Number(value.valor_locacao) : null}
                onValueChange={(val) => set("valor_locacao", val)}
                onEmpty={() => set("valor_locacao", null)}
                placeholder="R$ 0,00"
                className="h-10 sm:h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="valor_venda" className="text-sm">
                Valor de Venda
              </Label>
              <ValueInput
                id="valor_venda"
                disabled={disabled}
                allowEmpty
                value={value.valor_venda != null && value.valor_venda !== "" ? Number(value.valor_venda) : null}
                onValueChange={(val) => set("valor_venda", val)}
                onEmpty={() => set("valor_venda", null)}
                placeholder="R$ 0,00"
                className="h-10 sm:h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxa_limpeza" className="text-sm">
                Taxa de Limpeza
              </Label>
              <ValueInput
                id="taxa_limpeza"
                disabled={disabled}
                allowEmpty
                value={value.taxa_limpeza != null && value.taxa_limpeza !== "" ? Number(value.taxa_limpeza) : null}
                onValueChange={(val) => set("taxa_limpeza", val)}
                onEmpty={() => set("taxa_limpeza", null)}
                placeholder="R$ 0,00"
                className="h-10 sm:h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="caucao" className="text-sm">
                Caução de Garantia
              </Label>
              <ValueInput
                id="caucao"
                disabled={disabled}
                allowEmpty
                value={value.caucao != null && value.caucao !== "" ? Number(value.caucao) : null}
                onValueChange={(val) => set("caucao", val)}
                onEmpty={() => set("caucao", null)}
                placeholder="R$ 0,00"
                className="h-10 sm:h-11"
              />
            </div>
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

  // Operações (Reservas, Locações, Vendas)
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
        <div className="space-y-1">
          <p className="text-sm font-semibold">Dados da Operação</p>
          <p className="text-xs text-muted-foreground">Defina os vínculos de imóvel e cliente.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Imóvel Vinculado *</Label>
            <Lookup
              tipo="imoveis"
              label=""
              value={value.imovel_id}
              initial={value.imovel}
              disabled={Boolean(disabled || (editing && kind !== "reservas"))}
              onChange={(id, item) => onChange({ ...value, imovel_id: id, imovel: item })}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">
              {kind === "vendas-imobiliarias" ? "Comprador *" : "Cliente / Locatário *"}
            </Label>
            <Lookup
              tipo="clientes"
              label=""
              value={kind === "vendas-imobiliarias" ? value.comprador_id : value.cliente_id}
              initial={value.cliente ?? value.comprador}
              disabled={Boolean(disabled || editing)}
              onChange={(id) => set(kind === "vendas-imobiliarias" ? "comprador_id" : "cliente_id", id)}
            />
          </div>

          {kind === "vendas-imobiliarias" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="data_venda" className="text-sm">Data da Venda *</Label>
                <Input
                  id="data_venda"
                  type="date"
                  disabled={disabled}
                  value={dateInput(value.data_venda)}
                  onChange={(e) => set("data_venda", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="valor_total" className="text-sm">Valor Negociado *</Label>
                <ValueInput
                  id="valor_total"
                  disabled={disabled}
                  allowEmpty
                  value={value.valor_total != null && value.valor_total !== "" ? Number(value.valor_total) : null}
                  onValueChange={(val) => set("valor_total", val)}
                  onEmpty={() => set("valor_total", null)}
                  placeholder="R$ 0,00"
                  className="h-10 sm:h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="comissao_percentual" className="text-sm">Comissão (%)</Label>
                <Input
                  id="comissao_percentual"
                  type="number"
                  step="0.01"
                  disabled={disabled}
                  value={value.comissao_percentual ?? ""}
                  onChange={(e) => set("comissao_percentual", e.target.value === "" ? null : Number(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Novo Proprietário</Label>
                <Lookup
                  tipo="proprietarios"
                  label=""
                  required={false}
                  value={value.novo_proprietario_id}
                  disabled={disabled}
                  onChange={(id) => set("novo_proprietario_id", id)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="inicio" className="text-sm">
                  {kind === "reservas" ? "Data de Check-in *" : "Início do Contrato *"}
                </Label>
                <Input
                  id="inicio"
                  type="date"
                  disabled={disabled}
                  value={dateInput(value.inicio)}
                  onChange={(e) => set("inicio", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fim" className="text-sm">
                  {kind === "reservas" ? "Data de Check-out *" : "Término do Contrato"}
                </Label>
                <Input
                  id="fim"
                  type="date"
                  disabled={disabled}
                  value={dateInput(value.fim)}
                  onChange={(e) => set("fim", e.target.value)}
                />
              </div>

              {kind === "reservas" ? (
                <div className="space-y-2">
                  <Label htmlFor="hospedes" className="text-sm">Quantidade de Hóspedes *</Label>
                  <Input
                    id="hospedes"
                    type="number"
                    min="1"
                    disabled={disabled}
                    value={value.hospedes ?? 1}
                    onChange={(e) => set("hospedes", Number(e.target.value))}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="valor_mensal" className="text-sm">Aluguel Mensal *</Label>
                    <ValueInput
                      id="valor_mensal"
                      disabled={disabled}
                      allowEmpty
                      value={value.valor_mensal != null && value.valor_mensal !== "" ? Number(value.valor_mensal) : null}
                      onValueChange={(val) => set("valor_mensal", val)}
                      onEmpty={() => set("valor_mensal", null)}
                      placeholder="R$ 0,00"
                      className="h-10 sm:h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dia_vencimento" className="text-sm">Dia do Vencimento *</Label>
                    <Input
                      id="dia_vencimento"
                      type="number"
                      min="1"
                      max="28"
                      disabled={disabled}
                      value={value.dia_vencimento ?? 5}
                      onChange={(e) => set("dia_vencimento", Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="indice_reajuste" className="text-sm">Índice de Reajuste</Label>
                    <Input
                      id="indice_reajuste"
                      disabled={disabled}
                      value={value.indice_reajuste ?? ""}
                      onChange={(e) => set("indice_reajuste", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="percentual_admin" className="text-sm">Administração (%)</Label>
                    <Input
                      id="percentual_admin"
                      type="number"
                      step="0.01"
                      disabled={disabled}
                      value={value.percentual_admin ?? ""}
                      onChange={(e) => set("percentual_admin", e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="caucao" className="text-sm">Caução</Label>
                    <ValueInput
                      id="caucao"
                      disabled={disabled}
                      allowEmpty
                      value={value.caucao != null && value.caucao !== "" ? Number(value.caucao) : null}
                      onValueChange={(val) => set("caucao", val)}
                      onEmpty={() => set("caucao", null)}
                      placeholder="R$ 0,00"
                      className="h-10 sm:h-11"
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="observacoes" className="text-sm">Observações</Label>
          <Textarea
            id="observacoes"
            disabled={disabled}
            rows={3}
            value={value.observacoes ?? ""}
            onChange={(e) => set("observacoes", e.target.value)}
            placeholder="Informações adicionais da operação..."
          />
        </div>
      </div>
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
              placeholder="(00) 00000-0000"
              value={phone.telefone ?? ""}
              onChange={(event) =>
                onChange(
                  value.map((item, position) =>
                    position === index ? { ...item, telefone: event.target.value } : item
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
};

export function ReservationQuote({
  value,
  onQuote,
}: {
  value: Entity;
  onQuote: (quote: Quote | null) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const calculate = async () => {
    setLoading(true);
    setError("");
    onQuote(null);
    try {
      const params = new URLSearchParams({
        inicio: value.inicio,
        fim: value.fim,
        hospedes: String(value.hospedes ?? 1),
      });
      const result = await requestJson(`/api/imoveis/${value.imovel_id}/cotacao?${params}`);
      setQuote(result);
      if (result.available) {
        onQuote(result);
      } else {
        setError("O imóvel não está disponível no período solicitado.");
      }
    } catch (error) {
      setError((error as Error).message);
      setQuote(null);
    } finally {
      setLoading(false);
    }
  };

  const isFormValid =
    Boolean(value.imovel_id) &&
    Boolean(value.inicio) &&
    Boolean(value.fim) &&
    value.fim > value.inicio;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Cotação da hospedagem
          </p>
          <p className="text-xs text-muted-foreground">
            Consulte a disponibilidade em tempo real antes de salvar.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={loading || !isFormValid}
          onClick={calculate}
          className="h-9 text-xs gap-1.5 hover:cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Calculando…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Calcular diárias
            </>
          )}
        </Button>
      </div>

      {error ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {quote ? (
        <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-border/40">
          <div className="rounded-lg bg-muted/40 p-3 border border-border/50">
            <p className="text-xs text-muted-foreground">Total das Diárias</p>
            <p className="text-base font-bold text-foreground mt-0.5">{money(quote.subtotal)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 border border-border/50">
            <p className="text-xs text-muted-foreground">Taxas e Serviços</p>
            <p className="text-base font-bold text-foreground mt-0.5">
              {money(Number(quote.total) - Number(quote.subtotal))}
            </p>
          </div>
          <div className="rounded-lg bg-primary/10 p-3 border border-primary/20">
            <p className="text-xs text-primary font-medium">Valor Total da Reserva</p>
            <p className="text-lg font-extrabold text-foreground mt-0.5">{money(quote.total)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
