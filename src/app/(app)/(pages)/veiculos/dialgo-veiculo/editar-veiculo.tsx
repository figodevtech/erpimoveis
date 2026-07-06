"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Car,
  Check,
  ChevronDown,
  ChevronsUpDown,
  ClipboardList,
  Loader2,
  Search,
} from "lucide-react";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import axios, { isAxiosError } from "axios";
import { toast } from "sonner";
import { Veiculo, Veiculo_tipos } from "../types";
import { cn } from "@/lib/utils";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import { useFipe } from "./useFipe";
import ValueInput from "../../(financeiro)/fluxodecaixa/components/transactionDialog/valueInput";

function somenteAlphaNumMaiusculo(valor: string) {
  return valor.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatarPlacaParaExibicao(valorSemFormatacao: string) {
  const v = somenteAlphaNumMaiusculo(valorSemFormatacao).slice(0, 7);
  if (v.length <= 3) return v;
  return `${v.slice(0, 3)}-${v.slice(3)}`;
}

function normalizarTextoBusca(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function marcaCompativel(nomeFipe: string, marca: string) {
  const fipe = normalizarTextoBusca(nomeFipe);
  const alvo = normalizarTextoBusca(marca);
  if (!alvo) return false;
  if (fipe === alvo) return true;
  if (
    (alvo === "VW" || alvo === "VOLKSWAGEN") &&
    (fipe.includes("VW") || fipe.includes("VOLKSWAGEN"))
  )
    return true;
  if (
    (alvo === "GM" || alvo === "CHEVROLET") &&
    (fipe.includes("GM") || fipe.includes("CHEVROLET"))
  )
    return true;
  if (
    (alvo === "M BENZ" || alvo === "MERCEDES BENZ") &&
    fipe.includes("MERCEDES")
  )
    return true;
  return fipe.split(" ").includes(alvo);
}

function encontrarMarcaFipe<T extends { name: string; code: string }>(
  marcas: T[],
  marca?: string,
) {
  if (!marca) return undefined;
  return marcas.find((m) => marcaCompativel(m.name, marca));
}

interface GetVeiculoResponse {
  veiculo: Veiculo & {
    cliente?: { id: number; cpfcnpj: string; nomerazaosocial: string };
    placa_formatada?: string;
  };
}

interface EditContentProps {
  veiculoId?: number;
  isOpen: boolean;
  onUpdated?: (v: Veiculo) => void;
}

const handleCombustivelFromAno = (anoStr: string) => {
  const s = anoStr.toUpperCase();
  if (s.includes("GASOLINA")) return "GASOLINA";
  if (s.includes("ALCOOL") || s.includes("ETANOL")) return "ETANOL";
  if (s.includes("DIESEL")) return "DIESEL";
  if (s.includes("ELETRICO") || s.includes("ELÉTRICO")) return "ELETRICO";
  if (s.includes("HIBRIDO") || s.includes("HÍBRIDO")) return "HIBRIDO";
  if (s.includes("FLEX")) return "FLEX";
  return null;
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
  const formatted =
    status.charAt(0).toUpperCase() +
    status.slice(1).toLowerCase().replace(/_/g, " ");

  switch (upper) {
    case "ORCAMENTO":
      return (
        <Badge
          variant="outline"
          className="border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-400"
        >
          Orçamento
        </Badge>
      );
    case "ABERTA":
    case "EM_ANDAMENTO":
      return (
        <Badge
          variant="outline"
          className="border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400"
        >
          Aberta
        </Badge>
      );
    case "PENDENTE":
    case "APROVACAO_ORCAMENTO":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        >
          Pendente
        </Badge>
      );
    case "CONCLUIDO":
    case "FINALIZADA":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        >
          Finalizada
        </Badge>
      );
    case "CANCELADO":
    case "CANCELADA":
      return (
        <Badge
          variant="outline"
          className="border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
        >
          Cancelada
        </Badge>
      );
    case "SEM_COBRANCA":
      return (
        <Badge
          variant="outline"
          className="border-gray-500/20 bg-gray-500/10 text-gray-700 dark:text-gray-400"
        >
          Sem Cobrança
        </Badge>
      );
    default:
      return <Badge variant="outline">{formatted}</Badge>;
  }
};

export default function EditContent({
  veiculoId,
  isOpen,
  onUpdated,
}: EditContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingVeiculo, setIsLoadingVeiculo] = useState(false);
  const [loadingPlaca, setLoadingPlaca] = useState(false);

  const [openCustomer, setOpenCustomer] = useState(false);
  const [openMarca, setOpenMarca] = useState(false);
  const [openModelo, setOpenModelo] = useState(false);
  const [openVersao, setOpenVersao] = useState(false);
  const [currentTab, setCurrentTab] = useState("Geral");
  const [expandedOrdemId, setExpandedOrdemId] = useState<number | null>(null);

  const [selectedVeiculo, setSelectedVeiculo] = useState<
    (Veiculo & { marcaId?: number }) | undefined
  >(undefined);

  const {
    marcasFipe,
    modelosRaw,
    anosFipe,
    loadingMarcas,
    loadingModelos,
    loadingAnos,
    loadingPrice,
    fetchBrands,
    fetchModels,
    fetchYears,
    fetchYearsByBrand,
    fetchModelsByBrandAndYear,
    fetchPrice,
    setModelosRaw,
    setAnosFipe,
  } = useFipe();

  const handleInputChange = (field: keyof Veiculo, value: any) => {
    setSelectedVeiculo((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value };
    });
  };

  const handleBuscarPlaca = async () => {
    if (!selectedVeiculo?.placa || selectedVeiculo.placa.length < 7) return;
    if (!selectedVeiculo.tipo) {
      toast.warning("Selecione o tipo de veículo", {
        description:
          "É obrigatório escolher um tipo antes de consultar a placa.",
      });
      return;
    }

    setLoadingPlaca(true);
    const toastId = toast.loading("Consultando placa...");
    try {
      const response = await axios.get(
        `/api/veiculos/consulta-placa/${selectedVeiculo.placa}`,
      );
      const data = response.data;

      let combustivelRaw = "";
      if (typeof data.extra?.combustivel === "string") {
        combustivelRaw = data.extra.combustivel;
      } else if (
        data.extra?.combustivel &&
        typeof data.extra.combustivel === "object"
      ) {
        combustivelRaw =
          data.extra.combustivel.descricao || data.extra.combustivel.nome || "";
      }

      let combustivelMapped = combustivelRaw || "";
      if (
        combustivelMapped.toUpperCase().includes("FLEX") ||
        combustivelMapped.toUpperCase().includes("ALCOOL / GASOLINA")
      )
        combustivelMapped = "FLEX";
      else if (combustivelMapped.toUpperCase().includes("GASOLINA"))
        combustivelMapped = "GASOLINA";
      else if (
        combustivelMapped.toUpperCase().includes("ALCOOL") ||
        combustivelMapped.toUpperCase().includes("ETANOL")
      )
        combustivelMapped = "ETANOL";
      else if (combustivelMapped.toUpperCase().includes("DIESEL"))
        combustivelMapped = "DIESEL";
      else if (
        combustivelMapped.toUpperCase().includes("HIBRIDO") ||
        combustivelMapped.toUpperCase().includes("HÍBRIDO")
      )
        combustivelMapped = "HIBRIDO";
      else if (
        combustivelMapped.toUpperCase().includes("ELETRICO") ||
        combustivelMapped.toUpperCase().includes("ELÉTRICO")
      )
        combustivelMapped = "ELETRICO";

      const rawMarca = data.MARCA || data.marca || "";
      let cleanedMarca = rawMarca.toUpperCase();
      if (cleanedMarca.includes(" - "))
        cleanedMarca = cleanedMarca.split(" - ")[1];
      if (cleanedMarca.includes("/")) cleanedMarca = cleanedMarca.split("/")[0];
      cleanedMarca = cleanedMarca.trim();
      const marcaFipe = encontrarMarcaFipe(marcasFipe, cleanedMarca);

      const rawModelo = data.SUBMODELO || data.MODELO || data.modelo || "";
      const cleanedModelo = rawModelo.split(" ")[0].toUpperCase().trim();

      const anoFabricacao = data.ano || data.extra?.ano_fabricacao || "";
      const anoModelo = data.anoModelo || data.extra?.ano_modelo || "";
      const marcaSelecionada =
        marcaFipe?.name.toUpperCase() || cleanedMarca || selectedVeiculo.marca;
      const anoModeloNumero = anoModelo
        ? parseInt(String(anoModelo))
        : selectedVeiculo.ano_modelo;

      setSelectedVeiculo((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          marca: marcaSelecionada,
          modelo: cleanedModelo || prev.modelo,
          versao: undefined,
          ano: anoFabricacao ? parseInt(String(anoFabricacao)) : prev.ano,
          ano_modelo: anoModeloNumero,
          chassi: data.extra?.chassi || data.chassi || prev.chassi,
          cor: data.cor?.toUpperCase() || prev.cor,
          combustivel: combustivelMapped || "",
          fipe: undefined,
        };
      });
      setModelosRaw([]);
      setAnosFipe([]);
      const marcaParaBusca =
        marcaFipe || encontrarMarcaFipe(marcasFipe, marcaSelecionada);
      if (selectedVeiculo.tipo && marcaParaBusca) {
        await Promise.all([
          fetchModels(String(selectedVeiculo.tipo), marcaParaBusca.code),
          fetchYearsByBrand(String(selectedVeiculo.tipo), marcaParaBusca.code),
        ]);
      }

      toast.success("Placa consultada", {
        id: toastId,
        description: "Dados do veículo preenchidos.",
      });
    } catch (error: any) {
      console.error(error);
      const msg = error.response?.data?.error || "Erro ao consultar a placa.";
      toast.error("Erro na consulta", { id: toastId, description: msg });
    } finally {
      setLoadingPlaca(false);
    }
  };

  const handleGetVeiculo = async () => {
    if (!veiculoId) return;

    setIsLoadingVeiculo(true);
    try {
      const response = await axios.get<GetVeiculoResponse>(
        `/api/veiculos/${veiculoId}`,
      );
      if (response.status === 200) {
        const v = response.data.veiculo;
        const placaNormalizada = somenteAlphaNumMaiusculo(
          String(v.placa ?? ""),
        ).slice(0, 7);

        setSelectedVeiculo({
          ...v,
          placa: placaNormalizada,
        });
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? "Falha ao buscar veículo",
        });
      }
    } finally {
      setIsLoadingVeiculo(false);
    }
  };

  const handleUpdateVeiculo = async () => {
    if (!selectedVeiculo?.id) return;
    if (!selectedVeiculo.tipo) {
      toast.warning("Selecione o tipo de veículo", {
        description:
          "É obrigatório escolher um tipo antes de salvar o veículo.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await axios.put(`/api/veiculos/${selectedVeiculo.id}`, {
        selectedVeiculo,
      });

      if (response.status === 200) {
        toast.success("Sucesso!", {
          description: "Veículo atualizado.",
          duration: 2000,
        });

        handleGetVeiculo();
        onUpdated?.(selectedVeiculo);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description:
            error.response?.data?.error ?? "Falha ao atualizar veículo",
          duration: 2000,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1) Quando abrir, buscar veículo
  useEffect(() => {
    if (isOpen && veiculoId) handleGetVeiculo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, veiculoId]);

  // FIPE Cascade for Editing
  // Fetch Brands when Tipo is available
  useEffect(() => {
    if (isOpen && selectedVeiculo?.tipo) {
      fetchBrands(String(selectedVeiculo.tipo));
    }
  }, [isOpen, selectedVeiculo?.tipo, fetchBrands]);

  // Fetch both generic models and years when Marca is selected (supports both flows)
  useEffect(() => {
    if (isOpen && selectedVeiculo?.tipo && selectedVeiculo?.marca) {
      const m = encontrarMarcaFipe(marcasFipe, selectedVeiculo.marca);
      if (m) {
        // Without fuel, a plate-provided model year is only a hint.
        if (!selectedVeiculo.ano_modelo || !selectedVeiculo.combustivel) {
          fetchModels(String(selectedVeiculo.tipo), m.code);
        }
        // Always refresh years for the selected brand to avoid stale options.
        fetchYearsByBrand(String(selectedVeiculo.tipo), m.code);
      }
    }
  }, [
    isOpen,
    selectedVeiculo?.tipo,
    selectedVeiculo?.marca,
    marcasFipe,
    fetchModels,
    fetchYearsByBrand,
  ]);

  const selectedYearCode = useMemo(() => {
    if (!selectedVeiculo?.ano_modelo || !selectedVeiculo?.combustivel)
      return undefined;
    return anosFipe.find((a) => {
      const anoMatch = a.name.match(/\d+/);
      const aAno = anoMatch ? Number(anoMatch[0]) : null;
      const aCombustivel = handleCombustivelFromAno(a.name);
      return (
        aAno === selectedVeiculo?.ano_modelo &&
        (!selectedVeiculo?.combustivel ||
          aCombustivel === selectedVeiculo.combustivel)
      );
    })?.code;
  }, [anosFipe, selectedVeiculo?.ano_modelo, selectedVeiculo?.combustivel]);

  // Flow 2: Fetch specific models when Ano is selected
  useEffect(() => {
    if (
      isOpen &&
      selectedVeiculo?.tipo &&
      selectedVeiculo?.marca &&
      selectedVeiculo?.ano_modelo &&
      selectedYearCode
    ) {
      const m = encontrarMarcaFipe(marcasFipe, selectedVeiculo.marca);
      if (m) {
        fetchModelsByBrandAndYear(
          String(selectedVeiculo.tipo),
          m.code,
          selectedYearCode,
        );
      }
    }
  }, [
    isOpen,
    selectedVeiculo?.tipo,
    selectedVeiculo?.marca,
    selectedVeiculo?.ano_modelo,
    selectedYearCode,
    marcasFipe,
    fetchModelsByBrandAndYear,
  ]);

  const extractModeloBase = (name: string) =>
    name.trim().split(" ")[0].toUpperCase();

  const modelosOptions = useMemo(
    () =>
      Array.from(
        new Set(modelosRaw.map((m) => extractModeloBase(m.name))),
      ).sort(),
    [modelosRaw],
  );

  const versoesOptions = useMemo(
    () =>
      modelosRaw
        .filter(
          (m) =>
            selectedVeiculo?.modelo &&
            (m.name
              .toUpperCase()
              .startsWith(selectedVeiculo.modelo.toUpperCase() + " ") ||
              m.name.toUpperCase() === selectedVeiculo.modelo.toUpperCase()),
        )
        .map((m) => {
          let v = m.name.substring(selectedVeiculo!.modelo!.length).trim();
          if (!v) v = "Standard";
          return { code: m.code, name: v.toUpperCase(), originalName: m.name };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [modelosRaw, selectedVeiculo?.modelo],
  );

  // Cleanup: Clear modelo and versao if they are no longer valid after a list update (e.g., brand or year change)
  useEffect(() => {
    if (
      isOpen &&
      selectedVeiculo?.modelo &&
      !loadingModelos &&
      modelosOptions.length > 0
    ) {
      if (!modelosOptions.includes(selectedVeiculo.modelo.toUpperCase())) {
        setSelectedVeiculo((prev) =>
          prev ? { ...prev, modelo: "", versao: "", fipe: undefined } : prev,
        );
      }
    }
  }, [
    isOpen,
    modelosOptions,
    loadingModelos,
    selectedVeiculo?.modelo,
    selectedVeiculo,
    setSelectedVeiculo,
  ]);

  const selectedVersaoCode = useMemo(() => {
    return versoesOptions.find(
      (v) => v.name === selectedVeiculo?.versao?.toUpperCase(),
    )?.code;
  }, [versoesOptions, selectedVeiculo?.versao]);

  // Flow 1: Fetch specific years when Versao is selected
  useEffect(() => {
    if (
      isOpen &&
      selectedVeiculo?.tipo &&
      selectedVeiculo?.marca &&
      selectedVeiculo?.modelo &&
      selectedVeiculo?.versao &&
      selectedVersaoCode
    ) {
      const m = encontrarMarcaFipe(marcasFipe, selectedVeiculo.marca);
      if (m) {
        fetchYears(String(selectedVeiculo.tipo), m.code, selectedVersaoCode);
      }
    }
  }, [
    isOpen,
    selectedVeiculo?.tipo,
    selectedVeiculo?.marca,
    selectedVeiculo?.modelo,
    selectedVeiculo?.versao,
    marcasFipe,
    selectedVersaoCode,
    fetchYears,
  ]);

  const isOffline =
    !!selectedVeiculo?.tipo && !loadingMarcas && marcasFipe.length === 0;

  const handleBuscarFipe = async () => {
    if (
      !selectedVeiculo?.ano_modelo ||
      !selectedVeiculo?.tipo ||
      !selectedVeiculo?.marca ||
      !selectedVeiculo?.versao ||
      !selectedVeiculo?.modelo
    )
      return;
    if (!selectedVeiculo.combustivel) {
      toast.error("Dados incompletos", {
        description: "Selecione o ano/combustivel FIPE correspondente.",
      });
      return;
    }
    const m = encontrarMarcaFipe(marcasFipe, selectedVeiculo.marca);
    const selectedVersao = versoesOptions.find(
      (v) => v.name === selectedVeiculo.versao?.toUpperCase(),
    );

    const y = anosFipe.find((a) => {
      const anoMatch = a.name.match(/\d+/);
      const aAno = anoMatch ? Number(anoMatch[0]) : null;
      const aCombustivel = handleCombustivelFromAno(a.name);
      return (
        aAno === selectedVeiculo.ano_modelo &&
        (!selectedVeiculo.combustivel ||
          aCombustivel === selectedVeiculo.combustivel)
      );
    });

    if (m && selectedVersao && y) {
      const data = await fetchPrice(
        String(selectedVeiculo.tipo),
        m.code,
        selectedVersao.code,
        y.code,
      );
      if (data && data.price) {
        const num = Number(data.price.replace(/[^\d,]/g, "").replace(",", "."));
        if (!isNaN(num)) handleInputChange("fipe", num);
      } else {
        toast.error("Erro na busca", {
          description: "Não foi possível resgatar o valor FIPE.",
        });
      }
    } else {
      toast.error("Dados incompletos", {
        description: "Selecione o ano FIPE correspondente.",
      });
    }
  };

  const disabledForm = isLoadingVeiculo || !selectedVeiculo;
  const tabTheme =
    " group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

  if (isLoadingVeiculo) {
    return (
      <DialogContent className="h-dvh min-w-screen p-0 overflow-hidden sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0">
        <DialogHeader className="hidden">
          <DialogTitle></DialogTitle>
        </DialogHeader>
        <div className="flex h-full min-h-0 flex-col justify-center items-center">
          <div className="size-8 border-t-2 border-primary rounded-t-full animate-spin"></div>
          <span className="text-primary">Carregando</span>
        </div>
      </DialogContent>
    );
  }

  if (selectedVeiculo) {
    return (
      <DialogContent className="h-svh w-screen max-w-none p-0 overflow-hidden sm:max-h-[850px] sm:w-[95vw] sm:max-w-[1100px] sm:min-w-0">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
            <DialogTitle className="text-sm sm:text-lg">
              Veículo #{selectedVeiculo?.id ?? "-"}
              <span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">
                | Edição
              </span>
            </DialogTitle>
            <DialogDescription>Atualize os dados do veículo</DialogDescription>
          </DialogHeader>
          <CustomerSelect
            open={openCustomer}
            setOpen={setOpenCustomer}
            OnSelect={(c) =>
              setSelectedVeiculo({
                ...selectedVeiculo,
                clienteid: c.id,
                cliente: c,
              })
            }
          />

          <Tabs
            value={currentTab}
            defaultValue="Geral"
            className="mt-4 flex-1 min-h-0 min-w-0 overflow-hidden"
          >
            <div className="sticky top-0 z-10 shrink-0">
              <div className="overflow-x-auto overflow-y-hidden px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none]">
                <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                  <TabsTrigger
                    onClick={() => setCurrentTab("Geral")}
                    value="Geral"
                    className={"hover:cursor-pointer " + tabTheme}
                  >
                    <span className="flex items-center gap-2">
                      <Car className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Geral
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    onClick={() => setCurrentTab("Ordens")}
                    value="Ordens"
                    className={"hover:cursor-pointer " + tabTheme}
                  >
                    <span className="flex items-center gap-2">
                      <ClipboardList className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                      Ordens
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>
            <TabsContent
              value="Geral"
              className="h-full min-h-0 overflow-hidden p-0 b"
            >
              <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                {/* Tipo */}
                <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="tipo" className="text-sm">
                        Tipo de Veículo *
                      </Label>
                      <Select
                        value={
                          (selectedVeiculo?.tipo as unknown as string) || ""
                        }
                        onValueChange={(value: Veiculo_tipos) => {
                          setSelectedVeiculo((prev) => {
                            if (!prev) return prev;
                            return {
                              ...prev,
                              tipo: value as any,
                              marca: "",
                              modelo: "",
                              versao: "",
                              ano_modelo: undefined,
                              fipe: undefined,
                              combustivel: "",
                              marcaId: undefined,
                            };
                          });
                          setModelosRaw([]);
                          setAnosFipe([]);
                        }}
                        disabled={disabledForm}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                        <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                          {Object.keys(Veiculo_tipos).map((tipo, i) => (
                            <SelectItem
                              className="hover:cursor-pointer"
                              key={i}
                              value={tipo}
                            >
                              {tipo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="placa" className="text-sm">
                        Placa *
                      </Label>
                      <div className="relative">
                        <Input
                          id="placa"
                          className="w-full pr-9 uppercase"
                          value={formatarPlacaParaExibicao(
                            selectedVeiculo?.placa || "",
                          )}
                          onChange={(e) => {
                            const digitado = e.target.value;
                            const semHifen = somenteAlphaNumMaiusculo(
                              digitado,
                            ).slice(0, 7);
                            setSelectedVeiculo((prev) =>
                              prev ? { ...prev, placa: semHifen } : prev,
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (
                                !disabledForm &&
                                !loadingPlaca &&
                                selectedVeiculo?.placa &&
                                selectedVeiculo.placa.length >= 7
                              ) {
                                handleBuscarPlaca();
                              }
                            }
                          }}
                          maxLength={8}
                          placeholder="ABC-1D23"
                          autoCapitalize="characters"
                          disabled={disabledForm}
                        />
                        <Button
                          variant="ghost"
                          type="button"
                          size="icon"
                          onClick={handleBuscarPlaca}
                          disabled={
                            disabledForm ||
                            loadingPlaca ||
                            !selectedVeiculo?.placa ||
                            selectedVeiculo.placa.length < 7
                          }
                          title="Buscar dados da Placa"
                          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="cliente" className="text-sm">
                        Cliente proprietário
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-full"
                          value={
                            selectedVeiculo?.cliente?.nomerazaosocial ||
                            "Selecione"
                          }
                          disabled={true}
                        />
                        <div
                          onClick={() => setOpenCustomer(true)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background hover:cursor-pointer hover:bg-muted"
                        >
                          <Search className="w-4 h-4 text-primary" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
                    {/* Marca */}
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="marca" className="text-sm">
                        Marca *
                      </Label>
                      {isOffline ? (
                        <Input
                          id="marca"
                          value={selectedVeiculo?.marca || ""}
                          onChange={(e) => {
                            setSelectedVeiculo((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                marca: e.target.value.toUpperCase(),
                                modelo: "",
                                versao: "",
                                ano_modelo: undefined,
                                fipe: undefined,
                                combustivel: "",
                              };
                            });
                            setModelosRaw([]);
                            setAnosFipe([]);
                          }}
                          disabled={disabledForm}
                          placeholder="Ex.: CHEVROLET"
                        />
                      ) : (
                        <Popover open={openMarca} onOpenChange={setOpenMarca}>
                          <PopoverTrigger asChild>
                            <Button
                              id="marca"
                              variant="outline"
                              role="combobox"
                              aria-expanded={openMarca}
                              className="h-9 w-full justify-between text-sm"
                              disabled={
                                disabledForm ||
                                loadingMarcas ||
                                !selectedVeiculo?.tipo
                              }
                            >
                              {loadingMarcas
                                ? "Carregando..."
                                : selectedVeiculo?.marca
                                  ? selectedVeiculo.marca
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
                                placeholder="Buscar marca..."
                                className="h-9 text-base"
                              />
                              <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
                                <CommandEmpty>
                                  Nenhuma marca encontrada.
                                </CommandEmpty>
                                <CommandGroup>
                                  {marcasFipe.map((m) => (
                                    <CommandItem
                                      className="hover:cursor-pointer"
                                      key={m.code}
                                      value={m.name}
                                      onSelect={() => {
                                        setSelectedVeiculo((prev) => {
                                          if (!prev) return prev;
                                          return {
                                            ...prev,
                                            marca: m.name.toUpperCase(),
                                            modelo: "",
                                            versao: "",
                                            ano_modelo: undefined,
                                            fipe: undefined,
                                            combustivel: "",
                                          };
                                        });
                                        setModelosRaw([]);
                                        setAnosFipe([]);
                                        setOpenMarca(false);
                                      }}
                                    >
                                      {m.name.toUpperCase()}
                                      <Check
                                        className={cn(
                                          "ml-auto",
                                          selectedVeiculo?.marca ===
                                            m.name.toUpperCase()
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
                    </div>

                    {/* Modelo */}
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="modelo" className="text-sm">
                        Modelo *
                      </Label>
                      {isOffline ? (
                        <Input
                          id="modelo"
                          value={selectedVeiculo?.modelo || ""}
                          onChange={(e) => {
                            setSelectedVeiculo((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    modelo: e.target.value.toUpperCase(),
                                    versao: "",
                                    ano_modelo: undefined,
                                    fipe: undefined,
                                    combustivel: "",
                                  }
                                : prev,
                            );
                          }}
                          disabled={disabledForm}
                          placeholder="Ex.: ONIX"
                        />
                      ) : (
                        <Popover open={openModelo} onOpenChange={setOpenModelo}>
                          <PopoverTrigger asChild>
                            <Button
                              id="modelo"
                              variant="outline"
                              role="combobox"
                              aria-expanded={openModelo}
                              className="h-9 w-full justify-between text-sm"
                              disabled={
                                disabledForm ||
                                loadingModelos ||
                                !selectedVeiculo?.tipo ||
                                !selectedVeiculo?.marca
                              }
                            >
                              {loadingModelos
                                ? "Carregando..."
                                : selectedVeiculo?.modelo
                                  ? selectedVeiculo.modelo
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
                                placeholder="Buscar modelo..."
                                className="h-9 text-base"
                              />
                              <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
                                <CommandEmpty>
                                  Nenhum modelo encontrado.
                                </CommandEmpty>
                                <CommandGroup>
                                  {modelosOptions.map((m, i) => (
                                    <CommandItem
                                      className="hover:cursor-pointer text-sm"
                                      key={i}
                                      value={m}
                                      onSelect={() => {
                                        setSelectedVeiculo((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                modelo: m.toUpperCase(),
                                                versao: "",
                                                fipe: undefined,
                                              }
                                            : prev,
                                        );
                                        setOpenModelo(false);
                                      }}
                                    >
                                      {m.toUpperCase()}
                                      <Check
                                        className={cn(
                                          "ml-auto",
                                          selectedVeiculo?.modelo ===
                                            m.toUpperCase()
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
                    </div>

                    {/* Versão */}
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="versao" className="text-sm">
                        Versão
                      </Label>
                      {isOffline ? (
                        <Input
                          id="versao"
                          value={selectedVeiculo?.versao || ""}
                          onChange={(e) => {
                            setSelectedVeiculo((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    versao: e.target.value.toUpperCase(),
                                    ano_modelo: undefined,
                                    fipe: undefined,
                                    combustivel: "",
                                  }
                                : prev,
                            );
                          }}
                          disabled={disabledForm}
                          placeholder="Ex.: 1.0 MT"
                        />
                      ) : (
                        <Popover open={openVersao} onOpenChange={setOpenVersao}>
                          <PopoverTrigger asChild>
                            <Button
                              id="versao"
                              variant="outline"
                              role="combobox"
                              aria-expanded={openVersao}
                              className="h-9 w-full justify-between truncate text-sm"
                              disabled={
                                disabledForm ||
                                !selectedVeiculo?.modelo ||
                                modelosRaw.length === 0
                              }
                            >
                              {selectedVeiculo?.versao
                                ? selectedVeiculo.versao
                                : "Selecione..."}
                              <ChevronsUpDown className="opacity-50 shrink-0" />
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
                                placeholder="Buscar versão..."
                                className="h-9 text-base"
                              />
                              <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
                                <CommandEmpty>
                                  Nenhuma versão encontrada.
                                </CommandEmpty>
                                <CommandGroup>
                                  {versoesOptions.map((v, i) => (
                                    <CommandItem
                                      className="hover:cursor-pointer text-sm"
                                      key={i}
                                      value={v.name}
                                      onSelect={() => {
                                        setSelectedVeiculo((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                versao: v.name.toUpperCase(),
                                                fipe: undefined,
                                              }
                                            : prev,
                                        );
                                        setOpenVersao(false);
                                      }}
                                    >
                                      {v.name.toUpperCase()}
                                      <Check
                                        className={cn(
                                          "ml-auto",
                                          selectedVeiculo?.versao ===
                                            v.name.toUpperCase()
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
                    </div>

                    {/* Ano */}
                    <div className="space-y-2">
                      <Label htmlFor="ano" className="text-sm">
                        Ano de Fabricação
                      </Label>
                      <Input
                        id="ano"
                        inputMode="numeric"
                        className="w-full"
                        maxLength={4}
                        value={
                          selectedVeiculo?.ano
                            ? String(selectedVeiculo.ano)
                            : ""
                        }
                        onChange={(e) =>
                          handleInputChange("ano", e.target.value)
                        }
                        placeholder="Ex.: 2019"
                        disabled={disabledForm}
                      />
                    </div>

                    {/* Ano Modelo */}
                    <div className="space-y-2">
                      <Label htmlFor="ano_modelo" className="text-sm">
                        Ano Modelo
                      </Label>
                      {isOffline ? (
                        <Input
                          id="ano_modelo"
                          type="number"
                          inputMode="numeric"
                          maxLength={4}
                          value={
                            selectedVeiculo?.ano_modelo
                              ? String(selectedVeiculo.ano_modelo)
                              : ""
                          }
                          onChange={(e) =>
                            handleInputChange(
                              "ano_modelo",
                              parseInt(e.target.value) || null,
                            )
                          }
                          placeholder="Ex.: 2020"
                          disabled={disabledForm}
                        />
                      ) : (
                        <Select
                          value={
                            selectedVeiculo?.ano_modelo &&
                            selectedVeiculo?.combustivel
                              ? anosFipe.find((a) => {
                                  const anoMatch = a.name.match(/\d+/);
                                  const aAno = anoMatch
                                    ? Number(anoMatch[0])
                                    : null;
                                  const aCombustivel = handleCombustivelFromAno(
                                    a.name,
                                  );
                                  return (
                                    aAno === selectedVeiculo.ano_modelo &&
                                    aCombustivel === selectedVeiculo.combustivel
                                  );
                                })?.code || ""
                              : ""
                          }
                          onValueChange={(code) => {
                            const y = anosFipe.find((a) => a.code === code);
                            if (y) {
                              const anoMatch = y.name.match(/\d+/);
                              const ano = anoMatch ? Number(anoMatch[0]) : null;
                              const combustivel = handleCombustivelFromAno(
                                y.name,
                              );
                              setSelectedVeiculo((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      ano_modelo: ano || undefined,
                                      combustivel:
                                        combustivel || prev.combustivel,
                                      fipe: undefined,
                                    }
                                  : prev,
                              );
                            }
                          }}
                          disabled={
                            disabledForm ||
                            loadingAnos ||
                            !selectedVeiculo?.marca ||
                            anosFipe.length === 0
                          }
                        >
                          <SelectTrigger className="h-9 w-full" id="ano_modelo">
                            <SelectValue
                              placeholder={
                                loadingAnos ? "Buscando..." : "Selecione"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                            {anosFipe.map((a) => {
                              let displayName = a.name;
                              if (displayName.includes("32000")) {
                                displayName = displayName.replace(
                                  "32000",
                                  "Zero KM",
                                );
                              }
                              return (
                                <SelectItem key={a.code} value={a.code}>
                                  {displayName}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    {/* KM atual */}
                    <div className="space-y-2">
                      <Label htmlFor="kmatual" className="text-sm">
                        KM atual
                      </Label>
                      <Input
                        className="w-full"
                        id="kmatual"
                        inputMode="numeric"
                        value={
                          selectedVeiculo?.kmatual
                            ? String(selectedVeiculo.kmatual)
                            : ""
                        }
                        onChange={(e) =>
                          handleInputChange("kmatual", e.target.value)
                        }
                        placeholder="Ex.: 85000"
                        disabled={disabledForm}
                      />
                    </div>

                    {/* Chassi */}
                    <div className="space-y-2">
                      <Label htmlFor="chassi" className="text-sm">
                        Chassi
                      </Label>
                      <Input
                        className="w-full"
                        id="chassi"
                        value={selectedVeiculo?.chassi || ""}
                        onChange={(e) =>
                          handleInputChange(
                            "chassi",
                            e.target.value.toUpperCase(),
                          )
                        }
                        placeholder="Ex.: 9BW..."
                        disabled={disabledForm}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                    {/* Combustível */}
                    <div className="space-y-2">
                      <Label htmlFor="combustivel" className="text-sm">
                        Combustível
                      </Label>
                      <Select
                        value={selectedVeiculo?.combustivel || ""}
                        onValueChange={(value) =>
                          handleInputChange("combustivel", value)
                        }
                        disabled={disabledForm}
                      >
                        <SelectTrigger className="h-9 w-full" id="combustivel">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                          <SelectItem value="FLEX">FLEX</SelectItem>
                          <SelectItem value="GASOLINA">GASOLINA</SelectItem>
                          <SelectItem value="ETANOL">ETANOL</SelectItem>
                          <SelectItem value="DIESEL">DIESEL</SelectItem>
                          <SelectItem value="GNV">GNV</SelectItem>
                          <SelectItem value="ELETRICO">ELÉTRICO</SelectItem>
                          <SelectItem value="HIBRIDO">HÍBRIDO</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Transmissão */}
                    <div className="space-y-2">
                      <Label htmlFor="transmissao" className="text-sm">
                        Transmissão
                      </Label>
                      <Select
                        value={selectedVeiculo?.transmissao || ""}
                        onValueChange={(value) =>
                          handleInputChange("transmissao", value)
                        }
                        disabled={disabledForm}
                      >
                        <SelectTrigger className="h-9 w-full" id="transmissao">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                          <SelectItem value="MANUAL">MANUAL</SelectItem>
                          <SelectItem value="AUTOMATICA">AUTOMÁTICA</SelectItem>
                          <SelectItem value="AUTOMATIZADA">
                            AUTOMATIZADA
                          </SelectItem>
                          <SelectItem value="CVT">CVT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* FIPE */}
                    <div className="col-span-2 space-y-2 lg:col-span-1">
                      <Label htmlFor="fipe" className="text-sm">
                        FIPE (R$)
                      </Label>
                      <div className="flex gap-2">
                        <ValueInput
                          price={selectedVeiculo?.fipe || 0}
                          setPrice={(value: number) =>
                            handleInputChange("fipe", value)
                          }
                        />
                        <Button
                          className="hover:cursor-pointer"
                          variant="secondary"
                          onClick={handleBuscarFipe}
                          disabled={
                            isOffline ||
                            disabledForm ||
                            loadingPrice ||
                            !selectedVeiculo?.ano_modelo ||
                            !selectedVeiculo?.versao
                          }
                        >
                          {loadingPrice ? "Buscando..." : "Buscar"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent
              value="Ordens"
              className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6"
            >
              <div className="min-w-0 max-w-full space-y-4 overflow-hidden">
                <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Ordens de Serviço
                      </h3>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Histórico de ordens de serviço vinculadas a este veículo.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 shadow-sm">
                    <span className="text-xs font-medium text-muted-foreground">
                      Total:
                    </span>
                    <span className="text-sm font-bold">
                      {selectedVeiculo.ordens?.length ?? 0}
                    </span>
                  </div>
                </div>

                <div className="w-full max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border bg-card sm:max-w-full">
                  <div className="max-w-full overflow-x-auto">
                    <Table className="max-w-none text-xs">
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-[80px]">ID</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">
                            Valor Total
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedVeiculo.ordens &&
                        selectedVeiculo.ordens.length > 0 ? (
                          selectedVeiculo.ordens.map((ordem: any) => {
                            const clienteNome =
                              ordem.cliente?.nomerazaosocial ||
                              selectedVeiculo.cliente?.nomerazaosocial ||
                              "Não informado";
                            const dataOrdem =
                              ordem.dataentrada ||
                              ordem.createdat ||
                              ordem.created_at;
                            const produtos = Array.isArray(ordem.produtos)
                              ? ordem.produtos
                              : [];
                            const servicos = Array.isArray(ordem.servicos)
                              ? ordem.servicos
                              : [];
                            const expanded = expandedOrdemId === ordem.id;

                            return (
                              <Fragment key={ordem.id}>
                                <TableRow
                                  className="cursor-pointer transition-colors hover:bg-muted/50"
                                  onClick={() =>
                                    setExpandedOrdemId(
                                      expanded ? null : ordem.id,
                                    )
                                  }
                                >
                                  <TableCell className="font-medium text-muted-foreground">
                                    <span className="inline-flex items-center gap-1.5">
                                      <ChevronDown
                                        className={cn(
                                          "h-3.5 w-3.5 transition-transform",
                                          expanded && "rotate-180",
                                        )}
                                      />
                                      #{ordem.id}
                                    </span>
                                  </TableCell>
                                  <TableCell>{formatDate(dataOrdem)}</TableCell>
                                  <TableCell
                                    className="max-w-[160px] truncate"
                                    title={clienteNome}
                                  >
                                    {clienteNome}
                                  </TableCell>
                                  <TableCell
                                    className="max-w-[220px] truncate"
                                    title={ordem.descricao || ""}
                                  >
                                    {ordem.descricao || "-"}
                                  </TableCell>
                                  <TableCell>
                                    {getStatusBadge(ordem.status)}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {formatCurrency(ordem.orcamentototal || 0)}
                                  </TableCell>
                                </TableRow>
                                {expanded ? (
                                  <TableRow className="bg-muted/20">
                                    <TableCell colSpan={6} className="p-3">
                                      <div className="grid min-w-[700px] grid-cols-2 gap-3">
                                        <div className="rounded-md border bg-background p-3">
                                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Serviços
                                          </p>
                                          {servicos.length > 0 ? (
                                            <div className="space-y-2">
                                              {servicos.map(
                                                (item: any, index: number) => (
                                                  <div
                                                    key={`${ordem.id}-servico-${index}`}
                                                    className="flex items-center justify-between gap-3 text-xs"
                                                  >
                                                    <span
                                                      className="truncate"
                                                      title={
                                                        item.servico
                                                          ?.descricao || ""
                                                      }
                                                    >
                                                      {item.servico
                                                        ?.descricao ||
                                                        "Serviço"}
                                                    </span>
                                                    <span className="shrink-0 font-medium">
                                                      {formatCurrency(
                                                        item.subtotal || 0,
                                                      )}
                                                    </span>
                                                  </div>
                                                ),
                                              )}
                                            </div>
                                          ) : (
                                            <p className="text-xs text-muted-foreground">
                                              Nenhum serviço vinculado.
                                            </p>
                                          )}
                                        </div>

                                        <div className="rounded-md border bg-background p-3">
                                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            Produtos
                                          </p>
                                          {produtos.length > 0 ? (
                                            <div className="space-y-2">
                                              {produtos.map(
                                                (item: any, index: number) => (
                                                  <div
                                                    key={`${ordem.id}-produto-${index}`}
                                                    className="flex items-center justify-between gap-3 text-xs"
                                                  >
                                                    <span
                                                      className="truncate"
                                                      title={
                                                        item.produto?.titulo ||
                                                        ""
                                                      }
                                                    >
                                                      {item.produto?.titulo ||
                                                        "Produto"}
                                                    </span>
                                                    <span className="shrink-0 font-medium">
                                                      {formatCurrency(
                                                        item.subtotal || 0,
                                                      )}
                                                    </span>
                                                  </div>
                                                ),
                                              )}
                                            </div>
                                          ) : (
                                            <p className="text-xs text-muted-foreground">
                                              Nenhum produto vinculado.
                                            </p>
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
                            <TableCell
                              className="h-24 text-center text-muted-foreground"
                              colSpan={7}
                            >
                              <div className="flex flex-col items-center justify-center gap-2">
                                <ClipboardList className="h-8 w-8 opacity-20" />
                                <p>
                                  Veículo não possui histórico de Ordens de
                                  Serviço
                                </p>
                              </div>
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

          <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
            <div className="flex w-full flex-row justify-end gap-2">
              <DialogClose asChild>
                <Button
                  type="button"
                  className="h-9 min-w-24 hover:cursor-pointer"
                  variant="outline"
                >
                  Cancelar
                </Button>
              </DialogClose>
              <Button
                type="button"
                disabled={isSubmitting || disabledForm}
                onClick={handleUpdateVeiculo}
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
          </DialogFooter>
        </div>
      </DialogContent>
    );
  }
}
