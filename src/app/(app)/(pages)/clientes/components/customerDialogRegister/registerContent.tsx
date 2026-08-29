"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { IndicadorIeSelect } from "@/components/fiscal/indicador-ie-select";
import {
  User,
  Building2,
  Mail,
  Phone,
  FileText,
  Camera,
  ChevronsUpDown,
  Check,
  Search,
  Loader2,
  MapPin,
  IdCard,
} from "lucide-react";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  NewCustomer,
  StatusCliente,
  TelefoneSecundario,
  TipoPessoa,
  ESTADOS_BRASIL,
} from "./types";
import { formatCep, formatCpfCnpj, formatTelefone } from "./utils";
import SecondaryPhonesCard from "./secondaryPhonesCard";
import { useGetCidades } from "@/app/(app)/hooks/useGetCidades";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import axios, { isAxiosError } from "axios";
import { toast } from "@/lib/toast";
import { Customer } from "../../types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

interface RegisterContentProps {
  newCustomer: NewCustomer;
  setNewCustomer: (value: NewCustomer) => void;
  setSelectedCustomerId?: (value: number | undefined) => void;
  onRegister?: (c: Customer) => void;
  isDesktop?: boolean;
}

type CnpjInscricaoEstadual = {
  ativo?: boolean | null;
  inscricao_estadual?: string | number | null;
  estado?: { sigla?: string | null } | null;
};

const statusOptionClass: Record<StatusCliente, string> = {
  ATIVO:
    "bg-emerald-100 text-emerald-800 focus:bg-emerald-100 focus:text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 dark:focus:bg-emerald-950/50 dark:focus:text-emerald-300",
  INATIVO:
    "bg-slate-100 text-slate-800 focus:bg-slate-100 focus:text-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:focus:bg-slate-900 dark:focus:text-slate-300",
  PENDENTE:
    "bg-amber-100 text-amber-800 focus:bg-amber-100 focus:text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 dark:focus:bg-amber-950/50 dark:focus:text-amber-300",
};

const statusLabel: Record<StatusCliente, string> = {
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  PENDENTE: "Pendente",
};

export default function RegisterContent({
  newCustomer,
  setNewCustomer,
  setSelectedCustomerId,
  onRegister,
  isDesktop = true,
}: RegisterContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    cidades,
    loading,
    error: erroCidades,
    origem: origemCidades,
    recarregar: recarregarCidades,
  } = useGetCidades(newCustomer?.estado);
  const [open, setOpen] = useState(false);
  const [isLoadingCep, setIsLoadingCep] = useState(false);
  const [isLoadingCNPJ, setIsLoadingCNPJ] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // Vão para tabela própria depois que o cliente existe, como a foto.
  const [telefonesSecundarios, setTelefonesSecundarios] = useState<TelefoneSecundario[]>([]);

  // `ind_ie_dest` é numérico; os demais campos do cadastro são texto.
  const handleInputChange = (
    field: keyof NewCustomer,
    value: string | number | null,
  ) => {
    setNewCustomer({
      ...newCustomer,
      [field]:
        field === "nomerazaosocial" && typeof value === "string"
          ? value.toLocaleUpperCase("pt-BR")
          : value,
    });
  };

  const handleGetCep = async () => {
    if (!newCustomer.cep) {
      toast.error("Informe um CEP para buscar");
      return;
    }
    setIsLoadingCep(true);
    try {
      const response = await axios.get(
        `https://opencep.com/v1/${newCustomer.cep}`
      );
      if (response.status === 200) {
        console.log(response);
        const enderecoResponse = response.data;
        setNewCustomer({
          ...newCustomer,
          endereco: enderecoResponse.logradouro,
          cidade: enderecoResponse.localidade,
          codigomunicipio: String(enderecoResponse.ibge),
          estado: enderecoResponse.uf,
          bairro: enderecoResponse.bairro,
        });
      }
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.status === 404) {
          toast.error("CEP não encontrado.");
        }
      }
    } finally {
      setIsLoadingCep(false);
    }
  };

  const handleGetCNPJ = async () => {
    if (newCustomer.cpfcnpj.length < 14) {
      toast.warning("CPF inválido para consulta de CNPJ");

      return;
    }
    setIsLoadingCNPJ(true);
    try {
      const response = await axios.get(
        `https://publica.cnpj.ws/cnpj/${newCustomer.cpfcnpj}`
      );
      if (response.status === 200) {
        console.log(response.data);
        const juridica = response.data;
        const estabelecimento = juridica.estabelecimento;
        const uf = String(estabelecimento?.estado?.sigla ?? "")
          .trim()
          .toUpperCase();
        const inscricoesEstaduais: CnpjInscricaoEstadual[] = Array.isArray(
          estabelecimento?.inscricoes_estaduais,
        )
          ? estabelecimento.inscricoes_estaduais
          : [];
        const inscricaoEstadual =
          inscricoesEstaduais.find(
            (inscricao) =>
              inscricao?.ativo !== false &&
              String(inscricao?.estado?.sigla ?? "").toUpperCase() === uf,
          ) ??
          inscricoesEstaduais.find((inscricao) => inscricao?.ativo !== false) ??
          inscricoesEstaduais.find(
            (inscricao) =>
              String(inscricao?.estado?.sigla ?? "").toUpperCase() === uf,
          ) ??
          inscricoesEstaduais[0];
        const ie = String(inscricaoEstadual?.inscricao_estadual ?? "")
          .replace(/\D/g, "")
          .trim();

        setNewCustomer({
          ...newCustomer,
          nomerazaosocial: String(juridica.razao_social ?? "").toLocaleUpperCase("pt-BR"),
          cep: estabelecimento.cep,
          email: estabelecimento.email,
          endereconumero: estabelecimento.numero,
          telefone: `${estabelecimento.ddd1}${estabelecimento.telefone1}`,
          estado: uf,
          cidade: estabelecimento.cidade.nome,
          codigomunicipio: String(estabelecimento.cidade.ibge_id),
          endereco: estabelecimento.logradouro,
          enderecocomplemento: estabelecimento.complemento,
          bairro: estabelecimento.bairro,
          inscricaoestadual: ie,
          ind_ie_dest: ie ? 1 : newCustomer.ind_ie_dest,
        });
      }
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.status === 429) {
          toast.error("Muitas tentativas", {
            description: "Aguarde um pouco e tente novamente",
          });
        }
        if (error.status === 400) {
          toast.error("CNPJ não encontrado", {
            description: "Verifique o dado informado",
          });
        }
        if (error.status === 404) {
          toast.error("Erro no servidor de consulta", {
            description: "Verifique com o administrador",
          });
        }
      }
    } finally {
      setIsLoadingCNPJ(false);
    }
  };

  function validarEmailDigitado(email: string): boolean {
    const valor = email.trim();
    if (!valor) return true;

    // Mesmo regex usado na constraint (case-insensitive)
    const regex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

    return regex.test(valor);
  }

  const handleCreateCustomer = async () => {
    if (!validarEmailDigitado(newCustomer?.email || "")) {
      toast.warning("Insira um email válido")
      return
    }

    if (
      newCustomer.tipopessoa === "JURIDICA" &&
      (!newCustomer.telefone.trim() ||
        !newCustomer.estado.trim() ||
        !newCustomer.cidade.trim())
    ) {
      toast.warning("Informe o telefone, o estado e a cidade do cliente.");
      return;
    }

    // Linha totalmente em branco é descartada: o + adiciona antes de digitar.
    const telefonesPreenchidos = telefonesSecundarios.filter(
      (item) =>
        item.telefone.trim() !== "" ||
        item.contato.trim() !== "" ||
        item.observacao.trim() !== "",
    );
    if (telefonesPreenchidos.some((item) => !/^\d{10,11}$/.test(item.telefone.replace(/\D/g, "")))) {
      toast.warning("Informe DDD e número em todos os telefones secundários.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await axios.post("/api/customers", {
        newCustomer,
      });

      if (response.status === 201) {
        let registeredCustomer = response.data.data as Customer;

        if (selectedPhoto) {
          const photoData = new FormData();
          photoData.append("file", selectedPhoto);
          try {
            const photoResponse = await axios.post(
              `/api/customers/${response.data.id}/foto`,
              photoData
            );
            registeredCustomer = {
              ...registeredCustomer,
              foto_url: photoResponse.data?.data?.foto_url ?? null,
            };
          } catch (photoError) {
            toast.warning("Cliente cadastrado, mas não foi possível salvar a foto.");
            console.error("Erro ao salvar foto do cliente:", photoError);
          }
        }
        if (telefonesPreenchidos.length) {
          try {
            await axios.put(`/api/customers/${response.data.id}/telefones`, {
              telefones: telefonesPreenchidos,
            });
          } catch (telefonesError) {
            toast.warning(
              "Cliente cadastrado, mas não foi possível salvar os telefones secundários.",
            );
            console.error("Erro ao salvar telefones do cliente:", telefonesError);
          }
        }
        toast.success("Sucesso!", {
          description: "Cliente cadastrado.",
          duration: 2000,
        });
        if (setSelectedCustomerId) {
          setSelectedCustomerId(response.data.id);
        }
        onRegister?.(registeredCustomer);
        setSelectedPhoto(null);
        setPhotoPreview(null);
        setTelefonesSecundarios([]);
        setNewCustomer({
          tipopessoa: "FISICA",
          cpfcnpj: "",
          nomerazaosocial: "",
          email: "",
          bairro: "",
          telefone: "",
          endereco: "",
          enderecocomplemento: "",
          endereconumero: "",
          cidade: "",
          estado: "",
          cep: "",
          inscricaoestadual: "",
          inscricaomunicipal: "",
          codigomunicipio: "",
          status: "ATIVO",
          foto: "",
        });
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data.error,
          duration: 2000,
        });

        console.log(error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    setNewCustomer({
      ...newCustomer,
      tipopessoa: newCustomer.tipopessoa,
      cpfcnpj: "",
      nomerazaosocial: "",
    });
  }, [newCustomer.tipopessoa]);

  useEffect(() => {
    if (newCustomer.tipopessoa === "JURIDICA" && newCustomer.cpfcnpj.length === 14) {
      handleGetCNPJ();
    }
  }, [newCustomer.cpfcnpj, newCustomer.tipopessoa]);

  useEffect(() => {
    console.log(newCustomer)
  }, [newCustomer])

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const DialogShellContent = isDesktop ? DialogContent : DrawerContent;
  const DialogShellHeader = isDesktop ? DialogHeader : DrawerHeader;
  const DialogShellFooter = isDesktop ? DialogFooter : DrawerFooter;
  const DialogShellTitle = isDesktop ? DialogTitle : DrawerTitle;
  const DialogShellDescription = isDesktop ? DialogDescription : DrawerDescription;
  const DialogShellClose = isDesktop ? DialogClose : DrawerClose;
 
  return (
    // <DialogContent className="h-dvh sm:max-w-[1100px] w-[95vw] p-2 overflow-hidden">
    <DialogShellContent className="h-svh w-screen max-w-none p-0 overflow-hidden sm:max-h-[850px] sm:w-[95vw] sm:max-w-[1100px] sm:min-w-0">
      <div className="flex h-full min-h-0 flex-col">
        <DialogShellHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <DialogShellTitle className="text-sm sm:text-lg">
            Cliente
            <span className="text-muted-foreground text-sm font-light"> | Novo </span>
          </DialogShellTitle>
          <DialogShellDescription>
            Preencha dados para registrar um novo cliente
          </DialogShellDescription>
        </DialogShellHeader>

        {/* CONTEÚDO DA ABA: o scroll fica no wrapper interno */}

        <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <Avatar className="h-12 w-12 sm:h-14 sm:w-14">
                <AvatarImage src={photoPreview ?? undefined} alt="Foto do cliente" />
                <AvatarFallback className="text-sm">
                  {newCustomer.tipopessoa === "FISICA" ? (
                    <User className="h-5 w-5 sm:h-6 sm:w-6" />
                  ) : (
                    <Building2 className="h-5 w-5 sm:h-6 sm:w-6" />
                  )}
                </AvatarFallback>
              </Avatar>
              <Label
                htmlFor="foto-upload"
                className="absolute -bottom-1 -right-1 cursor-pointer"
              >
                <div className="rounded-full bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-primary/90">
                  <Camera className="h-3 w-3" />
                </div>
                <input
                  id="foto-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (!file) return;
                    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                      toast.error("Use uma imagem JPG, PNG ou WebP.");
                      event.target.value = "";
                      return;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                      toast.error("A imagem deve ter no máximo 5 MB.");
                      event.target.value = "";
                      return;
                    }
                    if (photoPreview) URL.revokeObjectURL(photoPreview);
                    setSelectedPhoto(file);
                    setPhotoPreview(URL.createObjectURL(file));
                  }}
                />
              </Label>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    {newCustomer.nomerazaosocial?.trim() || "Novo cliente"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Defina o perfil e complete os dados cadastrais.
                  </p>
                </div>
              </div>

              <div className="grid flex-1 grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="status" className="text-sm">
                    Status
                  </Label>
                  <Select
                    value={newCustomer.status || ""}
                    onValueChange={(value: StatusCliente) =>
                      handleInputChange("status", value)
                    }
                  >
                    <SelectTrigger className={cn("h-10 sm:h-11", statusOptionClass[newCustomer.status])}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="ATIVO"
                        className={cn("px-2 py-1.5 text-sm font-medium", statusOptionClass.ATIVO)}
                      >
                        {statusLabel.ATIVO}
                      </SelectItem>
                      <SelectItem
                        value="INATIVO"
                        className={cn("px-2 py-1.5 text-sm font-medium", statusOptionClass.INATIVO)}
                      >
                        {statusLabel.INATIVO}
                      </SelectItem>
                      <SelectItem
                        value="PENDENTE"
                        className={cn("px-2 py-1.5 text-sm font-medium", statusOptionClass.PENDENTE)}
                      >
                        {statusLabel.PENDENTE}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tipopessoa" className="text-sm">
                    Tipo de Pessoa *
                  </Label>
                  <Select
                    value={newCustomer.tipopessoa}
                    onValueChange={(value: TipoPessoa) =>
                      handleInputChange("tipopessoa", value)
                    }
                  >
                    <SelectTrigger className="h-10 sm:h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FISICA">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          <span className="text-sm">Pessoa Física</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="JURIDICA">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          <span className="text-sm">Pessoa Jurídica</span>
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
                {newCustomer.tipopessoa === "FISICA" ? "CPF" : "CNPJ"} *
              </Label>
              <div className="relative">
                {isLoadingCNPJ && (
                  <Loader2 className="absolute right-9 top-2.5 h-4 w-4 animate-spin text-primary" />
                )}
                <div className="relative">
                  {newCustomer.tipopessoa === "JURIDICA" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={handleGetCNPJ}
                          className="absolute right-2 top-1.5 rounded-3xl p-1 transition-all hover:bg-gray-500/20"
                          aria-label="Consultar CNPJ"
                        >
                          <IdCard className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Consultar CNPJ</TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Input
                    inputMode="numeric"
                    id="cpfcnpj"
                    className=""
                    value={
                      formatCpfCnpj(
                        newCustomer.cpfcnpj,
                        newCustomer.tipopessoa
                      ) || ""
                    }
                    onChange={(e) => {
                      const onlyNumbers = e.target.value.replace(/\D/g, "");

                      handleInputChange("cpfcnpj", onlyNumbers);
                    }}
                    placeholder={
                      newCustomer.tipopessoa === "FISICA"
                        ? "000.000.000-00"
                        : "00.000.000/0000-00"
                    }
                    maxLength={newCustomer.tipopessoa === "FISICA" ? 14 : 18}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nomerazaosocial" className="text-sm">
                {newCustomer.tipopessoa === "FISICA"
                  ? "Nome Completo"
                  : "Razão Social"}{" "}
                *
              </Label>
              <Input
                id="nomerazaosocial"
                className=""
                value={newCustomer.nomerazaosocial || ""}
                onChange={(e) =>
                  handleInputChange("nomerazaosocial", e.target.value)
                }
                placeholder={
                  newCustomer.tipopessoa === "FISICA"
                    ? "João da Silva"
                    : "Empresa LTDA"
                }
              />
            </div>
          </div>

          {/* Contato */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="flex items-center gap-2 text-sm"
              >
                <Mail className="h-3 w-3 sm:h-4 sm:w-4" />
                Email
              </Label>
              <Input
                inputMode="email"
                id="email"
                type="email"
                className=""
                value={newCustomer.email || ""}
                onChange={(e) => handleInputChange("email", e.target.value)}
                placeholder="cliente@email.com"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="telefone"
                className="flex items-center gap-2 text-sm"
              >
                <Phone className="h-3 w-3 sm:h-4 sm:w-4" />
                Telefone (principal) {newCustomer.tipopessoa === "JURIDICA" && "*"}
              </Label>
              <Input
                inputMode="tel"
                id="telefone"
                className=""
                value={formatTelefone(newCustomer.telefone) || ""}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                  handleInputChange("telefone", raw);
                }}
                placeholder="(11) 99999-9999"
                maxLength={15}
              />
            </div>
          </div>
          <Separator className="mt-4" />
          {/* Endereço */}
          <div className="space-y-3 sm:space-y-4">
            {/* <div className="flex items-center gap-2">
              <MapPin className="h-3 w-3 sm:h-4 sm:w-4" />
              <h3 className="text-base font-semibold sm:text-lg">Endereço</h3>
            </div> */}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-center gap-2">
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="cep" className="text-sm">
                  CEP
                </Label>
                <div className="relative">
                  {isLoadingCep ? (
                    <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <button
                      type="button"
                      onClick={handleGetCep}
                      className="absolute right-2 top-1.5 rounded-3xl p-1 transition-all hover:bg-gray-500/20"
                      aria-label="Consultar CEP"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  )}
                  <Input
                    id="cep"
                    className=""
                    value={formatCep(newCustomer.cep) || ""}
                    onChange={(e) => handleInputChange("cep", e.target.value)}
                    placeholder="00000-000"
                    maxLength={9}
                  />
                </div>
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="endereco" className="text-sm">
                  <MapPin className="h-4.5" />
                  Endereço Completo
                </Label>
                <Input
                  id="endereco"
                  className=""
                  value={newCustomer.endereco || ""}
                  onChange={(e) =>
                    handleInputChange("endereco", e.target.value)
                  }
                  placeholder="Rua, avenida..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="numero" className="text-sm">
                  Número
                </Label>
                <Input
                  id="endereconumero"
                  className=""
                  value={newCustomer.endereconumero || ""}
                  onChange={(e) =>
                    handleInputChange("endereconumero", e.target.value)
                  }
                  placeholder="123"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="estado" className="text-sm">
                  Estado {newCustomer.tipopessoa === "JURIDICA" && <span className="text-destructive">*</span>}
                </Label>

                <Popover open={open2} onOpenChange={setOpen2}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={open2}
                      className="w-full justify-between"
                    >
                      {newCustomer.estado
                        ? ESTADOS_BRASIL.find(
                          (estado) => estado === newCustomer.estado
                        )
                        : "Selecione..."}
                      <ChevronsUpDown className="opacity-50" />
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent
                    onWheel={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    onWheelCapture={(e) => e.stopPropagation()}
                  >
                    <Command>
                      <CommandInput
                        placeholder="Buscar estado..."
                        className="h-9 text-base"
                      />
                      <CommandList className="max-h-45 overflow-y-auto overscroll-contain">
                        <CommandEmpty>Nenhum estado encontrada.</CommandEmpty>

                        {/* Aqui NÃO precisa de overflow/max-h */}
                        <CommandGroup>
                          {ESTADOS_BRASIL.map((estado, i) => (
                            <CommandItem
                              className="hover:cursor-pointer"
                              key={i}
                              value={estado}
                              onSelect={(currentValue) => {
                                setNewCustomer({
                                  ...newCustomer,
                                  estado: currentValue,
                                  cidade:
                                    currentValue === newCustomer.estado
                                      ? newCustomer.cidade
                                      : "",
                                  codigomunicipio:
                                    currentValue === newCustomer.estado
                                      ? newCustomer.codigomunicipio
                                      : "",
                                });
                                setOpen2(false);
                              }}
                            >
                              {estado}
                              <Check
                                className={cn(
                                  "ml-auto",
                                  newCustomer.estado === estado
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="min-w-0 space-y-2">
                <Label htmlFor="cidade" className="text-sm">
                  Cidade {newCustomer.tipopessoa === "JURIDICA" && <span className="text-destructive">*</span>}
                </Label>

                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger
                    disabled={newCustomer.estado ? false : true}
                    asChild
                  >
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={open}
                      className="w-full justify-between"
                    >
                      {newCustomer.cidade
                        ? // Sem o fallback, a cidade ja escolhida some do botao
                          // enquanto a lista do IBGE nao carrega (ou falha).
                          cidades.find(
                            (cidade) => cidade.nome === newCustomer.cidade
                          )?.nome ?? newCustomer.cidade
                        : loading
                          ? "Carregando..."
                          : erroCidades
                            ? "Cidades indisponíveis"
                            : newCustomer.estado
                              ? "Selecione..."
                              : "Selecione o estado"}
                      <ChevronsUpDown className="opacity-50" />
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent
                    onWheel={(e) => e.stopPropagation()}
                    onTouchMove={(e) => e.stopPropagation()}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    onWheelCapture={(e) => e.stopPropagation()}
                  >
                    <Command>
                      <CommandInput
                        placeholder="Buscar cidade..."
                        className="h-9 text-base"
                      />
                      <CommandList className="max-h-45 overflow-y-auto overscroll-contain">
                        {erroCidades ? (
                          // O codigomunicipio vem junto da lista do IBGE e e
                          // obrigatorio na nota fiscal, entao nao oferecemos
                          // digitacao manual aqui: so tentar de novo.
                          <div className="space-y-2 p-3 text-center">
                            <p className="text-xs text-muted-foreground">
                              {erroCidades}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => recarregarCidades()}
                            >
                              Tentar novamente
                            </Button>
                          </div>
                        ) : loading ? (
                          <div className="p-3 text-center text-xs text-muted-foreground">
                            Buscando cidades...
                          </div>
                        ) : (
                          <>
                            {origemCidades === "local" && (
                              <p className="border-b px-3 py-2 text-[11px] text-muted-foreground">
                                IBGE indisponível — usando a lista interna.
                              </p>
                            )}
                            <CommandEmpty>Nenhuma cidade encontrada.</CommandEmpty>
                          </>
                        )}

                        {/* Aqui NÃO precisa de overflow/max-h */}
                        <CommandGroup>
                          {cidades.map((cidade) => (
                            <CommandItem
                              key={cidade.id}
                              value={cidade.nome} // string
                              onSelect={() => {
                                setNewCustomer({
                                  ...newCustomer,
                                  cidade: cidade.nome,
                                  codigomunicipio: String(cidade.id),
                                });
                                setOpen(false);
                              }}
                              className="hover:cursor-pointer"
                            >
                              {cidade.nome}
                              <Check
                                className={cn(
                                  "ml-auto",
                                  newCustomer.cidade === cidade.nome ? "opacity-100" : "opacity-0"
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>

                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cidade" className="text-sm">
                  Bairro
                </Label>
                <Input
                  id="bairro"
                  className=""
                  value={newCustomer.bairro || ""}
                  onChange={(e) => handleInputChange("bairro", e.target.value)}
                  placeholder="Bairro..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="complemento" className="text-sm">
                  Complemento
                </Label>
                <Input
                  id="enderecocomplemento"
                  className=""
                  value={newCustomer.enderecocomplemento || ""}
                  onChange={(e) =>
                    handleInputChange("enderecocomplemento", e.target.value)
                  }
                  placeholder="Ap, Bloco..."
                />
              </div>
            </div>
          </div>
          </div>

          <SecondaryPhonesCard
            telefones={telefonesSecundarios}
            setTelefones={setTelefonesSecundarios}
            disabled={isSubmitting}
          />

          {/* Dados fiscais - Apenas para Pessoa Jurídica */}
          {newCustomer.tipopessoa === "JURIDICA" && (
            <>
              <Separator />
                    <div className="space-y-3 sm:space-y-4 rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                  <h3 className="text-base sm:text-lg font-semibold">
                    Dados Fiscais
                  </h3>
                </div>

                <IndicadorIeSelect
                  value={newCustomer.ind_ie_dest}
                  onChange={(indicador) => handleInputChange("ind_ie_dest", indicador)}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="inscricaoestadual"
                      className="text-sm"
                    >
                      Inscrição Estadual
                      {newCustomer.ind_ie_dest === 1 ? (
                        <span className="text-red-500"> *</span>
                      ) : null}
                    </Label>
                    <Input
                      id="inscricaoestadual"
                      className=""
                      // Só contribuinte do ICMS manda IE na nota; nos demais o
                      // campo trava sem apagar o que já estava cadastrado.
                      disabled={
                        newCustomer.ind_ie_dest === 2 || newCustomer.ind_ie_dest === 9
                      }
                      value={newCustomer.inscricaoestadual || ""}
                      onChange={(e) =>
                        handleInputChange("inscricaoestadual", e.target.value)
                      }
                      placeholder="123456789"
                    />
                    {newCustomer.ind_ie_dest === 1 &&
                    !String(newCustomer.inscricaoestadual ?? "").trim() ? (
                      <p className="text-xs text-destructive">
                        Obrigatória para contribuinte do ICMS.
                      </p>
                    ) : newCustomer.ind_ie_dest === 9 ? (
                      <p className="text-xs text-muted-foreground">
                        Não será enviada na NF-e.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="inscricaomunicipal"
                      className="text-sm"
                    >
                      Inscrição Municipal
                    </Label>
                    <Input
                      id="inscricaomunicipal"
                      className=""
                      value={newCustomer.inscricaomunicipal || ""}
                      onChange={(e) =>
                        handleInputChange("inscricaomunicipal", e.target.value)
                      }
                      placeholder="123456789"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="codigomunicipio"
                    className="text-sm"
                  >
                    Código do Município
                  </Label>
                  <Input
                    id="codigomunicipio"
                    className=""
                    value={newCustomer.codigomunicipio || ""}
                    onChange={(e) =>
                      handleInputChange("codigomunicipio", e.target.value)
                    }
                    placeholder="3550308"
                  />
                </div>
              </div>
            </>
          )}

          {/* Botões */}
        </div>
        <DialogShellFooter className="border-t px-4 py-3 sm:px-6">
          <div className="flex w-full flex-row justify-end gap-2">
            <DialogShellClose asChild>
              <Button
                type="button"
                className="h-9 min-w-24 hover:cursor-pointer"
                variant="outline"
              >
                Cancelar
              </Button>
            </DialogShellClose>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={handleCreateCustomer}
              className="h-9 min-w-24 text-sm hover:cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </div>
        </DialogShellFooter>
      </div>
    </DialogShellContent>
  );
}

