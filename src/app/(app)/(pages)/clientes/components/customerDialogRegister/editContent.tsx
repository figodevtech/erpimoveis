"use client";

import type React from "react";
import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Car,
  ClipboardList,
  User,
  Building2,
  Mail,
  Phone,
  FileText,
  Camera,
  ChevronsUpDown,
  Check,
  MapPin,
  Search,
  Loader2,
  IdCard,
  Plus,
  ChevronDown,
  Ellipsis,
  Pen,
  ArrowLeftRight,
} from "lucide-react";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusCliente, TipoPessoa, ESTADOS_BRASIL } from "./types";
import { formatCep, formatCpfCnpj, formatTelefone, getRankEmoji } from "./utils";
import { Cliente_rank, Customer } from "../../types";
import axios, { isAxiosError } from "axios";
import { useGetCidades } from "@/app/(app)/hooks/useGetCidades";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VeiculoDialog } from "../../../veiculos/dialgo-veiculo/dialog-veiculo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface EditContentProps {
  customerId: number;
  isDesktop?: boolean;
  onUpdate?: (c: Customer) => void;
}

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

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
};

const formatDate = (date: string | Date | null | undefined) => {
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(date));
};

const getStatusBadge = (status?: string | null) => {
  if (!status) return <Badge variant="outline">Desconhecido</Badge>;
  const upper = status.toUpperCase();
  const formatted = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/_/g, " ");

  switch (upper) {
    case "ORCAMENTO":
      return <Badge variant="outline" className="border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-400">Orçamento</Badge>;
    case "ABERTA":
    case "EM_ANDAMENTO":
      return <Badge variant="outline" className="border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400">Aberta</Badge>;
    case "PENDENTE":
    case "APROVACAO_ORCAMENTO":
      return <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400">Pendente</Badge>;
    case "CONCLUIDO":
    case "FINALIZADA":
      return <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Finalizada</Badge>;
    case "CANCELADA":
      return <Badge variant="outline" className="border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400">Cancelada</Badge>;
    case "PAGAMENTO":
      return <Badge variant="outline" className="border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">Pagamento</Badge>;
    default:
      return <Badge variant="outline">{formatted}</Badge>;
  }
};

export default function EditContent({ customerId, isDesktop = true, onUpdate }: EditContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingCNPJ, setIsLoadingCNPJ] = useState(false);
  const [selectedCustomer, setselectedCustomer] = useState<Customer | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCep, setIsLoadingCep] = useState(false);
  const { cidades, loading } = useGetCidades(selectedCustomer?.estado ?? undefined);
  const [open, setOpen] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [openVehicle, setOpenVehicle] = useState(false);
  const [veiculoId, setSelectedVeiculoId] = useState<number | undefined>(undefined);
  const [isLoadingVeiculos, setIsLoadingVeiculos] = useState(false);
  const [openCustomerSelect, setOpenCustomerSelect] = useState(false);
  const [veiculoTransferId, setVeiculoTransferId] = useState<number | undefined>(undefined);
  const [transferindo, setTransferindo] = useState(false);
  const [expandedOrdemId, setExpandedOrdemId] = useState<number | null>(null);

  function validarEmailDigitado(email: string): boolean {
    const valor = email.trim();
    if (!valor) return true;

    // Mesmo regex usado na constraint (case-insensitive)
    const regex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

    return regex.test(valor);
  }

  const handleInputChange = (field: keyof Customer, value: string) => {
    if (selectedCustomer) {
      setselectedCustomer({ ...selectedCustomer, [field]: value });
    }
  };

  const handleGetCustomer = async (customerId: number, notifyUpdate = false) => {
    setIsLoading(true);
    try {
      const response = await axios.get("/api/customers/" + customerId);

      if (response.status === 200) {
        // console.log(response)
        const { data } = response;
        setselectedCustomer(data.data);
        if (notifyUpdate) onUpdate?.(data.data);
      }
    } catch (error) {
      console.log("Erro ao buscar cliente:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetCNPJ = async () => {
    if (selectedCustomer?.cpfcnpj && selectedCustomer?.cpfcnpj?.length < 14) {
      toast.warning("CPF inválido para consulta de CNPJ");
      return;
    }
    setIsLoadingCNPJ(true);
    try {
      const response = await axios.get(`https://publica.cnpj.ws/cnpj/${selectedCustomer?.cpfcnpj}`);
      if (response.status === 200) {
        console.log(response.data);
        const juridica = response.data;
        setselectedCustomer((prev) => {
          if (!prev) return undefined;
          return {
            ...prev,
            nomerazaosocial: juridica.razao_social,
            cep: juridica.estabelecimento.cep,
            email: juridica.estabelecimento.email,
            endereconumero: juridica.estabelecimento.numero,
            telefone: `${juridica.estabelecimento.ddd1}${juridica.estabelecimento.telefone1}`,
            estado: juridica.estabelecimento.estado.sigla,
            cidade: juridica.estabelecimento.cidade.nome,
            codigomunicipio: String(juridica.estabelecimento.cidade.codigo_ibge),
            endereco: juridica.estabelecimento.logradouro,
            enderecocomplemento: juridica.estabelecimento.complemento,
            bairro: juridica.estabelecimento.bairro,
          };
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

  const handleGetCep = async () => {
    if (!selectedCustomer?.cep) {
      toast.error("Informe um CEP para buscar");
      return;
    }
    setIsLoadingCep(true);
    try {
      const response = await axios.get(`https://opencep.com/v1/${selectedCustomer?.cep}`);
      if (response.status === 200) {
        console.log(response);
        const enderecoResponse = response.data;
        if (selectedCustomer) {
          setselectedCustomer({
            ...selectedCustomer,
            endereco: enderecoResponse.logradouro,
            cidade: enderecoResponse.localidade,
            codigomunicipio: enderecoResponse.ibge,
            estado: enderecoResponse.uf,
            bairro: enderecoResponse.bairro,
          });
        }
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

  const handleUpdateCustomer = async () => {
    if (!validarEmailDigitado(selectedCustomer?.email || "")) {
      toast.warning("Insira um email válido");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await axios.put("/api/customers/" + customerId, selectedCustomer);

      if (response.status === 200) {
        // console.log(response)
        const { data } = response;
        setselectedCustomer(data.data);
        console.log("Cliente atualizado:", data.data);
        toast.success("Cliente Atualizado");
        await handleGetCustomer(data.data.id, true);
      }
    } catch (error) {
      console.log("Erro ao atualizar cliente:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGetClienteVeiculos = async () => {
    setIsLoadingVeiculos(true);
    try {
      const response = await axios.get(`/api/veiculos/cliente/${selectedCustomer?.id}`);
      if (response.status === 200 && selectedCustomer) {
        const updatedCustomer = {
          ...selectedCustomer,
          veiculos: response.data.veiculos,
        };
        setselectedCustomer(updatedCustomer);
        onUpdate?.(updatedCustomer);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast("Erro:", { description: error.response?.data.error });
      }
    } finally {
      setIsLoadingVeiculos(false);
    }
  };

  const handleVehicleTransfer = async (novoDonoId: number) => {
    toast(
      <div className="flex felx-row gap-1 items-center">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Transferindo veículo...</span>{" "}
      </div>,
    );
    setTransferindo(true);
    try {
      const response = await axios.post(`/api/veiculos/${veiculoTransferId}/transferencia`, {
        novoDonoId: novoDonoId,
      });
      if (response.status === 200) {
        toast.success("Veículo transferido com sucesso!");
        handleGetClienteVeiculos();
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro ao transferir veículo", {
          description: error.response?.data.error,
        });
      }
    } finally {
      setTransferindo(false);
    }
  };

  useEffect(() => {
    if (customerId) {
      handleGetCustomer(customerId);
    }
  }, []);

  useEffect(() => {
    console.log(selectedCustomer);
  }, [selectedCustomer]);

  const DialogShellContent = isDesktop ? DialogContent : DrawerContent;
  const DialogShellHeader = isDesktop ? DialogHeader : DrawerHeader;
  const DialogShellFooter = isDesktop ? DialogFooter : DrawerFooter;
  const DialogShellTitle = isDesktop ? DialogTitle : DrawerTitle;
  const DialogShellDescription = isDesktop ? DialogDescription : DrawerDescription;
  const DialogShellClose = isDesktop ? DialogClose : DrawerClose;

  if (isLoading) {
    return (
      <DialogShellContent
        className={
          isDesktop
            ? `
        h-svh w-[100dvw] max-w-[100dvw] p-0 overflow-hidden min-w-0
        sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0
      `
            : `h-[100dvh] w-screen max-w-none min-h-dvh mt-0 rounded-none max-h-none flex flex-col`
        }
      >
        <DialogShellHeader className="hidden">
          <DialogShellTitle></DialogShellTitle>
        </DialogShellHeader>
        <div className="flex h-full min-h-0 flex-col justify-center items-center">
          <div className="size-8 border-t-2 border-primary rounded-t-full animate-spin"></div>
          <span className="text-primary">Carregando</span>
        </div>
      </DialogShellContent>
    );
  }

  if (selectedCustomer) {
    return (
      <DialogShellContent
        className={
          isDesktop
            ? `
        h-svh w-[100dvw] max-w-[100dvw] p-0 overflow-hidden min-w-0
        sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0
      `
            : `h-[100dvh] w-screen max-w-none min-h-dvh mt-0 rounded-none max-h-none flex flex-col`
        }
      >
        <VeiculoDialog
          setSelectedVeiculoId={setSelectedVeiculoId}
          isOpen={openVehicle}
          setIsOpen={setOpenVehicle}
          clienteId={selectedCustomer.id}
          veiculoId={veiculoId}
          onRegister={() => handleGetClienteVeiculos()}
        />
        <div className="flex h-full min-h-0 flex-col">
          <DialogShellHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
            <DialogShellTitle className="flex flex-row items-center gap-2 text-sm sm:text-lg">
              Cliente #{selectedCustomer.id}
              <span className="text-muted-foreground text-sm font-light">| Edição </span>
              <Select
                value={selectedCustomer.rank || ""}
                onValueChange={(value) =>
                  setselectedCustomer({
                    ...selectedCustomer,
                    rank: value as Cliente_rank,
                  })
                }
              >
                <SelectTrigger className="bg-transparent border-none shadow-none focus:ring-0 focus:ring-offset-0 text-[10px] hover:cursor-pointer">
                  <SelectValue placeholder="Não ranqueado" />
                </SelectTrigger>
                <SelectContent align="end" className="text-xs w-min bg-none">
                  {Object.values(Cliente_rank).map((rank) => (
                    <SelectItem
                      className="hover:cursor-pointer text-[10px] text-center flex flex-row items-center"
                      value={rank}
                      key={rank}
                    >
                      {getRankEmoji(rank)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DialogShellTitle>
            <DialogShellDescription>Modifique dados para atualizar o cliente</DialogShellDescription>
          </DialogShellHeader>

          {/* Área principal com abas */}
          <Tabs defaultValue="Geral" className="flex-1 min-h-0 overflow-hidden pb-0">
            <div className="sticky top-0 z-10 mt-4 shrink-0">
              <div className="overflow-x-auto px-6 pb-2">
                <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                  <TabsTrigger
                    value="Geral"
                    className="group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    <span className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Geral
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="Veículos"
                    className="group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Car className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Veículos
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="Ordens"
                    className="group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    <span className="flex items-center gap-2">
                      <ClipboardList className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Ordens de Serviço
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            {/* CONTEÚDO DA ABA: o scroll fica no wrapper interno */}
            <TabsContent value="Geral" className="h-full min-h-0 overflow-hidden p-0 b">
              <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        <Avatar className="h-12 w-12 sm:h-14 sm:w-14">
                          <AvatarImage
                            // src={fotoPreview || "/placeholder.svg"}
                            alt="Foto do cliente"
                          />
                          <AvatarFallback className="text-sm">
                            {selectedCustomer.tipopessoa === "FISICA" ? (
                              <User className="h-5 w-5 sm:h-6 sm:w-6" />
                            ) : (
                              <Building2 className="h-5 w-5 sm:h-6 sm:w-6" />
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <Label htmlFor="foto-upload" className="absolute -bottom-1 -right-1 cursor-pointer">
                          <div className="rounded-full bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-primary/90">
                            <Camera className="h-3 w-3" />
                          </div>
                          <input id="foto-upload" type="file" accept="image/*" className="hidden" />
                        </Label>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          {selectedCustomer.nomerazaosocial?.trim() || `Cliente #${selectedCustomer.id}`}
                        </p>
                        <p className="text-xs text-muted-foreground">Atualize os dados cadastrais do cliente.</p>
                      </div>
                    </div>

                    <div className="grid flex-1 grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="status" className="text-sm">
                          Status
                        </Label>
                        <Select
                          value={selectedCustomer.status}
                          onValueChange={(value: StatusCliente) => handleInputChange("status", value)}
                        >
                          <SelectTrigger className={cn("h-10 sm:h-11", statusOptionClass[selectedCustomer.status])}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              value="ATIVO"
                              className={cn("px-2 py-1.5 text-sm font-medium hover:cursor-pointer", statusOptionClass.ATIVO)}
                            >
                              {statusLabel.ATIVO}
                            </SelectItem>
                            <SelectItem
                              value="INATIVO"
                              className={cn("px-2 py-1.5 text-sm font-medium hover:cursor-pointer", statusOptionClass.INATIVO)}
                            >
                              {statusLabel.INATIVO}
                            </SelectItem>
                            <SelectItem
                              value="PENDENTE"
                              className={cn("px-2 py-1.5 text-sm font-medium hover:cursor-pointer", statusOptionClass.PENDENTE)}
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
                          value={selectedCustomer.tipopessoa}
                          onValueChange={(value: TipoPessoa) => handleInputChange("tipopessoa", value)}
                        >
                          <SelectTrigger className="h-10 sm:h-11">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FISICA" className="hover:cursor-pointer">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4" />
                                <span className="text-sm">Pessoa Física</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="JURIDICA" className="hover:cursor-pointer">
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
                      {selectedCustomer.tipopessoa === "FISICA" ? "CPF" : "CNPJ"} *
                    </Label>
                    <div className=" relative">
                      {isLoadingCNPJ && (
                        <Loader2 className="w-4 h-4 absolute right-9 top-2.5 animate-spin text-primary" />
                      )}
                      <div className="relative">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              onClick={handleGetCNPJ}
                              className="p-1 hover:bg-gray-500/20 cursor-pointer transition-all rounded-3xl absolute top-1.5 right-2 m-0"
                            >
                              <IdCard className="w-4 h-4" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>Consultar CNPJ</TooltipContent>
                        </Tooltip>
                        <Input
                          id="cpfcnpj"
                          inputMode="numeric"
                          className=""
                          value={formatCpfCnpj(selectedCustomer.cpfcnpj, selectedCustomer.tipopessoa) || ""}
                          onChange={(e) => {
                            const onlyNumbers = e.target.value.replace(/\D/g, "");

                            handleInputChange("cpfcnpj", onlyNumbers);
                          }}
                          placeholder={
                            selectedCustomer.tipopessoa === "FISICA" ? "000.000.000-00" : "00.000.000/0000-00"
                          }
                          maxLength={selectedCustomer.tipopessoa === "FISICA" ? 14 : 18}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="nomerazaosocial" className="text-sm">
                      {selectedCustomer.tipopessoa === "FISICA" ? "Nome Completo" : "Razão Social"} *
                    </Label>
                    <Input
                      id="nomerazaosocial"
                      className=""
                      value={selectedCustomer.nomerazaosocial || ""}
                      onChange={(e) => handleInputChange("nomerazaosocial", e.target.value)}
                      placeholder={selectedCustomer.tipopessoa === "FISICA" ? "João da Silva" : "Empresa LTDA"}
                    />
                  </div>
                </div>

                {/* Contato */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center gap-2 text-sm">
                      <Mail className="h-3 w-3 sm:h-4 sm:w-4" />
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      className=""
                      value={selectedCustomer.email || ""}
                      onChange={(e) => handleInputChange("email", e.target.value)}
                      placeholder="cliente@email.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="telefone" className="flex items-center gap-2 text-sm">
                      <Phone className="h-3 w-3 sm:h-4 sm:w-4" />
                      Telefone
                    </Label>
                    <Input
                      id="telefone"
                      inputMode="tel"
                      className=""
                      value={formatTelefone(selectedCustomer.telefone) || ""}
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
                          value={formatCep(selectedCustomer.cep) || ""}
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
                        value={selectedCustomer.endereco || ""}
                        onChange={(e) => handleInputChange("endereco", e.target.value)}
                        placeholder="Rua, número, complemento, bairro"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="numero" className="text-sm">
                        Número
                      </Label>
                      <Input
                        id="endereconumero"
                        className=""
                        value={selectedCustomer.endereconumero || ""}
                        onChange={(e) => handleInputChange("endereconumero", e.target.value)}
                        placeholder="123"
                      />
                    </div>
                  </div>
                </div>


                <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="estado" className="text-sm">
                      Estado
                    </Label>

                    <Popover open={open2} onOpenChange={setOpen2}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={open2}
                          className="w-full justify-between"
                        >
                          {selectedCustomer.estado
                            ? ESTADOS_BRASIL.find((estado) => estado === selectedCustomer.estado)
                            : "Selecione..."}
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </PopoverTrigger>

                      <PopoverContent
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                        onWheel={(e) => e.stopPropagation()}
                        onTouchMove={(e) => e.stopPropagation()}
                        onOpenAutoFocus={(e) => e.preventDefault()}
                      >
                        <Command>
                          <CommandInput placeholder="Buscar estado..." className="h-9 text-base" />
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
                                    setselectedCustomer({
                                      ...selectedCustomer,
                                      estado: currentValue,
                                    });
                                    setOpen2(false);
                                  }}
                                >
                                  {estado}
                                  <Check
                                    className={cn(
                                      "ml-auto",
                                      selectedCustomer.estado === estado ? "opacity-100" : "opacity-0",
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
                      Cidade
                    </Label>

                    <Popover open={open} onOpenChange={setOpen}>
                      <PopoverTrigger disabled={selectedCustomer.estado ? false : true} asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={open}
                          className="w-full justify-between"
                        >
                          {selectedCustomer.cidade
                            ? cidades.find((cidade) => cidade.nome === selectedCustomer.cidade)?.nome
                            : loading
                              ? "Carregando..."
                              : selectedCustomer.estado
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
                          <CommandInput placeholder="Buscar cidade..." className="h-9 text-base" />
                          <CommandList className="max-h-45 overflow-y-auto overscroll-contain">
                            <CommandEmpty>Nenhuma cidade encontrada.</CommandEmpty>

                            {/* Aqui NÃO precisa de overflow/max-h */}
                            <CommandGroup>
                              {cidades.map((cidade) => (
                                <CommandItem
                                  className="hover:cursor-pointer"
                                  key={cidade.id}
                                  value={cidade.nome}
                                  onSelect={() => {
                                    setselectedCustomer({
                                      ...selectedCustomer,
                                      cidade: cidade.nome,
                                      codigomunicipio: String(cidade.id),
                                    });
                                    setOpen(false);
                                  }}
                                >
                                  {cidade.nome}
                                  <Check
                                    className={cn(
                                      "ml-auto",
                                      selectedCustomer.cidade === cidade.nome ? "opacity-100" : "opacity-0",
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
                    <Label htmlFor="bairro" className="text-sm">
                      Bairro
                    </Label>
                    <Input
                      id="bairro"
                      className=""
                      value={selectedCustomer.bairro || ""}
                      onChange={(e) => handleInputChange("bairro", e.target.value)}
                      placeholder="Ap, bloco..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="complemento" className="text-sm">
                      Complemento
                    </Label>
                    <Input
                      id="enderecocomplemento"
                      className=""
                      value={selectedCustomer.enderecocomplemento || ""}
                      onChange={(e) => handleInputChange("enderecocomplemento", e.target.value)}
                      placeholder="Ap, bloco..."
                    />
                  </div>
                </div>
                </div>

                {/* Dados fiscais - Apenas para Pessoa Jurídica */}
                {selectedCustomer.tipopessoa === "JURIDICA" && (
                  <>
                    <Separator />
                    
                    <div className="space-y-3 sm:space-y-4 rounded-lg border bg-card p-4">
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                        <h3 className="text-base sm:text-lg font-semibold">Dados Fiscais</h3>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="inscricaoestadual" className="text-sm">
                            Inscrição Estadual
                          </Label>
                          <Input
                            id="inscricaoestadual"
                            className=""
                            value={selectedCustomer.inscricaoestadual || ""}
                            onChange={(e) => handleInputChange("inscricaoestadual", e.target.value)}
                            placeholder="123456789"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="inscricaomunicipal" className="text-sm">
                            Inscrição Municipal
                          </Label>
                          <Input
                            id="inscricaomunicipal"
                            className=""
                            value={selectedCustomer.inscricaomunicipal || ""}
                            onChange={(e) => handleInputChange("inscricaomunicipal", e.target.value)}
                            placeholder="123456789"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="codigomunicipio" className="text-sm">
                          Código do Município
                        </Label>
                        <Input
                          id="codigomunicipio"
                          className=""
                          value={selectedCustomer.codigomunicipio || ""}
                          onChange={(e) => handleInputChange("codigomunicipio", e.target.value)}
                          placeholder="3550308"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Botões */}
              </div>
            </TabsContent>

            {/* Exemplos para as outras abas (mantêm a mesma estrutura) */}
            <TabsContent value="Veículos" className="h-full min-h-0 overflow-hidden p-0">
              <div className="h-full min-h-0 overflow-auto rounded-md bg-muted-foreground/5 px-4 py-6 space-y-4 sm:px-6">
                <span
                  onClick={handleGetClienteVeiculos}
                  className="text-xs text-muted-foreground flex flex-row items-center gap-1 hover:cursor-pointer"
                >
                  Recarregar <Loader2 className={`w-3 h-3 ${isLoadingVeiculos && "animate-spin"}`} />
                </span>
                <div className="w-full flex flex-row justify-end">
                  <Button
                    disabled={isLoadingVeiculos || transferindo}
                    onClick={() => {
                      setOpenVehicle(true);
                    }}
                    className="text-xs hover:cursor-pointer"
                    variant={"outline"}
                  >
                    <Plus /> Veículo
                  </Button>
                </div>
                <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Veículos
                      </h3>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Histórico de veículos vinculados a este cliente.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 shadow-sm">
                    <span className="text-xs font-medium text-muted-foreground">Total:</span>
                    <span className="text-sm font-bold">{selectedCustomer.veiculos?.length ?? 0}</span>
                  </div>
                </div>
                                <div className="w-full max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border bg-card sm:max-w-full">
                  <div className="max-w-full overflow-x-auto">

                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center">ID</TableHead>
                      <TableHead className="text-center">Descrição</TableHead>
                      <TableHead className="text-center hidden md:table-cell">Placa</TableHead>
                      <TableHead className="text-center hidden md:table-cell">Cor</TableHead>
                      <TableHead className="text-center hidden md:table-cell">Fab/Mod</TableHead>
                      <TableHead className="text-center">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedCustomer.veiculos.length > 0 ? (
                      selectedCustomer.veiculos.map((vehicle) => (
                        <TableRow key={vehicle.id} className="hover:cursor-pointer text-center">
                          <TableCell>{vehicle.id}</TableCell>
                          <TableCell>
                            <div className="flex flex-col text-left gap-1 md:hidden text-xs">
                              <span className="font-medium">
                                {vehicle.marca}/{vehicle.modelo}
                              </span>
                              <span className="text-muted-foreground">
                                {vehicle.placa} - {vehicle.ano} - {vehicle.cor}
                              </span>
                            </div>
                            <span className="hidden md:block">
                              {vehicle.marca}/{vehicle.modelo} {vehicle.versao}
                            </span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{vehicle.placa}</TableCell>
                          <TableCell className="hidden md:table-cell">{vehicle.cor}</TableCell>
                          <TableCell className="hidden md:table-cell">{vehicle.ano}</TableCell>
                          <TableCell className="text-center items-center flex justify-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger className="hover:cursor-pointer">
                                <Ellipsis className="w-4 h-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="text-xs">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedVeiculoId(vehicle.id);
                                    setOpenVehicle(true);
                                  }}
                                  className="hover:cursor-pointer"
                                >
                                  <Pen />
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setOpenCustomerSelect(true);
                                    setVeiculoTransferId(vehicle?.id);
                                  }}
                                  className="hover:cursor-pointer bg-blue-600/10 hover:bg-blue-600/20 data-[highlighted]:bg-blue-600/50 transition-all"
                                >
                                  <ArrowLeftRight />
                                  Transferir Propriedade
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell className="text-center h-20" colSpan={99}>
                          Cliente não possui veículos cadastrados
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent
              value="Ordens"
              className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-muted-foreground/5 p-0"
            >
              <div className="h-full min-h-0 min-w-0 max-w-full space-y-4 overflow-auto px-2 py-3 sm:px-6 sm:py-6">
                <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Ordens de Serviço
                      </h3>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Histórico de ordens de serviço vinculadas a este cliente.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 shadow-sm">
                    <span className="text-xs font-medium text-muted-foreground">Total:</span>
                    <span className="text-sm font-bold">{selectedCustomer.ordens?.length ?? 0}</span>
                  </div>
                </div>

                <div className="w-full max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border bg-card sm:max-w-full">
                  <div className="max-w-full overflow-x-auto">
                    <Table className="max-w-none text-xs">
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-[90px]">ID</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Alvo</TableHead>
                          <TableHead>Detalhes</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Valor Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedCustomer.ordens?.length > 0 ? (
                          selectedCustomer.ordens.map((ordem: any) => {
                            const dataOrdem = ordem.dataentrada || ordem.createdat || ordem.created_at;
                            const produtos = Array.isArray(ordem.produtos) ? ordem.produtos : [];
                            const servicos = Array.isArray(ordem.servicos) ? ordem.servicos : [];
                            const expanded = expandedOrdemId === ordem.id;
                            const alvoDescricao =
                              ordem.alvo_tipo === "PECA"
                                ? ordem.peca?.titulo || ordem.peca?.descricao || "Peça não informada"
                                : ordem.veiculo
                                  ? `${ordem.veiculo.marca ?? ""} ${ordem.veiculo.modelo ?? ""}`.trim() ||
                                  ordem.veiculo.modelo ||
                                  "Veículo vinculado"
                                  : "Veículo não informado";

                            return (
                              <Fragment key={ordem.id}>
                                <TableRow
                                  className="cursor-pointer transition-colors hover:bg-muted/50"
                                  onClick={() => setExpandedOrdemId(expanded ? null : ordem.id)}
                                >
                                  <TableCell className="font-medium text-muted-foreground">
                                    <span className="inline-flex items-center gap-1.5">
                                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                                      #{ordem.id}
                                    </span>
                                  </TableCell>
                                  <TableCell>{formatDate(dataOrdem)}</TableCell>
                                  <TableCell>{ordem.alvo_tipo === "PECA" ? "Peça" : "Veículo"}</TableCell>
                                  <TableCell className="max-w-[180px]">
                                    <div className="flex flex-col gap-1">
                                      <span className="truncate" title={alvoDescricao}>
                                        {alvoDescricao}
                                      </span>
                                      {ordem.alvo_tipo === "PECA" && ordem.peca?.lacre ? (
                                        <span className="text-[11px] text-muted-foreground">Lacre: {ordem.peca.lacre}</span>
                                      ) : null}
                                      {ordem.alvo_tipo !== "PECA" && ordem.veiculo?.placa ? (
                                        <span className="text-[11px] text-muted-foreground">Placa: {ordem.veiculo.placa}</span>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell className="max-w-[220px]">
                                    <div className="flex flex-col gap-1">
                                      <span className="truncate font-medium" title={ordem.descricao || ""}>
                                        {ordem.descricao || "Sem descrição"}
                                      </span>
                                      {ordem.prioridade ? (
                                        <span className="text-[11px] text-muted-foreground">
                                          Prioridade: {String(ordem.prioridade)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell>{getStatusBadge(ordem.status)}</TableCell>
                                  <TableCell className="text-right font-medium">
                                    {formatCurrency(ordem.orcamentototal || 0)}
                                  </TableCell>
                                </TableRow>
                                {expanded ? (
                                  <TableRow className="bg-muted/20">
                                    <TableCell colSpan={7} className="p-3">
                                      <div className="grid min-w-[760px] grid-cols-2 gap-3">
                                        <div className="rounded-md border bg-background p-3">
                                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Serviços
                                          </p>
                                          {servicos.length > 0 ? (
                                            <div className="space-y-2">
                                              {servicos.map((item: any, index: number) => (
                                                <div key={`${ordem.id}-servico-${index}`} className="flex items-center justify-between gap-3 text-xs">
                                                  <span className="truncate" title={item.servico?.descricao || ""}>
                                                    {item.servico?.descricao || "Serviço"}
                                                  </span>
                                                  <span className="shrink-0 font-medium">
                                                    {formatCurrency(item.subtotal || 0)}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="text-xs text-muted-foreground">Nenhum serviço vinculado.</p>
                                          )}
                                        </div>

                                        <div className="rounded-md border bg-background p-3">
                                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Produtos
                                          </p>
                                          {produtos.length > 0 ? (
                                            <div className="space-y-2">
                                              {produtos.map((item: any, index: number) => (
                                                <div key={`${ordem.id}-produto-${index}`} className="flex items-center justify-between gap-3 text-xs">
                                                  <span className="truncate" title={item.produto?.titulo || ""}>
                                                    {item.produto?.titulo || "Produto"}
                                                  </span>
                                                  <span className="shrink-0 font-medium">
                                                    {formatCurrency(item.subtotal || 0)}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="text-xs text-muted-foreground">Nenhum produto vinculado.</p>
                                          )}
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            );
                          })
                        ) : (
                          <TableRow>
                            <TableCell className="h-20 text-center" colSpan={7}>
                              Cliente não possui ordens cadastradas
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

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
                className="h-9 min-w-24 text-sm hover:cursor-pointer"
                onClick={handleUpdateCustomer}
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
        <CustomerSelect
          open={openCustomerSelect}
          setOpen={setOpenCustomerSelect}
          OnSelect={(c) => handleVehicleTransfer(c.id)}
        />
      </DialogShellContent>
    );
  }
}
