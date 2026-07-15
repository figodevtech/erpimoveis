"use client";

import * as React from "react";
import axios, { isAxiosError } from "axios";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { toast } from "@/lib/toast";

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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import ValueInput from "../../(financeiro)/fluxodecaixa/components/transactionDialog/valueInput";
import { Lote, LoteTipo } from "../types";
import { useFipe } from "./useFipe";

type LoteFormFieldsProps = {
  lote: Lote;
  setLote: (value: Lote) => void;
  isOpen: boolean;
};

type FipeOption = {
  code: string;
  name: string;
};

function somenteAlphaNumMaiusculo(valor: string) {
  return valor.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatarPlacaParaExibicao(valor?: string | null) {
  const placa = somenteAlphaNumMaiusculo(String(valor ?? "")).slice(0, 7);
  if (placa.length <= 3) return placa;
  return `${placa.slice(0, 3)}-${placa.slice(3)}`;
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
  ) {
    return true;
  }
  if (
    (alvo === "GM" || alvo === "CHEVROLET") &&
    (fipe.includes("GM") || fipe.includes("CHEVROLET"))
  ) {
    return true;
  }
  if (
    (alvo === "M BENZ" || alvo === "MERCEDES BENZ") &&
    fipe.includes("MERCEDES")
  ) {
    return true;
  }
  return fipe.split(" ").includes(alvo);
}

function encontrarMarcaFipe<T extends FipeOption>(marcas: T[], marca?: string | null) {
  if (!marca) return undefined;
  return marcas.find((m) => marcaCompativel(m.name, marca));
}

function handleCombustivelFromAno(anoStr: string) {
  const s = anoStr.toUpperCase();
  if (s.includes("GASOLINA")) return "GASOLINA";
  if (s.includes("ALCOOL") || s.includes("ETANOL")) return "ETANOL";
  if (s.includes("DIESEL")) return "DIESEL";
  if (s.includes("ELETRICO") || s.includes("ELÉTRICO")) return "ELETRICO";
  if (s.includes("HIBRIDO") || s.includes("HÍBRIDO")) return "HIBRIDO";
  if (s.includes("FLEX")) return "FLEX";
  return null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function mapearCombustivel(valor: string) {
  const upper = valor.toUpperCase();
  if (upper.includes("FLEX") || upper.includes("ALCOOL / GASOLINA")) return "FLEX";
  if (upper.includes("GASOLINA")) return "GASOLINA";
  if (upper.includes("ALCOOL") || upper.includes("ETANOL")) return "ETANOL";
  if (upper.includes("DIESEL")) return "DIESEL";
  if (upper.includes("HIBRIDO") || upper.includes("HÍBRIDO")) return "HIBRIDO";
  if (upper.includes("ELETRICO") || upper.includes("ELÉTRICO")) return "ELETRICO";
  return upper;
}

function extrairCombustivel(data: Record<string, unknown>) {
  const extra = getRecord(data.extra);
  const combustivel = extra.combustivel;
  if (typeof combustivel === "string") return combustivel;
  const combustivelRecord = getRecord(combustivel);
  return getString(combustivelRecord.descricao || combustivelRecord.nome);
}

export default function LoteFormFields({ lote, setLote, isOpen }: LoteFormFieldsProps) {
  const [openModelo, setOpenModelo] = React.useState(false);
  const [openMarca, setOpenMarca] = React.useState(false);
  const [openVersao, setOpenVersao] = React.useState(false);
  const [loadingPlaca, setLoadingPlaca] = React.useState(false);

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

  const handleInputChange = (field: keyof Lote, value: string | number | null | undefined) => {
    setLote({ ...lote, [field]: value });
  };

  const extractModeloBase = (name: string) => name.trim().split(" ")[0].toUpperCase();

  const modelosOptions = React.useMemo(
    () => Array.from(new Set(modelosRaw.map((m) => extractModeloBase(m.name)))).sort(),
    [modelosRaw],
  );

  const versoesOptions = React.useMemo(
    () =>
      modelosRaw
        .filter(
          (m) =>
            lote.modelo &&
            (m.name.toUpperCase().startsWith(lote.modelo.toUpperCase() + " ") ||
              m.name.toUpperCase() === lote.modelo.toUpperCase()),
        )
        .map((m) => {
          let name = m.name.substring(lote.modelo!.length).trim();
          if (!name) name = "Standard";
          return { code: m.code, name: name.toUpperCase(), originalName: m.name };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [modelosRaw, lote.modelo],
  );

  const selectedYearCode = React.useMemo(() => {
    if (!lote.ano_modelo || !lote.combustivel) return undefined;
    return anosFipe.find((ano) => {
      const anoMatch = ano.name.match(/\d+/);
      const anoNumero = anoMatch ? Number(anoMatch[0]) : null;
      const combustivel = handleCombustivelFromAno(ano.name);
      return anoNumero === lote.ano_modelo && combustivel === lote.combustivel;
    })?.code;
  }, [anosFipe, lote.ano_modelo, lote.combustivel]);

  const selectedVersaoCode = React.useMemo(
    () => versoesOptions.find((v) => v.name === lote.versao?.toUpperCase())?.code,
    [versoesOptions, lote.versao],
  );

  const isOffline = !!lote.tipo && !loadingMarcas && marcasFipe.length === 0;

  React.useEffect(() => {
    if (isOpen && lote.tipo) {
      fetchBrands(String(lote.tipo));
    }
  }, [isOpen, lote.tipo, fetchBrands]);

  React.useEffect(() => {
    if (isOpen && lote.tipo && lote.marca) {
      const marca = encontrarMarcaFipe(marcasFipe, lote.marca);
      if (marca) {
        if (!lote.ano_modelo || !lote.combustivel) {
          fetchModels(String(lote.tipo), marca.code);
        }
        fetchYearsByBrand(String(lote.tipo), marca.code);
      }
    }
  }, [
    isOpen,
    lote.tipo,
    lote.marca,
    lote.ano_modelo,
    lote.combustivel,
    marcasFipe,
    fetchModels,
    fetchYearsByBrand,
  ]);

  React.useEffect(() => {
    if (isOpen && lote.tipo && lote.marca && lote.ano_modelo && selectedYearCode) {
      const marca = encontrarMarcaFipe(marcasFipe, lote.marca);
      if (marca) {
        fetchModelsByBrandAndYear(String(lote.tipo), marca.code, selectedYearCode);
      }
    }
  }, [
    isOpen,
    lote.tipo,
    lote.marca,
    lote.ano_modelo,
    selectedYearCode,
    marcasFipe,
    fetchModelsByBrandAndYear,
  ]);

  React.useEffect(() => {
    if (
      isOpen &&
      lote.tipo &&
      lote.marca &&
      lote.modelo &&
      lote.versao &&
      selectedVersaoCode
    ) {
      const marca = encontrarMarcaFipe(marcasFipe, lote.marca);
      if (marca) {
        fetchYears(String(lote.tipo), marca.code, selectedVersaoCode);
      }
    }
  }, [
    isOpen,
    lote.tipo,
    lote.marca,
    lote.modelo,
    lote.versao,
    marcasFipe,
    selectedVersaoCode,
    fetchYears,
  ]);

  const handleBuscarPlaca = async () => {
    if (!lote.placa || lote.placa.length < 7) return;
    if (!lote.tipo) {
      toast.warning("Selecione o tipo de veículo", {
        description: "É obrigatório escolher um tipo antes de consultar a placa.",
      });
      return;
    }

    setLoadingPlaca(true);
    const toastId = toast.loading("Consultando placa...");
    try {
      const response = await axios.get(`/api/veiculos/consulta-placa/${lote.placa}`);
      const data = getRecord(response.data);
      const extra = getRecord(data.extra);
      const rawMarca = getString(data.MARCA || data.marca);
      let cleanedMarca = rawMarca.toUpperCase();
      if (cleanedMarca.includes(" - ")) cleanedMarca = cleanedMarca.split(" - ")[1];
      if (cleanedMarca.includes("/")) cleanedMarca = cleanedMarca.split("/")[0];
      cleanedMarca = cleanedMarca.trim();

      const marcaFipe = encontrarMarcaFipe(marcasFipe, cleanedMarca);
      const rawModelo = getString(data.SUBMODELO || data.MODELO || data.modelo);
      const cleanedModelo = rawModelo.split(" ")[0].toUpperCase().trim();
      const anoFabricacao = getString(data.ano || extra.ano_fabricacao);
      const anoModelo = getString(data.anoModelo || extra.ano_modelo);
      const combustivel = mapearCombustivel(extrairCombustivel(data));
      const marcaSelecionada = marcaFipe?.name.toUpperCase() || cleanedMarca || lote.marca;

      const nextLote: Lote = {
        ...lote,
        marca: marcaSelecionada,
        modelo: cleanedModelo || lote.modelo,
        versao: undefined,
        ano: anoFabricacao ? Number(anoFabricacao) : lote.ano,
        ano_modelo: anoModelo ? Number(anoModelo) : lote.ano_modelo,
        chassi: getString(extra.chassi || data.chassi) || lote.chassi,
        cor: getString(data.cor).toUpperCase() || lote.cor,
        combustivel,
        fipe: undefined,
      };

      setLote(nextLote);
      setModelosRaw([]);
      setAnosFipe([]);

      const marcaParaBusca = marcaFipe || encontrarMarcaFipe(marcasFipe, marcaSelecionada);
      if (marcaParaBusca) {
        await Promise.all([
          fetchModels(String(lote.tipo), marcaParaBusca.code),
          fetchYearsByBrand(String(lote.tipo), marcaParaBusca.code),
        ]);
      }

      toast.success("Placa consultada", {
        id: toastId,
        description: "Dados do lote preenchidos.",
      });
    } catch (error) {
      const description = isAxiosError(error)
        ? error.response?.data?.error ?? error.message
        : "Erro ao consultar a placa.";
      toast.error("Erro na consulta", { id: toastId, description });
    } finally {
      setLoadingPlaca(false);
    }
  };

  const handleBuscarFipe = async () => {
    if (!lote.ano_modelo || !lote.tipo || !lote.marca || !lote.versao || !lote.modelo) return;
    if (!lote.combustivel) {
      toast.error("Dados incompletos", {
        description: "Selecione o ano/combustível FIPE correspondente.",
      });
      return;
    }

    const marca = encontrarMarcaFipe(marcasFipe, lote.marca);
    const versao = versoesOptions.find((v) => v.name === lote.versao?.toUpperCase());
    const ano = anosFipe.find((a) => {
      const anoMatch = a.name.match(/\d+/);
      const anoNumero = anoMatch ? Number(anoMatch[0]) : null;
      const combustivel = handleCombustivelFromAno(a.name);
      return anoNumero === lote.ano_modelo && combustivel === lote.combustivel;
    });

    if (!marca || !versao || !ano) {
      toast.error("Dados incompletos", {
        description: "Selecione o ano FIPE correspondente.",
      });
      return;
    }

    const data = await fetchPrice(String(lote.tipo), marca.code, versao.code, ano.code);
    if (data?.price) {
      const value = Number(data.price.replace(/[^\d,]/g, "").replace(",", "."));
      if (!Number.isNaN(value)) {
        handleInputChange("fipe", value);
        return;
      }
    }

    toast.error("Erro na busca", {
      description: "Não foi possível resgatar o valor FIPE.",
    });
  };

  return (
    <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="tipo" className="text-sm">
            Tipo de Veículo
          </Label>
          <Select
            value={String(lote.tipo ?? "")}
            onValueChange={(value: LoteTipo) => {
              setLote({
                ...lote,
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
              {Object.values(LoteTipo).map((tipo) => (
                <SelectItem className="hover:cursor-pointer" key={tipo} value={tipo}>
                  {tipo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="placa" className="text-sm">
            Placa
          </Label>
          <div className="relative">
            <Input
              id="placa"
              className="w-full pr-9 uppercase"
              value={formatarPlacaParaExibicao(lote.placa)}
              onChange={(event) =>
                handleInputChange(
                  "placa",
                  somenteAlphaNumMaiusculo(event.target.value).slice(0, 7),
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleBuscarPlaca();
                }
              }}
              maxLength={8}
              placeholder="ABC-1D23"
              autoCapitalize="characters"
            />
            <Button
              variant="ghost"
              type="button"
              size="icon"
              onClick={handleBuscarPlaca}
              disabled={loadingPlaca || !lote.placa || lote.placa.length < 7}
              title="Buscar dados da placa"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
            >
              {loadingPlaca ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="chassi" className="text-sm">
            Chassi
          </Label>
          <Input
            id="chassi"
            className="w-full"
            value={lote.chassi ?? ""}
            onChange={(event) => handleInputChange("chassi", event.target.value.toUpperCase())}
            placeholder="Ex.: 9BW..."
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="marca" className="text-sm">
            Marca
          </Label>
          {isOffline ? (
            <Input
              id="marca"
              value={lote.marca ?? ""}
              onChange={(event) => {
                setLote({
                  ...lote,
                  marca: event.target.value.toUpperCase(),
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
            <Popover open={openMarca} onOpenChange={setOpenMarca}>
              <PopoverTrigger asChild>
                <Button
                  id="marca"
                  variant="outline"
                  role="combobox"
                  aria-expanded={openMarca}
                  className="h-9 w-full justify-between text-sm"
                  disabled={loadingMarcas || !lote.tipo}
                >
                  {loadingMarcas ? "Carregando..." : lote.marca || "Selecione..."}
                  <ChevronsUpDown className="opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                onWheel={(event) => event.stopPropagation()}
                onTouchMove={(event) => event.stopPropagation()}
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="w-[var(--radix-popover-trigger-width)] p-0"
                onWheelCapture={(event) => event.stopPropagation()}
              >
                <Command>
                  <CommandInput placeholder="Buscar marca..." className="h-9 text-base" />
                  <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
                    <CommandEmpty>Nenhuma marca encontrada.</CommandEmpty>
                    <CommandGroup>
                      {marcasFipe.map((marca) => (
                        <CommandItem
                          className="hover:cursor-pointer"
                          key={marca.code}
                          value={marca.name}
                          onSelect={() => {
                            setLote({
                              ...lote,
                              marca: marca.name.toUpperCase(),
                              modelo: "",
                              versao: "",
                              ano_modelo: undefined,
                              fipe: undefined,
                              combustivel: "",
                            });
                            setModelosRaw([]);
                            setAnosFipe([]);
                            setOpenMarca(false);
                          }}
                        >
                          {marca.name.toUpperCase()}
                          <Check
                            className={cn(
                              "ml-auto",
                              lote.marca === marca.name.toUpperCase() ? "opacity-100" : "opacity-0",
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
            Modelo
          </Label>
          <Popover open={openModelo} onOpenChange={setOpenModelo}>
            <PopoverTrigger asChild>
              <Button
                id="modelo"
                variant="outline"
                role="combobox"
                aria-expanded={openModelo}
                className="h-9 w-full justify-between text-sm"
                disabled={loadingModelos || !lote.tipo || !lote.marca}
              >
                {loadingModelos ? "Carregando..." : lote.modelo || "Selecione..."}
                <ChevronsUpDown className="opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              onWheel={(event) => event.stopPropagation()}
              onTouchMove={(event) => event.stopPropagation()}
              onOpenAutoFocus={(event) => event.preventDefault()}
              className="w-[var(--radix-popover-trigger-width)] p-0"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              <Command>
                <CommandInput placeholder="Buscar modelo..." className="h-9 text-base" />
                <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
                  <CommandEmpty>Nenhum modelo encontrado.</CommandEmpty>
                  <CommandGroup>
                    {modelosOptions.map((modelo) => (
                      <CommandItem
                        className="hover:cursor-pointer text-sm"
                        key={modelo}
                        value={modelo}
                        onSelect={() => {
                          setLote({
                            ...lote,
                            modelo: modelo.toUpperCase(),
                            versao: "",
                            fipe: undefined,
                          });
                          setOpenModelo(false);
                        }}
                      >
                        {modelo.toUpperCase()}
                        <Check
                          className={cn(
                            "ml-auto",
                            lote.modelo === modelo.toUpperCase() ? "opacity-100" : "opacity-0",
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

        <div className="col-span-2 space-y-2">
          <Label htmlFor="versao" className="text-sm">
            Versão
          </Label>
          {isOffline ? (
            <Input
              id="versao"
              value={lote.versao ?? ""}
              onChange={(event) => {
                setLote({
                  ...lote,
                  versao: event.target.value.toUpperCase(),
                  ano_modelo: undefined,
                  combustivel: "",
                  fipe: undefined,
                });
              }}
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
                  disabled={!lote.modelo || modelosRaw.length === 0}
                >
                  {lote.versao || "Selecione..."}
                  <ChevronsUpDown className="opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                onWheel={(event) => event.stopPropagation()}
                onTouchMove={(event) => event.stopPropagation()}
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="w-[var(--radix-popover-trigger-width)] p-0"
                onWheelCapture={(event) => event.stopPropagation()}
              >
                <Command>
                  <CommandInput placeholder="Buscar versão..." className="h-9 text-base" />
                  <CommandList className="max-h-64 overflow-y-auto overscroll-contain">
                    <CommandEmpty>Nenhuma versão encontrada.</CommandEmpty>
                    <CommandGroup>
                      {versoesOptions.map((versao) => (
                        <CommandItem
                          className="hover:cursor-pointer text-sm"
                          key={versao.code}
                          value={versao.name}
                          onSelect={() => {
                            setLote({
                              ...lote,
                              versao: versao.name.toUpperCase(),
                              fipe: undefined,
                            });
                            setOpenVersao(false);
                          }}
                        >
                          {versao.name.toUpperCase()}
                          <Check
                            className={cn(
                              "ml-auto",
                              lote.versao === versao.name.toUpperCase() ? "opacity-100" : "opacity-0",
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

        <div className="space-y-2">
          <Label htmlFor="ano" className="text-sm">
            Ano de Fabricação
          </Label>
          <Input
            id="ano"
            inputMode="numeric"
            className="w-full"
            maxLength={4}
            value={lote.ano ?? ""}
            onChange={(event) => handleInputChange("ano", event.target.value ? Number(event.target.value) : null)}
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
              value={lote.ano_modelo ?? ""}
              onChange={(event) =>
                handleInputChange("ano_modelo", event.target.value ? Number(event.target.value) : null)
              }
              placeholder="Ex.: 2020"
            />
          ) : (
            <Select
              value={selectedYearCode ?? ""}
              onValueChange={(code) => {
                const ano = anosFipe.find((item) => item.code === code);
                if (ano) {
                  const anoMatch = ano.name.match(/\d+/);
                  const anoNumero = anoMatch ? Number(anoMatch[0]) : null;
                  const combustivel = handleCombustivelFromAno(ano.name);
                  setLote({
                    ...lote,
                    ano_modelo: anoNumero,
                    combustivel: combustivel || lote.combustivel,
                    fipe: undefined,
                  });
                }
              }}
              disabled={loadingAnos || !lote.marca || anosFipe.length === 0}
            >
              <SelectTrigger className="h-9 w-full" id="ano_modelo">
                <SelectValue placeholder={loadingAnos ? "Buscando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                {anosFipe.map((ano) => (
                  <SelectItem key={ano.code} value={ano.code}>
                    {ano.name.includes("32000") ? ano.name.replace("32000", "Zero KM") : ano.name}
                  </SelectItem>
                ))}
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
            value={lote.kmatual ?? ""}
            onChange={(event) => handleInputChange("kmatual", event.target.value ? Number(event.target.value) : null)}
            placeholder="Ex.: 85000"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cor" className="text-sm">
            Cor
          </Label>
          <Input
            className="w-full"
            id="cor"
            value={lote.cor ?? ""}
            onChange={(event) => handleInputChange("cor", event.target.value.toUpperCase())}
            placeholder="Ex.: PRATA"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="combustivel" className="text-sm">
            Combustível
          </Label>
          <Select value={lote.combustivel ?? ""} onValueChange={(value) => handleInputChange("combustivel", value)}>
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
          <Select value={lote.transmissao ?? ""} onValueChange={(value) => handleInputChange("transmissao", value)}>
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
            <ValueInput price={lote.fipe ?? 0} setPrice={(value) => handleInputChange("fipe", value)} />
            <Button
              type="button"
              variant="secondary"
              onClick={handleBuscarFipe}
              disabled={isOffline || loadingPrice || !lote.ano_modelo || !lote.versao}
            >
              {loadingPrice ? "Buscando..." : "Buscar"}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="observacoes" className="text-sm">
          Observações
        </Label>
        <Textarea
          id="observacoes"
          value={lote.observacoes ?? ""}
          onChange={(event) => handleInputChange("observacoes", event.target.value)}
          placeholder="Observações gerais do lote"
        />
      </div>
    </div>
  );
}
