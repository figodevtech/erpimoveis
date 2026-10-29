"use client";

import type React from "react";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useModulePermission } from "@/components/imobiliario/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  MapPin,
  Search,
  Loader2,
  IdCard,
  ShoppingBag,
  Gauge,
  WalletCards,
  File,
  CalendarDays,
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
import { StatusCliente, TelefoneSecundario, TipoPessoa, ESTADOS_BRASIL } from "./types";
import { formatCep, formatCpfCnpj, formatTelefone, getRankEmoji, toTelefonesSecundarios } from "./utils";
import { Cliente_rank, Customer } from "../../types";
import axios, { isAxiosError } from "axios";
import { useGetCidades } from "@/app/(app)/hooks/useGetCidades";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import CustomerRelationshipTabs from "./customerRelationshipTabs";
import CustomerCreditoTab from "./customerCreditoTab";
import SecondaryPhonesCard from "./secondaryPhonesCard";
import CustomerSiteAccessCard from "./customerSiteAccessCard";
import { isValidCnpj, normalizeCnpj, normalizeCpf } from "@/lib/fiscal-identifiers";
const CustomerReservasTab = dynamic(() => import("./customerReservasTab"), { loading: () => <p role="status" className="p-4 text-sm">Carregando reservas…</p> });

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


export default function EditContent({ customerId, isDesktop = true, onUpdate }: EditContentProps) {
  const [activeTab, setActiveTab] = useState("Geral");
  const { can } = useModulePermission();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingCNPJ, setIsLoadingCNPJ] = useState(false);
  const [selectedCustomer, setselectedCustomer] = useState<Customer | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCep, setIsLoadingCep] = useState(false);
  const {
    cidades,
    loading,
    error: erroCidades,
    origem: origemCidades,
    recarregar: recarregarCidades,
  } = useGetCidades(selectedCustomer?.estado ?? undefined);
  const [open, setOpen] = useState(false);
  const [open2, setOpen2] = useState(false);
  // Os secundários vivem em tabela própria; ficam fora de `selectedCustomer`
  // para o PUT do cliente continuar exatamente o que era.
  const [telefonesSecundarios, setTelefonesSecundarios] = useState<TelefoneSecundario[]>([]);

  function validarEmailDigitado(email: string): boolean {
    const valor = email.trim();
    if (!valor) return true;

    // Mesmo regex usado na constraint (case-insensitive)
    const regex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

    return regex.test(valor);
  }

  // `ind_ie_dest` é numérico; os demais campos do cadastro são texto.
  const handleInputChange = (field: keyof Customer, value: string | number | null) => {
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
        setTelefonesSecundarios(toTelefonesSecundarios(data.data?.telefones));
        if (notifyUpdate) onUpdate?.(data.data);
      }
    } catch (error) {
      console.log("Erro ao buscar cliente:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetCNPJ = async () => {
    const cnpj = normalizeCnpj(selectedCustomer?.cpfcnpj);
    if (!isValidCnpj(cnpj)) {
      toast.warning("CNPJ inválido para consulta");
      return;
    }
    if (/[A-Z]/.test(cnpj)) {
      toast.info("A consulta automática ainda não declara suporte ao CNPJ alfanumérico. Preencha os dados manualmente.");
      return;
    }
    setIsLoadingCNPJ(true);
    try {
      const response = await axios.get(`https://publica.cnpj.ws/cnpj/${cnpj}`);
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
            codigomunicipio: String(juridica.estabelecimento.cidade.ibge_id),
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

  // Linha totalmente em branco é descartada: o + adiciona antes de digitar.
  const telefonesPreenchidos = () =>
    telefonesSecundarios.filter(
      (item) =>
        item.telefone.trim() !== "" ||
        item.contato.trim() !== "" ||
        item.observacao.trim() !== "",
    );

  const handleSalvarTelefonesSecundarios = async (clienteId: number) => {
    await axios.put("/api/customers/" + clienteId + "/telefones", {
      telefones: telefonesPreenchidos(),
    });
  };

  const handleUpdateCustomer = async () => {
    if (!validarEmailDigitado(selectedCustomer?.email || "")) {
      toast.warning("Insira um email válido");
      return;
    }
    if (telefonesPreenchidos().some((item) => !/^\d{10,11}$/.test(item.telefone.replace(/\D/g, "")))) {
      toast.warning("Informe DDD e número em todos os telefones secundários.");
      return;
    }
    if (
      selectedCustomer?.tipopessoa === "JURIDICA" &&
      (!selectedCustomer.telefone?.trim() ||
        !selectedCustomer.estado?.trim() ||
        !selectedCustomer.cidade?.trim())
    ) {
      toast.warning("Informe o telefone, o estado e a cidade do cliente.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await axios.put("/api/customers/" + customerId, selectedCustomer);

      if (response.status === 200) {
        // console.log(response)
        const { data } = response;
        // O PUT devolve so as colunas do cliente; veiculos/ordens/telefones
        // ficam de fora. Substituir o objeto inteiro apagaria as listas que a
        // tela ja tem em maos e quebraria a aba aberta ate o refetch chegar.
        setselectedCustomer((prev) =>
          prev ? { ...prev, ...data.data } : data.data,
        );
        // O cadastro já foi salvo; a falha aqui é só dos telefones extras.
        try {
          await handleSalvarTelefonesSecundarios(data.data.id);
          toast.success("Cliente Atualizado");
        } catch (telefonesError) {
          console.log("Erro ao salvar telefones do cliente:", telefonesError);
          toast.warning("Cliente salvo, mas os telefones secundários não foram gravados.", {
            description: isAxiosError(telefonesError)
              ? telefonesError.response?.data?.error
              : undefined,
          });
        }
        await handleGetCustomer(data.data.id, true);
      }
    } catch (error) {
      console.log("Erro ao atualizar cliente:", error);
      if (isAxiosError(error)) {
        toast.error("Erro ao salvar cliente", {
          description: error.response?.data?.error,
        });
      }
    } finally {
      setIsSubmitting(false);
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
        {/* min-w-0: o DialogContent e um grid, sem isso o min-content das abas
            estica a track e o strip para de rolar no mobile. */}
        <div className="relative flex h-full min-h-0 w-full min-w-0 max-w-full flex-col">
          <div className="absolute top-4 right-16 z-10 flex flex-row items-center gap-2 p-2 bg-card rounded-lg shadow-sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Imprimir ficha cadastral do cliente"
                onClick={() => window.open(`/print/cliente/${selectedCustomer.id}`, "_blank")}
                className="flex size-6 items-center justify-center rounded transition-colors hover:cursor-pointer hover:bg-muted"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Imprimir cliente</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Imprimir histórico do cliente"
                onClick={() =>
                  window.open(`/print/cliente/${selectedCustomer.id}/historico`, "_blank")
                }
                className="flex size-6 items-center justify-center rounded transition-colors hover:cursor-pointer hover:bg-muted"
              >
                <File className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Impressão de histórico</TooltipContent>
          </Tooltip>
          </div>
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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 w-full min-w-0 overflow-hidden pb-0">
            <div className="sticky top-0 z-10 mt-4 w-full min-w-0 shrink-0">
              {/* Wrapper flex (nao block) para o Chrome respeitar o padding final
                  do scroll; touch-pan-x evita o drawer roubar o gesto. */}
              <div className="flex w-full max-w-full touch-pan-x overflow-x-auto overscroll-x-contain px-4 pb-2 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <TabsList className="h-auto w-max min-w-full shrink-0 justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                  <TabsTrigger
                    value="Geral"
                    className="group h-11 flex-none rounded-xl border border-transparent px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    <span className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Geral
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="Vendas"
                    className="group h-11 flex-none rounded-xl border border-transparent px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    <span className="flex items-center gap-2">
                      <ShoppingBag className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Vendas
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="Financeiro"
                    className="group h-11 flex-none rounded-xl border border-transparent px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Gauge className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Financeiro
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="Credito"
                    className="group h-11 flex-none rounded-xl border border-transparent px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    <span className="flex items-center gap-2">
                      <WalletCards className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Crédito
                    </span>
                  </TabsTrigger>
                  {can("reservas:visualizar") ? <TabsTrigger value="Reservas" className="group h-11 flex-none rounded-xl border border-transparent px-3 text-xs font-medium whitespace-nowrap text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><span className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" />Reservas</span></TabsTrigger> : null}
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

                <CustomerSiteAccessCard customerId={selectedCustomer.id} />

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
                          inputMode={selectedCustomer.tipopessoa === "FISICA" ? "numeric" : "text"}
                          className=""
                          value={formatCpfCnpj(selectedCustomer.cpfcnpj, selectedCustomer.tipopessoa) || ""}
                          onChange={(e) => {
                            const documento = selectedCustomer.tipopessoa === "FISICA"
                              ? normalizeCpf(e.target.value).slice(0, 11)
                              : normalizeCnpj(e.target.value).slice(0, 14);

                            handleInputChange("cpfcnpj", documento);
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
                      Telefone (principal)
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
                            ? // Sem o fallback, a cidade ja salva some do botao
                              // enquanto a lista do IBGE nao carrega (ou falha).
                              cidades.find((cidade) => cidade.nome === selectedCustomer.cidade)?.nome ??
                              selectedCustomer.cidade
                            : loading
                              ? "Carregando..."
                              : erroCidades
                                ? "Cidades indisponíveis"
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

                <SecondaryPhonesCard
                  telefones={telefonesSecundarios}
                  setTelefones={setTelefonesSecundarios}
                  disabled={isSubmitting}
                />

                {/* Dados fiscais - Apenas para Pessoa Jurídica */}
                {selectedCustomer.tipopessoa === "JURIDICA" && (
                  <>
                    <Separator />
                    
                    <div className="space-y-3 sm:space-y-4 rounded-lg border bg-card p-4">
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                        <h3 className="text-base sm:text-lg font-semibold">Dados Fiscais</h3>
                      </div>

                      <IndicadorIeSelect
                        value={selectedCustomer.ind_ie_dest}
                        onChange={(indicador) => handleInputChange("ind_ie_dest", indicador)}
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="inscricaoestadual" className="text-sm">
                            Inscrição Estadual
                            {selectedCustomer.ind_ie_dest === 1 ? (
                              <span className="text-red-500"> *</span>
                            ) : null}
                          </Label>
                          <Input
                            id="inscricaoestadual"
                            className=""
                            // Só contribuinte do ICMS manda IE na nota. Nos demais
                            // o campo fica travado, mas o valor cadastrado é
                            // preservado — trocar o indicador não apaga histórico.
                            disabled={
                              selectedCustomer.ind_ie_dest === 2 ||
                              selectedCustomer.ind_ie_dest === 9
                            }
                            value={selectedCustomer.inscricaoestadual || ""}
                            onChange={(e) => handleInputChange("inscricaoestadual", e.target.value)}
                            placeholder="123456789"
                          />
                          {selectedCustomer.ind_ie_dest === 1 &&
                          !String(selectedCustomer.inscricaoestadual ?? "").trim() ? (
                            <p className="text-xs text-destructive">
                              Obrigatória para contribuinte do ICMS.
                            </p>
                          ) : selectedCustomer.ind_ie_dest === 9 ? (
                            <p className="text-xs text-muted-foreground">
                              Não será enviada na NF-e.
                            </p>
                          ) : null}
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

            <CustomerRelationshipTabs customer={selectedCustomer} />
            <CustomerCreditoTab customer={selectedCustomer} />
            {activeTab === "Reservas" && can("reservas:visualizar") ? <CustomerReservasTab customer={selectedCustomer} /> : null}
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
      </DialogShellContent>
    );
  }
}
