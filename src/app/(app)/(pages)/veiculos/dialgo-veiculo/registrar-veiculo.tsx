"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Car, Check, ChevronsUpDown, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import axios, { isAxiosError } from "axios";
import { Veiculo, Veiculo_tipos } from "../types";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import { useFipe } from "./useFipe";
import ValueInput from "../../(financeiro)/fluxodecaixa/components/transactionDialog/valueInput";
import { TabVeiculoImagens } from "./tab-veiculo-imagens";
import type { ProdutoImagemPendente } from "../../estoque/components/dialog-produto/tabs/produto-imagens-gallery";

function somenteAlphaNumMaiusculo(valor: string) {
  return valor.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatarPlacaParaExibicao(valorSemFormatacao: string) {
  const valor = somenteAlphaNumMaiusculo(valorSemFormatacao).slice(0, 7);
  if (valor.length <= 3) return valor;
  return `${valor.slice(0, 3)}-${valor.slice(3)}`;
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

interface RegisterContentProps {
  novoVeiculo: Veiculo;
  setNovoVeiculo: (value: Veiculo) => void;
  setSelectedVeiculoId?: (value: number | undefined) => void;
  onRegister?: (c: Veiculo) => void;
  onCloseAfterRegister?: () => void;
  clienteId?: number;
  isOpen: boolean;
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

export default function RegisterContent({
  novoVeiculo,
  setNovoVeiculo,
  setSelectedVeiculoId,
  onRegister,
  onCloseAfterRegister,
  clienteId,
  isOpen,
}: RegisterContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open1, setOpen1] = useState(false);
  const [open2, setOpen2] = useState(false);
  const [openCustomer, setOpenCustomer] = useState(false);
  const [loadingPlaca, setLoadingPlaca] = useState(false);
  const [currentTab, setCurrentTab] = useState("Geral");
  const [imagensPendentes, setImagensPendentes] = useState<
    ProdutoImagemPendente[]
  >([]);
  const [ordemImagensPendentes, setOrdemImagensPendentes] = useState<string[]>(
    [],
  );
  const [progressoUploadImagens, setProgressoUploadImagens] = useState<
    Record<string, number>
  >({});
  const imagensPendentesRef = useRef<ProdutoImagemPendente[]>([]);
  const ordemImagensPendentesRef = useRef<string[]>([]);

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

  const handleInputChange = (
    field: keyof Veiculo,
    value: string | number | null,
  ) => {
    setNovoVeiculo({ ...novoVeiculo, [field]: value });
  };

  const pendingKey = (id: string) => `pending-${id}`;

  const setOrdemPendentes = useCallback((keys: string[]) => {
    ordemImagensPendentesRef.current = keys;
    setOrdemImagensPendentes(keys);
  }, []);

  const limparImagensSelecionadas = useCallback(() => {
    imagensPendentesRef.current.forEach((img) =>
      URL.revokeObjectURL(img.previewUrl),
    );
    imagensPendentesRef.current = [];
    ordemImagensPendentesRef.current = [];
    setImagensPendentes([]);
    setOrdemImagensPendentes([]);
    setProgressoUploadImagens({});
  }, []);

  const handlePickImages = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const novas = files.map((file) => ({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));

      imagensPendentesRef.current = [...imagensPendentesRef.current, ...novas];
      setImagensPendentes(imagensPendentesRef.current);
      setOrdemPendentes([
        ...ordemImagensPendentesRef.current,
        ...novas.map((img) => pendingKey(img.id)),
      ]);
    },
    [setOrdemPendentes],
  );

  const handleRemoverImagemPendente = useCallback(
    (id: string) => {
      const alvo = imagensPendentesRef.current.find((img) => img.id === id);
      if (alvo) URL.revokeObjectURL(alvo.previewUrl);

      imagensPendentesRef.current = imagensPendentesRef.current.filter(
        (img) => img.id !== id,
      );
      setImagensPendentes(imagensPendentesRef.current);
      setOrdemPendentes(
        ordemImagensPendentesRef.current.filter((key) => key !== pendingKey(id)),
      );
      setProgressoUploadImagens((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
    [setOrdemPendentes],
  );

  const uploadImagensDoVeiculo = useCallback(async (veiculoId: number) => {
    const pendentesPorKey = new Map(
      imagensPendentesRef.current.map((img) => [pendingKey(img.id), img]),
    );
    const ordenadas = ordemImagensPendentesRef.current
      .map((key) => pendentesPorKey.get(key))
      .filter(Boolean) as ProdutoImagemPendente[];

    for (const pending of ordenadas) {
      const formData = new FormData();
      formData.append("files", pending.file);

      await axios.post(`/api/veiculos/${veiculoId}/images`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          const total = event.total ?? pending.file.size;
          const pct =
            total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
          setProgressoUploadImagens((current) => ({
            ...current,
            [pending.id]: pct,
          }));
        },
      });
    }
  }, []);

  const handleBuscarPlaca = async () => {
    if (!novoVeiculo.placa || novoVeiculo.placa.length < 7) return;
    if (!novoVeiculo.tipo) {
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
        `/api/veiculos/consulta-placa/${novoVeiculo.placa}`,
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
        marcaFipe?.name.toUpperCase() || cleanedMarca || novoVeiculo.marca;
      const anoModeloNumero = anoModelo
        ? parseInt(String(anoModelo))
        : novoVeiculo.ano_modelo;

      setNovoVeiculo({
        ...novoVeiculo,
        marca: marcaSelecionada,
        modelo: cleanedModelo || novoVeiculo.modelo,
        versao: undefined,
        ano: anoFabricacao ? parseInt(String(anoFabricacao)) : novoVeiculo.ano,
        ano_modelo: anoModeloNumero,
        chassi: data.extra?.chassi || data.chassi || novoVeiculo.chassi,
        cor: data.cor?.toUpperCase() || novoVeiculo.cor,
        combustivel: combustivelMapped || "",
        fipe: undefined,
      });
      setModelosRaw([]);
      setAnosFipe([]);
      const marcaParaBusca =
        marcaFipe || encontrarMarcaFipe(marcasFipe, marcaSelecionada);
      if (novoVeiculo.tipo && marcaParaBusca) {
        await Promise.all([
          fetchModels(String(novoVeiculo.tipo), marcaParaBusca.code),
          fetchYearsByBrand(String(novoVeiculo.tipo), marcaParaBusca.code),
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

  const handleCreateVeiculo = async () => {
    if (!novoVeiculo.tipo) {
      toast.warning("Selecione o tipo de veículo", {
        description:
          "É obrigatório escolher um tipo antes de salvar o veículo.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await axios.post("/api/veiculos", { novoVeiculo });
      if (response.status === 201) {
        const veiculoCriado = response.data.data as Veiculo;
        if (imagensPendentesRef.current.length > 0 && veiculoCriado.id) {
          await uploadImagensDoVeiculo(veiculoCriado.id);
          limparImagensSelecionadas();
        }

        toast.success("Sucesso!", {
          description: "Veículo cadastrado.",
          duration: 2000,
        });
        if (setSelectedVeiculoId) setSelectedVeiculoId(veiculoCriado.id);
        onRegister?.(veiculoCriado);
        onCloseAfterRegister?.();
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data.error,
          duration: 2000,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (clienteId && novoVeiculo.clienteid !== clienteId) {
      setNovoVeiculo({ ...novoVeiculo, clienteid: clienteId });
    }
  }, [clienteId, novoVeiculo.clienteid, setNovoVeiculo]);

  useEffect(() => {
    return () => {
      limparImagensSelecionadas();
    };
  }, [limparImagensSelecionadas]);

  // FIPE Cascade
  useEffect(() => {
    if (isOpen && novoVeiculo.tipo) {
      fetchBrands(String(novoVeiculo.tipo));
    }
  }, [isOpen, novoVeiculo.tipo, fetchBrands]);

  // Fetch both generic models and years when Marca is selected (supports both flows)
  useEffect(() => {
    if (isOpen && novoVeiculo.tipo && novoVeiculo.marca) {
      const m = encontrarMarcaFipe(marcasFipe, novoVeiculo.marca);
      if (m) {
        // Without fuel, a plate-provided model year is only a hint.
        if (!novoVeiculo.ano_modelo || !novoVeiculo.combustivel) {
          fetchModels(String(novoVeiculo.tipo), m.code);
        }
        // Always refresh years for the selected brand to avoid stale options.
        fetchYearsByBrand(String(novoVeiculo.tipo), m.code);
      }
    }
  }, [
    isOpen,
    novoVeiculo.tipo,
    novoVeiculo.marca,
    marcasFipe,
    fetchModels,
    fetchYearsByBrand,
  ]);

  const selectedYearCode = useMemo(() => {
    if (!novoVeiculo.ano_modelo || !novoVeiculo.combustivel) return undefined;
    return anosFipe.find((a) => {
      const anoMatch = a.name.match(/\d+/);
      const aAno = anoMatch ? Number(anoMatch[0]) : null;
      const aCombustivel = handleCombustivelFromAno(a.name);
      return (
        aAno === novoVeiculo.ano_modelo &&
        (!novoVeiculo.combustivel || aCombustivel === novoVeiculo.combustivel)
      );
    })?.code;
  }, [anosFipe, novoVeiculo.ano_modelo, novoVeiculo.combustivel]);

  // Flow 2: Fetch specific models when Ano is selected
  useEffect(() => {
    if (
      isOpen &&
      novoVeiculo.tipo &&
      novoVeiculo.marca &&
      novoVeiculo.ano_modelo &&
      selectedYearCode
    ) {
      const m = encontrarMarcaFipe(marcasFipe, novoVeiculo.marca);
      if (m) {
        fetchModelsByBrandAndYear(
          String(novoVeiculo.tipo),
          m.code,
          selectedYearCode,
        );
      }
    }
  }, [
    isOpen,
    novoVeiculo.tipo,
    novoVeiculo.marca,
    novoVeiculo.ano_modelo,
    selectedYearCode,
    marcasFipe,
    fetchModelsByBrandAndYear,
  ]);

  const modelosOptions = useMemo(
    () =>
      modelosRaw
        .map((m) => ({ ...m, name: m.name.trim().toUpperCase() }))
        .filter(
          (m, index, items) =>
            items.findIndex((item) => item.code === m.code) === index,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [modelosRaw],
  );

  const versoesOptions = useMemo(
    () =>
      modelosRaw
        .filter(
          (m) =>
            novoVeiculo.modelo &&
            (m.name
              .toUpperCase()
              .startsWith(novoVeiculo.modelo.toUpperCase() + " ") ||
              m.name.toUpperCase() === novoVeiculo.modelo.toUpperCase()),
        )
        .map((m) => {
          let v = m.name.substring(novoVeiculo.modelo!.length).trim();
          if (!v) v = "Standard";
          return { code: m.code, name: v.toUpperCase(), originalName: m.name };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [modelosRaw, novoVeiculo.modelo],
  );

  const selectedVersaoCode = useMemo(() => {
    const modeloCompleto = modelosOptions.find(
      (modelo) => modelo.name === novoVeiculo.modelo?.toUpperCase(),
    );
    return (
      modeloCompleto?.code ??
      versoesOptions.find(
        (v) => v.name === novoVeiculo.versao?.toUpperCase(),
      )?.code
    );
  }, [
    modelosOptions,
    versoesOptions,
    novoVeiculo.modelo,
    novoVeiculo.versao,
  ]);

  // Busca os anos pelo codigo do nome completo selecionado. Mantem suporte
  // aos cadastros antigos, que separavam modelo e versao.
  useEffect(() => {
    if (
      isOpen &&
      novoVeiculo.tipo &&
      novoVeiculo.marca &&
      novoVeiculo.modelo &&
      selectedVersaoCode
    ) {
      const m = encontrarMarcaFipe(marcasFipe, novoVeiculo.marca);
      if (m) {
        fetchYears(String(novoVeiculo.tipo), m.code, selectedVersaoCode);
      }
    }
  }, [
    isOpen,
    novoVeiculo.tipo,
    novoVeiculo.marca,
    novoVeiculo.modelo,
    novoVeiculo.versao,
    marcasFipe,
    selectedVersaoCode,
    fetchYears,
  ]);

  const isOffline =
    !!novoVeiculo.tipo && !loadingMarcas && marcasFipe.length === 0;

  const handleBuscarFipe = async () => {
    if (
      !novoVeiculo.ano_modelo ||
      !novoVeiculo.tipo ||
      !novoVeiculo.marca ||
      !novoVeiculo.modelo
    )
      return;
    if (!novoVeiculo.combustivel) {
      toast.error("Dados incompletos", {
        description: "Selecione o ano/combustivel FIPE correspondente.",
      });
      return;
    }
    const m = encontrarMarcaFipe(marcasFipe, novoVeiculo.marca);
    const y = anosFipe.find((a) => {
      const anoMatch = a.name.match(/\d+/);
      const aAno = anoMatch ? Number(anoMatch[0]) : null;
      const aCombustivel = handleCombustivelFromAno(a.name);
      return (
        aAno === novoVeiculo.ano_modelo &&
        (!novoVeiculo.combustivel || aCombustivel === novoVeiculo.combustivel)
      );
    });

    if (m && selectedVersaoCode && y) {
      const data = await fetchPrice(
        String(novoVeiculo.tipo),
        m.code,
        selectedVersaoCode,
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

  return (
    <DialogContent className="h-svh min-w-screen overflow-hidden p-0 sm:max-h-[850px] sm:w-[95vw] sm:max-w-[1100px] sm:min-w-0">
      <div className="flex h-full min-h-0 flex-col">
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <DialogTitle className="text-sm sm:text-lg">
            Veículo
            <span className="ml-1 text-xs font-light text-muted-foreground sm:text-sm">
              | Novo
            </span>
          </DialogTitle>
          <DialogDescription>
            Preencha dados para registrar um novo veículo
          </DialogDescription>
        </DialogHeader>

        <CustomerSelect
          open={openCustomer}
          setOpen={setOpenCustomer}
          OnSelect={(cliente) =>
            setNovoVeiculo({ ...novoVeiculo, clienteid: cliente.id, cliente })
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
                  className="group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Car className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                    Geral
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  onClick={() => setCurrentTab("Imagens")}
                  value="Imagens"
                  className="group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary dark:data-[state=active]:text-primary-foreground"
                >
                  <span className="flex items-center gap-2">
                    <ImageIcon className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                    Imagens
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
          <TabsContent
            value="Geral"
            className="h-full min-h-0 overflow-hidden p-0"
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
                value={(novoVeiculo.tipo as unknown as string) || ""}
                onValueChange={(value: Veiculo_tipos) => {
                  setNovoVeiculo({
                    ...novoVeiculo,
                    tipo: value,
                    marca: "",
                    modelo: "",
                    versao: "",
                    ano_modelo: undefined,
                    fipe: undefined,
                    combustivel: "",
                  });
                  setModelosRaw([]);
                  setAnosFipe([]);
                }}
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
                  value={formatarPlacaParaExibicao(novoVeiculo.placa || "")}
                  onChange={(e) => {
                    const digitado = e.target.value;
                    const semHifen = somenteAlphaNumMaiusculo(digitado).slice(
                      0,
                      7,
                    );
                    setNovoVeiculo({ ...novoVeiculo, placa: semHifen });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (
                        !loadingPlaca &&
                        novoVeiculo.placa &&
                        novoVeiculo.placa.length >= 7
                      ) {
                        handleBuscarPlaca();
                      }
                    }
                  }}
                  maxLength={8} // 3 + hífen + 4
                  placeholder="ABC-1D23"
                  autoCapitalize="characters"
                />
                <Button
                  variant="ghost"
                  type="button"
                  size="icon"
                  onClick={handleBuscarPlaca}
                  disabled={
                    loadingPlaca ||
                    !novoVeiculo.placa ||
                    novoVeiculo.placa.length < 7
                  }
                  title="Buscar dados da Placa"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {!clienteId && (
              <div className="col-span-2 space-y-2">
                <Label htmlFor="cliente" className="text-sm">
                  Cliente proprietário
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-full"
                    value={novoVeiculo?.cliente?.nomerazaosocial || "Sem proprietário"}
                    disabled={true}
                  />
                  <div
                    onClick={() => setOpenCustomer(true)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background hover:cursor-pointer hover:bg-muted"
                  >
                    <Search className="w-4 h-4 text-primary" />
                  </div>
                  {novoVeiculo.clienteid ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setNovoVeiculo({
                          ...novoVeiculo,
                          clienteid: null,
                          cliente: undefined,
                        })
                      }
                      title="Remover proprietário"
                    >
                      <X className="h-4 w-4 text-red-500" />
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="marca" className="text-sm">
                Marca *
              </Label>
              {isOffline ? (
                <Input
                  id="marca"
                  value={novoVeiculo.marca || ""}
                  onChange={(e) => {
                    setNovoVeiculo({
                      ...novoVeiculo,
                      marca: e.target.value.toUpperCase(),
                      modelo: "",
                      versao: "",
                      ano_modelo: undefined,
                      fipe: undefined,
                      combustivel: "",
                    });
                    setModelosRaw([]);
                    setAnosFipe([]);
                  }}
                  placeholder="Ex.: CHEVROLET"
                />
              ) : (
                <Popover open={open2} onOpenChange={setOpen2}>
                  <PopoverTrigger asChild>
                    <Button
                      id="marca"
                      variant="outline"
                      role="combobox"
                      aria-expanded={open2}
                      className="h-9 w-full justify-between text-sm"
                      disabled={loadingMarcas || !novoVeiculo.tipo}
                    >
                      {loadingMarcas
                        ? "Carregando..."
                        : novoVeiculo.marca
                          ? novoVeiculo.marca
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
                        <CommandEmpty>Nenhuma marca encontrada.</CommandEmpty>

                        <CommandGroup>
                          {marcasFipe.map((m) => (
                            <CommandItem
                              className="hover:cursor-pointer"
                              key={m.code}
                              value={m.name}
                              onSelect={() => {
                                setNovoVeiculo({
                                  ...novoVeiculo,
                                  marca: m.name.toUpperCase(),
                                  modelo: "",
                                  versao: "",
                                  ano_modelo: undefined,
                                  fipe: undefined,
                                  combustivel: "",
                                });
                                setModelosRaw([]);
                                setAnosFipe([]);
                                setOpen2(false);
                              }}
                            >
                              {m.name.toUpperCase()}
                              <Check
                                className={cn(
                                  "ml-auto",
                                  novoVeiculo.marca === m.name.toUpperCase()
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

            <div className="min-w-0 space-y-2">
              <Label htmlFor="modelo" className="text-sm">
                Modelo *
              </Label>
              <Popover open={open1} onOpenChange={setOpen1}>
                <PopoverTrigger asChild>
                  <Button
                    id="modelo"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open1}
                    className="h-9 w-full justify-between text-sm"
                    disabled={
                      loadingModelos || !novoVeiculo.tipo || !novoVeiculo.marca
                    }
                  >
                    <span
                      className="truncate text-left"
                      title={novoVeiculo.modelo || undefined}
                    >
                      {loadingModelos
                        ? "Carregando..."
                        : novoVeiculo.modelo
                          ? novoVeiculo.modelo
                          : "Selecione..."}
                    </span>
                    <ChevronsUpDown className="shrink-0 opacity-50" />
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
                      <CommandEmpty>Nenhum modelo encontrado.</CommandEmpty>

                      <CommandGroup>
                        {modelosOptions.map((m) => (
                          <CommandItem
                            className="h-auto whitespace-normal break-words py-2 text-left text-sm hover:cursor-pointer"
                            key={m.code}
                            value={m.name}
                            onSelect={() => {
                              setNovoVeiculo({
                                ...novoVeiculo,
                                modelo: m.name,
                                versao: "",
                                fipe: undefined,
                              });
                              setOpen1(false);
                            }}
                          >
                            {m.name}
                            <Check
                              className={cn(
                                "ml-auto",
                                novoVeiculo.modelo === m.name
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="ano" className="text-sm">
                Ano de Fabricação
              </Label>
              <Input
                id="ano"
                inputMode="numeric"
                className="w-full"
                maxLength={4}
                value={novoVeiculo.ano || ""}
                onChange={(e) => handleInputChange("ano", e.target.value)}
                placeholder="Ex.: 2019"
              />
            </div>
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
                  value={novoVeiculo.ano_modelo || ""}
                  onChange={(e) =>
                    handleInputChange(
                      "ano_modelo",
                      parseInt(e.target.value) || null,
                    )
                  }
                  placeholder="Ex.: 2020"
                />
              ) : (
                <Select
                  value={
                    novoVeiculo.ano_modelo && novoVeiculo.combustivel
                      ? anosFipe.find((a) => {
                          const anoMatch = a.name.match(/\d+/);
                          const aAno = anoMatch ? Number(anoMatch[0]) : null;
                          const aCombustivel = handleCombustivelFromAno(a.name);
                          return (
                            aAno === novoVeiculo.ano_modelo &&
                            aCombustivel === novoVeiculo.combustivel
                          );
                        })?.code || ""
                      : ""
                  }
                  onValueChange={(code) => {
                    const y = anosFipe.find((a) => a.code === code);
                    if (y) {
                      const anoMatch = y.name.match(/\d+/);
                      const ano = anoMatch ? Number(anoMatch[0]) : null;
                      const combustivel = handleCombustivelFromAno(y.name);
                      setNovoVeiculo({
                        ...novoVeiculo,
                        ano_modelo: ano || undefined,
                        combustivel: combustivel || novoVeiculo.combustivel,
                        fipe: undefined,
                      });
                    }
                  }}
                  disabled={
                    loadingAnos || !novoVeiculo.marca || anosFipe.length === 0
                  }
                >
                  <SelectTrigger className="h-9 w-full" id="ano_modelo">
                    <SelectValue
                      placeholder={loadingAnos ? "Buscando..." : "Selecione"}
                    />
                  </SelectTrigger>
                  <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                    {anosFipe.map((a) => {
                      let displayName = a.name;
                      if (displayName.includes("32000")) {
                        displayName = displayName.replace("32000", "Zero KM");
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
            <div className="space-y-2">
              <Label htmlFor="kmatual" className="text-sm">
                KM atual
              </Label>
              <Input
                className="w-full"
                id="kmatual"
                inputMode="numeric"
                value={novoVeiculo.kmatual || ""}
                onChange={(e) => handleInputChange("kmatual", e.target.value)}
                placeholder="Ex.: 85000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chassi" className="text-sm">
                Chassi
              </Label>
              <Input
                className="w-full"
                id="chassi"
                value={novoVeiculo.chassi || ""}
                onChange={(e) =>
                  handleInputChange("chassi", e.target.value.toUpperCase())
                }
                placeholder="Ex.: 9BW..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="combustivel" className="text-sm">
                Combustível
              </Label>
              <Select
                value={novoVeiculo.combustivel || ""}
                onValueChange={(value) =>
                  handleInputChange("combustivel", value)
                }
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

            <div className="space-y-2">
              <Label htmlFor="transmissao" className="text-sm">
                Transmissão
              </Label>
              <Select
                value={novoVeiculo.transmissao || ""}
                onValueChange={(value) =>
                  handleInputChange("transmissao", value)
                }
              >
                <SelectTrigger className="h-9 w-full" id="transmissao">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                  <SelectItem value="MANUAL">MANUAL</SelectItem>
                  <SelectItem value="AUTOMATICA">AUTOMÁTICA</SelectItem>
                  <SelectItem value="AUTOMATIZADA">AUTOMATIZADA</SelectItem>
                  <SelectItem value="CVT">CVT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-2 lg:col-span-1">
              <Label htmlFor="fipe" className="text-sm">
                FIPE (R$)
              </Label>
              <div className="flex gap-2">
                <ValueInput
                  price={novoVeiculo?.fipe || 0}
                  setPrice={(value: number) => handleInputChange("fipe", value)}
                />
                <Button
                  variant="secondary"
                  onClick={handleBuscarFipe}
                  disabled={
                    isOffline ||
                    loadingPrice ||
                    !novoVeiculo.ano_modelo ||
                    !selectedVersaoCode
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
          <TabVeiculoImagens
            mode="create"
            pendentes={imagensPendentes}
            ordemItens={ordemImagensPendentes}
            progressoUpload={progressoUploadImagens}
            saving={isSubmitting}
            onPick={handlePickImages}
            onReordenar={setOrdemPendentes}
            onRemoverPendente={handleRemoverImagemPendente}
          />
        </Tabs>

        <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
          <div className="flex w-full flex-row justify-end gap-2">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 min-w-24 hover:cursor-pointer"
              >
                Cancelar
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={handleCreateVeiculo}
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
