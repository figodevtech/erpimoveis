"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import axios from "axios";
import {
  Loader2,
  Calendar,
  User,
  Car,
  Wrench,
  CheckSquare,
  Package,
  AlertCircle,
  Clock,
  Briefcase,
  FileText,
  CircleDollarSign,
  Gauge,
  Palette,
  Hash,
  CalendarClock,
  ClipboardCheck,
  Box,
} from "lucide-react";
import { StatusBadge } from "./badge-status";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusOS } from "../types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface OrdemDetailsDialogProps {
  osId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Realizador = {
  id: string;
  nome: string | null;
};

type ServicoItem = {
  servicoid: number;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  servico: {
    id: number;
    codigo: string | null;
    descricao: string | null;
    precohora: number | null;
  } | null;
  realizadores: Realizador[];
};

type ProdutoItem = {
  produtoid: number;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  produto: {
    id: number;
    codigo: string | null;
    descricao: string;
    titulo: string;
    precounitario: number | null;
    unidade: string | null;
  } | null;
};

type ChecklistItem = {
  id: number;
  item: string;
  status: "OK" | "ALERTA" | "FALHA";
  observacao: string | null;
  createdat: string | null;
  imagens: Array<{
    id: number;
    url: string;
    descricao: string | null;
    createdat: string | null;
  }>;
};

type Aprovacao = {
  id: number;
  token: string;
  expira_em: string | null;
  usado_em: string | null;
  created_at: string | null;
};

type APIResponse = {
  os: {
    id: number;
    descricao: string | null;
    status: StatusOS;
    statusaprovacao: string | null;
    dataentrada: string | null;
    datasaida: string | null;
    orcamentototal: number | null;
    observacoes: string | null;
    updatedat: string | null;
    execucao_inicio_em: Date | null;
    setor: { id: number; nome: string } | null;
    cliente: { id: number; nomerazaosocial: string } | null;
    veiculo: {
      id: number;
      placa: string | null;
      modelo: string | null;
      marca: string | null;
      ano: number | null;
      cor: string | null;
      kmatual: number | null;
    } | null;
    peca: {
      id: number;
      descricao: string;
      titulo: string;
    } | null;
  };
  itensProduto: ProdutoItem[];
  itensServico: ServicoItem[];
  checklist: ChecklistItem[];
  aprovacoes: Aprovacao[];
};

function formatDate(dateString?: string | null) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(val: number | null) {
  return (val ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function OrdemDetailsDialog({
  osId,
  open,
  onOpenChange,
}: OrdemDetailsDialogProps) {
  const [data, setData] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("geral");

  useEffect(() => {
    if (!open || !osId) {
      setData(null);
      return;
    }

    const controller = new AbortController();

    async function load() {
      setLoading(true);
      try {
        const res = await axios.get<APIResponse>(`/api/ordens/${osId}`, {
          signal: controller.signal,
        });
        setData(res.data);
      } catch (err: any) {
        if (err?.name !== "CanceledError") {
          console.error("Erro ao carregar OS:", err);
        }
      } finally {
        setLoading(false);
      }
    }

    load();

    return () => {
      controller.abort();
    };
  }, [open, osId]);

  const totalServicos =
    data?.itensServico.reduce((acc, s) => acc + s.subtotal, 0) ?? 0;
  const totalProdutos =
    data?.itensProduto.reduce((acc, p) => acc + p.subtotal, 0) ?? 0;

  type DiferencaFormatada = {
    dias: number;
    horas: number;
    minutos: number;
    texto: string;
  };

  function diferencaEntreDatas(
    dataA: Date | string | number | null,
    dataB: Date | string | number | null,
  ): DiferencaFormatada {
    if (!dataA || !dataB) {
      return { dias: 0, horas: 0, minutos: 0, texto: "0m" };
    }

    const a = new Date(dataA).getTime();
    const b = new Date(dataB).getTime();

    if (Number.isNaN(a) || Number.isNaN(b)) {
      throw new Error("Data inválida. Passe Date, ISO string ou timestamp.");
    }

    let diffMs = Math.abs(b - a);

    const msPorMinuto = 60_000;
    const msPorHora = 60 * msPorMinuto;
    const msPorDia = 24 * msPorHora;

    const dias = Math.floor(diffMs / msPorDia);
    diffMs -= dias * msPorDia;

    const horas = Math.floor(diffMs / msPorHora);
    diffMs -= horas * msPorHora;

    const minutos = Math.floor(diffMs / msPorMinuto);

    const partes: string[] = [];

    if (dias > 0) partes.push(`${dias}d`);
    if (horas > 0 || dias > 0) partes.push(`${horas}h`); // se tem dia, mostra hora mesmo que 0
    partes.push(`${minutos}m`); // sempre mostra minutos

    const texto =
      partes.length === 1
        ? partes[0]
        : partes.length === 2
          ? `${partes[0]} e ${partes[1]}`
          : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;

    return { dias, horas, minutos, texto };
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-dvh md:h-[90vh] flex flex-col p-0 pb-6 gap-0 overflow-hidden border-0 shadow-2xl">
        {/* Header */}
        <DialogHeader className="px-4 sm:px-6 py-4 sm:py-5 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b flex-shrink-0">
          <DialogTitle className="flex flex-row sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <Wrench className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <div>
                <h2 className="sm:hidden text-md sm:text-xl font-bold text-foreground">
                  OS
                </h2>
                <h2 className="hidden sm:block text-md sm:text-xl font-bold text-foreground">
                  Ordem de Serviço
                </h2>
                <p className="text-sm text-muted-foreground font-medium">
                  #{osId?.toString().padStart(6, "0")}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 mr-4">
              {data && (
                <StatusBadge
                  className="mr-5 text-nowrap"
                  status={data.os.status}
                />
              )}
              {data &&
                data.os.status === "EM_ANDAMENTO" &&
                data.os.dataentrada && (
                  <div className="text-sm text-muted-foreground mr-3">
                    Há{" "}
                    {
                      diferencaEntreDatas(
                        data.os.execucao_inicio_em,
                        new Date(),
                      ).texto
                    }
                  </div>
                )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative p-4 rounded-full bg-primary/10">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground animate-pulse">
              Carregando detalhes...
            </p>
          </div>
        ) : !data ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center space-y-4">
              <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto">
                <AlertCircle className="w-10 h-10 text-destructive" />
              </div>
              <div>
                <p className="text-foreground font-semibold">
                  Erro ao carregar
                </p>
                <p className="text-sm text-muted-foreground">
                  Não foi possível carregar os dados da OS.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <Tabs
            defaultValue="geral"
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            {/* Tabs Navigation */}
            <div className="px-2 sm:px-6 pt-3 pb-0 bg-muted/30 border-b flex-shrink-0 overflow-x-auto">
              <TabsList className="bg-transparent justify-center itens-center p-0 h-auto gap-1 sm:gap-2 w-full sm:w-full flex">
                <TabsTrigger
                  value="geral"
                  className="hover:cursor-pointer flex items-center gap-1 sm:gap-2 rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs font-medium transition-all"
                >
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Geral
                </TabsTrigger>
                <TabsTrigger
                  value="servicos"
                  className="hover:cursor-pointer flex items-center gap-1 sm:gap-2 rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs font-medium transition-all"
                >
                  <Wrench className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Serviços
                </TabsTrigger>
                <TabsTrigger
                  value="produtos"
                  className="hover:cursor-pointer flex items-center gap-1 sm:gap-2 rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs font-medium transition-all"
                >
                  <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Produtos
                </TabsTrigger>
                <TabsTrigger
                  value="checklist"
                  className="hover:cursor-pointer flex items-center gap-1 sm:gap-2 rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs font-medium transition-all"
                >
                  <ClipboardCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Checklist
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Scrollable Content */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4 sm:p-6">
                {/* Tab: Geral */}
                <TabsContent value="geral" className="mt-0 space-y-6 m-0">
                  {/* Financial Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-4">
                    <Card className="col-span-2 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20 overflow-hidden">
                      <CardContent className="p-4 sm:p-5">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Total Geral
                            </p>
                            <p className="text-xl sm:text-2xl font-bold text-primary">
                              {formatCurrency(data.os.orcamentototal)}
                            </p>
                          </div>
                          <div className="p-2.5 rounded-xl bg-primary/10">
                            <CircleDollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border-blue-500/20 overflow-hidden">
                      <CardContent className="p-4 sm:p-5">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Serviços
                            </p>
                            <p className="text-lg sm:text-xl font-semibold text-blue-600 dark:text-blue-400">
                              {formatCurrency(totalServicos)}
                            </p>
                          </div>
                          <div className="p-2.5 rounded-xl bg-blue-500/10">
                            <Wrench className="w-5 h-5 text-blue-500" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/20 overflow-hidden">
                      <CardContent className="p-4 sm:p-5">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              Produtos
                            </p>
                            <p className="text-lg sm:text-xl font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(totalProdutos)}
                            </p>
                          </div>
                          <div className="p-2.5 rounded-xl bg-emerald-500/10">
                            <Package className="w-5 h-5 text-emerald-500" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Client & Vehicle Info */}
                  <div className="grid grid-cols-1 gap-4 ">
                    {/* Client Card */}
                    <Card className="overflow-hidden p-0">
                      <CardHeader className="p-0 m-0">
                        <div className="px-4 py-3 bg-muted/50 border-b flex items-center gap-2">
                          <User className="w-4 h-4 text-primary" />
                          <h3 className="font-semibold text-sm">
                            Dados do Cliente
                          </h3>
                        </div>
                      </CardHeader>
                      <CardContent className="pb-3">
                        {data.os.cliente ? (
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <User className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground text-sm">
                                {data.os.cliente?.nomerazaosocial ?? "Sem cliente vinculado"}
                              </p>
                              {data.os.cliente?.id ? (
                                <p className="text-xs text-muted-foreground">
                                  ID: {data.os.cliente.id}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-muted-foreground italic text-sm">
                            Cliente não informado
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Vehicle Card */}
                    <Card className="overflow-hidden p-0">
                      <CardHeader className="p-0 m-0">
                        <div className="px-4 py-3 bg-muted/50 border-b flex items-center gap-2">
                          {data.os.veiculo ? (
                            <Car className="w-4 h-4 text-primary" />
                          ) : (
                            <Box className="w-4 h-4 text-primary" />
                          )}
                          {data.os.veiculo ? (
                            <h3 className="font-semibold text-sm">
                              Dados do Veículo
                            </h3>
                          ) : (
                            <h3 className="font-semibold text-sm">
                              Dados do Produto
                            </h3>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="pb-4">
                        {data.os.veiculo ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <Car className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground">
                                  {data.os.veiculo.modelo || "Modelo N/A"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {data.os.veiculo.marca || "Marca N/A"}
                                </p>
                              </div>
                              <Badge
                                variant="outline"
                                className="ml-auto font-mono text-xs sm:text-sm px-2 sm:px-3"
                              >
                                {data.os.veiculo.placa || "S/Placa"}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                              <div className="text-center p-2 rounded-lg bg-muted/50">
                                <Palette className="w-3.5 h-3.5 mx-auto mb-1 text-muted-foreground" />
                                <p className="text-[10px] text-muted-foreground uppercase">
                                  Cor
                                </p>
                                <p className="text-xs font-medium truncate">
                                  {data.os.veiculo.cor || "N/A"}
                                </p>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-muted/50">
                                <Calendar className="w-3.5 h-3.5 mx-auto mb-1 text-muted-foreground" />
                                <p className="text-[10px] text-muted-foreground uppercase">
                                  Ano
                                </p>
                                <p className="text-xs font-medium">
                                  {data.os.veiculo.ano || "N/A"}
                                </p>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-muted/50">
                                <Gauge className="w-3.5 h-3.5 mx-auto mb-1 text-muted-foreground" />
                                <p className="text-[10px] text-muted-foreground uppercase">
                                  KM
                                </p>
                                <p className="text-xs font-medium">
                                  {data.os.veiculo.kmatual?.toLocaleString(
                                    "pt-BR",
                                  ) || "N/A"}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <Box className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground">
                                  {data.os.peca?.titulo || "Produto N/A"}
                                </p>
                              </div>
                            </div>
                            {data.os.peca?.descricao && (
                              <div className="w-full p-4 bg-muted-foreground/10 rounded-lg">
                                <p className="text-xs font-medium">
                                  {data.os.peca.descricao}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Timeline Info */}
                  <Card className="overflow-hidden p-0">
                    <CardHeader className="p-0 m-0">
                      <div className="px-4 py-3 bg-muted/50 border-b flex items-center gap-2">
                        <CalendarClock className="w-4 h-4 text-primary" />
                        <h3 className="font-semibold text-sm">
                          Informações da OS
                        </h3>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="w-3.5 h-3.5" />
                            <span className="text-xs font-medium">Entrada</span>
                          </div>
                          <p className="text-sm font-semibold pl-5">
                            {formatDate(data.os.dataentrada)}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="w-3.5 h-3.5" />
                            <span className="text-xs font-medium">Saída</span>
                          </div>
                          <p className="text-sm font-semibold pl-5">
                            {formatDate(data.os.datasaida)}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Briefcase className="w-3.5 h-3.5" />
                            <span className="text-xs font-medium">Setor</span>
                          </div>
                          <p className="text-sm font-semibold pl-5">
                            {data.os.setor?.nome || "-"}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            <span className="text-xs font-medium">
                              Aprovação
                            </span>
                          </div>
                          <p className="text-sm font-semibold pl-5">
                            {data.os.statusaprovacao || "-"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Description & Notes */}
                  <div className="space-y-4">
                    <Card className="overflow-hidden p-0">
                      <CardHeader className="p-0 m-0">
                        <div className="px-4 py-3 bg-muted/50 border-b flex items-center gap-2">
                          <FileText className="w-4 h-4 text-primary" />
                          <h3 className="font-semibold break-words whitespace-break-spaces text-sm">
                            Descrição
                          </h3>
                        </div>
                      </CardHeader>
                      <CardContent className="pb-4">
                        <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                          {data.os.descricao || "Nenhuma descrição informada."}
                        </p>
                      </CardContent>
                    </Card>

                    {data.os.observacoes && (
                      <Card className="p-0 overflow-hidden border-amber-500/30 bg-amber-500/5">
                        <CardHeader className="p-0 m-0">
                          <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            <h3 className="font-semibold text-sm text-amber-700 dark:text-amber-300">
                              Observações
                            </h3>
                          </div>
                        </CardHeader>
                        <CardContent className="p-4">
                          <p className="text-sm leading-relaxed text-amber-700 dark:text-amber-300">
                            {data.os.observacoes}
                          </p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                {/* Tab: Serviços */}
                <TabsContent value="servicos" className="mt-0 space-y-4 m-0">
                  {data.itensServico.length === 0 ? (
                    <Card className="p-0 border-dashed">
                      <CardContent className="p-0 py-12 flex flex-col items-center justify-center gap-3">
                        <div className="p-3 rounded-full bg-muted">
                          <Wrench className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground text-sm">
                          Nenhum serviço registrado nesta OS.
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      {/* Desktop Table View */}
                      <div className="hidden md:block">
                        <Card className="p-0 overflow-hidden">
                          <div className="bg-muted/50 px-4 py-3 border-b">
                            <div className="grid grid-cols-12 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              <div className="col-span-5">Serviço</div>
                              <div className="col-span-2 text-center">Qtd</div>
                              <div className="col-span-2 text-right">Unit.</div>
                              <div className="col-span-3 text-right">Total</div>
                            </div>
                          </div>
                          <div className="divide-y">
                            {data.itensServico.map((item, idx) => (
                              <div
                                key={idx}
                                className="px-4 py-4 grid grid-cols-12 items-center text-sm hover:bg-muted/30 transition-colors"
                              >
                                <div className="col-span-5 space-y-1.5">
                                  <p className="font-medium text-foreground">
                                    {item.servico?.descricao ||
                                      "Serviço sem nome"}
                                  </p>
                                  {item.servico?.codigo && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Hash className="w-3 h-3" />
                                      {item.servico.codigo}
                                    </p>
                                  )}
                                  {item.realizadores.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                      {item.realizadores.map((r) => (
                                        <Badge
                                          key={r.id}
                                          variant="secondary"
                                          className="text-[10px] h-5 px-2 font-normal"
                                        >
                                          <User className="w-2.5 h-2.5 mr-1" />
                                          {r.nome}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="col-span-2 text-center">
                                  <Badge
                                    variant="outline"
                                    className="font-mono"
                                  >
                                    {item.quantidade}
                                  </Badge>
                                </div>
                                <div className="col-span-2 text-right text-muted-foreground">
                                  {formatCurrency(item.precounitario)}
                                </div>
                                <div className="col-span-3 text-right font-semibold text-foreground">
                                  {formatCurrency(item.subtotal)}
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* Total Footer */}
                          <div className="px-4 py-3 bg-primary/5 border-t flex justify-between items-center">
                            <span className="text-sm font-semibold text-muted-foreground">
                              Total de Serviços
                            </span>
                            <span className="text-lg font-bold text-primary">
                              {formatCurrency(totalServicos)}
                            </span>
                          </div>
                        </Card>
                      </div>

                      {/* Mobile Card View */}
                      <div className="md:hidden space-y-3">
                        {data.itensServico.map((item, idx) => (
                          <Card key={idx} className="overflow-hidden">
                            <CardContent className="p-4 space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1 min-w-0">
                                  <p className="font-semibold text-foreground truncate">
                                    {item.servico?.descricao ||
                                      "Serviço sem nome"}
                                  </p>
                                  {item.servico?.codigo && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Hash className="w-3 h-3" />
                                      {item.servico.codigo}
                                    </p>
                                  )}
                                </div>
                                <Badge
                                  variant="outline"
                                  className="font-mono flex-shrink-0"
                                >
                                  x{item.quantidade}
                                </Badge>
                              </div>
                              {item.realizadores.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {item.realizadores.map((r) => (
                                    <Badge
                                      key={r.id}
                                      variant="secondary"
                                      className="text-[10px] h-5 px-2 font-normal"
                                    >
                                      <User className="w-2.5 h-2.5 mr-1" />
                                      {r.nome}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center justify-between pt-2 border-t">
                                <span className="text-xs text-muted-foreground">
                                  {formatCurrency(item.precounitario)} / un
                                </span>
                                <span className="font-bold text-foreground">
                                  {formatCurrency(item.subtotal)}
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                        {/* Total Card Mobile */}
                        <Card className="bg-primary/5 border-primary/20">
                          <CardContent className="p-4 flex justify-between items-center">
                            <span className="text-sm font-semibold text-muted-foreground">
                              Total
                            </span>
                            <span className="text-lg font-bold text-primary">
                              {formatCurrency(totalServicos)}
                            </span>
                          </CardContent>
                        </Card>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* Tab: Produtos */}
                <TabsContent value="produtos" className="mt-0 space-y-4 m-0">
                  {data.itensProduto.length === 0 ? (
                    <Card className="p-0 border-dashed">
                      <CardContent className="py-12 flex flex-col items-center justify-center gap-3">
                        <div className="p-3 rounded-full bg-muted">
                          <Package className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground text-sm">
                          Nenhum produto registrado nesta OS.
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      {/* Desktop Table View */}
                      <div className="hidden md:block">
                        <Card className="p-0 overflow-hidden">
                          <div className="bg-muted/50 px-4 py-3 border-b">
                            <div className="grid grid-cols-12 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              <div className="col-span-5">Produto</div>
                              <div className="col-span-2 text-center">Qtd</div>
                              <div className="col-span-2 text-right">Unit.</div>
                              <div className="col-span-3 text-right">Total</div>
                            </div>
                          </div>
                          <div className="divide-y">
                            {data.itensProduto.map((item, idx) => (
                              <div
                                key={idx}
                                className="px-4 py-4 grid grid-cols-12 items-center text-sm hover:bg-muted/30 transition-colors"
                              >
                                <div className="col-span-5 space-y-1">
                                  <p className="font-medium text-foreground">
                                    {item.produto?.titulo || "Produto sem nome"}
                                  </p>
                                  {item.produto?.codigo && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Hash className="w-3 h-3" />
                                      {item.produto.codigo}
                                    </p>
                                  )}
                                </div>
                                <div className="col-span-2 text-center">
                                  <Badge
                                    variant="outline"
                                    className="font-mono"
                                  >
                                    {item.quantidade} {item.produto?.unidade}
                                  </Badge>
                                </div>
                                <div className="col-span-2 text-right text-muted-foreground">
                                  {formatCurrency(item.precounitario)}
                                </div>
                                <div className="col-span-3 text-right font-semibold text-foreground">
                                  {formatCurrency(item.subtotal)}
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* Total Footer */}
                          <div className="px-4 py-3 bg-emerald-500/5 border-t flex justify-between items-center">
                            <span className="text-sm font-semibold text-muted-foreground">
                              Total de Produtos
                            </span>
                            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(totalProdutos)}
                            </span>
                          </div>
                        </Card>
                      </div>

                      {/* Mobile Card View */}
                      <div className="md:hidden space-y-3">
                        {data.itensProduto.map((item, idx) => (
                          <Card key={idx} className="p-0 overflow-hidden">
                            <CardContent className="p-4 space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1 min-w-0">
                                  <p className="font-semibold text-foreground">
                                    {item.produto?.titulo || "Produto sem nome"}
                                  </p>
                                  {item.produto?.codigo && (
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Hash className="w-3 h-3" />
                                      {item.produto.codigo}
                                    </p>
                                  )}
                                </div>
                                <Badge
                                  variant="outline"
                                  className="font-mono flex-shrink-0"
                                >
                                  {item.quantidade} {item.produto?.unidade}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between pt-2 border-t">
                                <span className="text-xs text-muted-foreground">
                                  {formatCurrency(item.precounitario)} / un
                                </span>
                                <span className="font-bold text-foreground">
                                  {formatCurrency(item.subtotal)}
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                        {/* Total Card Mobile */}
                        <Card className="bg-emerald-500/5 border-emerald-500/20">
                          <CardContent className="p-4 flex justify-between items-center">
                            <span className="text-sm font-semibold text-muted-foreground">
                              Total
                            </span>
                            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(totalProdutos)}
                            </span>
                          </CardContent>
                        </Card>
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* Tab: Checklist */}
                <TabsContent value="checklist" className="mt-0 space-y-4 m-0">
                  {data.checklist.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="py-12 flex flex-col items-center justify-center gap-3">
                        <div className="p-3 rounded-full bg-muted">
                          <ClipboardCheck className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground text-sm">
                          Checklist não realizado.
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {data.checklist.map((ck) => (
                        <Card
                          key={ck.id}
                          className={`overflow-hidden transition-all hover:shadow-md ${
                            ck.status === "OK"
                              ? "border-l-4 border-l-green-500"
                              : ck.status === "ALERTA"
                                ? "border-l-4 border-l-amber-500"
                                : "border-l-4 border-l-red-500"
                          }`}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div
                                className={`p-2 rounded-lg flex-shrink-0 ${
                                  ck.status === "OK"
                                    ? "bg-green-500/10"
                                    : ck.status === "ALERTA"
                                      ? "bg-amber-500/10"
                                      : "bg-red-500/10"
                                }`}
                              >
                                {ck.status === "OK" ? (
                                  <CheckSquare className="w-5 h-5 text-green-500" />
                                ) : ck.status === "ALERTA" ? (
                                  <AlertCircle className="w-5 h-5 text-amber-500" />
                                ) : (
                                  <AlertCircle className="w-5 h-5 text-red-500" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0 space-y-2">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <p className="font-semibold text-sm text-foreground">
                                    {ck.item}
                                  </p>
                                  <Badge
                                    variant="outline"
                                    className={`w-fit text-xs font-medium ${
                                      ck.status === "OK"
                                        ? "border-green-500/50 text-green-600 bg-green-500/10"
                                        : ck.status === "ALERTA"
                                          ? "border-amber-500/50 text-amber-600 bg-amber-500/10"
                                          : "border-red-500/50 text-red-600 bg-red-500/10"
                                    }`}
                                  >
                                    {ck.status}
                                  </Badge>
                                </div>
                                {ck.observacao && (
                                  <div className="bg-muted/50 p-3 rounded-lg">
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                      {ck.observacao}
                                    </p>
                                  </div>
                                )}
                                {ck.imagens.length > 0 && (
                                  <div className="flex gap-2 overflow-x-auto pb-1 pt-1">
                                    {ck.imagens.map((img) => (
                                      <a
                                        key={img.id}
                                        href={img.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block border-2 border-transparent hover:border-primary rounded-lg overflow-hidden w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 transition-all hover:scale-105"
                                      >
                                        <img
                                          src={img.url || "/placeholder.svg"}
                                          alt={img.descricao || "Vistoria"}
                                          className="w-full h-full object-cover"
                                        />
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
