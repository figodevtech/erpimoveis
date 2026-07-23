"use client";

import { useEffect, useState } from "react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { CalendarIcon, Loader2, Network, Printer, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import type { Setor } from "@/types/setor";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";

function parseYYYYMMDD(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toYYYYMMDD(date?: Date) {
  return date ? format(date, "yyyy-MM-dd") : "";
}

export default function DialogComissaoSetor() {
  const [setores, setSetores] = useState<Setor[]>([]);
  const [loadingSetores, setLoadingSetores] = useState(false);
  const [selectedSetorId, setSelectedSetorId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const invalidPeriod = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const pdfParams = new URLSearchParams();
  if (selectedSetorId !== "all") pdfParams.set("setor", selectedSetorId);
  if (dateFrom) pdfParams.set("inicio", dateFrom);
  if (dateTo) pdfParams.set("fim", dateTo);

  const setThisMonth = () => {
    const now = new Date();
    setDateFrom(toYYYYMMDD(startOfMonth(now)));
    setDateTo(toYYYYMMDD(endOfMonth(now)));
  };

  const setLastMonth = () => {
    const last = subMonths(new Date(), 1);
    setDateFrom(toYYYYMMDD(startOfMonth(last)));
    setDateTo(toYYYYMMDD(endOfMonth(last)));
  };

  useEffect(() => {
    const loadSetores = async () => {
      try {
        setLoadingSetores(true);
        const response = await fetch("/api/tipos/setores", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Falha ao carregar setores.");
        if (Array.isArray(data)) {
            setSetores(data);
        } else if (data?.items && Array.isArray(data.items)) {
            setSetores(data.items);
        } else if (data?.setores && Array.isArray(data.setores)) {
            setSetores(data.setores);
        }
      } catch (error) {
        console.error("Erro ao carregar setores", error);
        setSetores([]);
      } finally {
        setLoadingSetores(false);
      }
    };

    loadSetores();
  }, []);

  const handlePrint = () => {
    const params = new URLSearchParams();
    if (selectedSetorId && selectedSetorId !== "all") {
        params.set("setor", selectedSetorId);
    }
    if (dateFrom) params.set("inicio", dateFrom);
    if (dateTo) params.set("fim", dateTo);

    window.open(`/print/relatorios/comissao-setor?${params.toString()}`, "_blank");
  };

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      const params = new URLSearchParams();
      if (selectedSetorId && selectedSetorId !== "all") {
          params.set("setor", selectedSetorId);
      }
      if (dateFrom) params.set("inicio", dateFrom);
      if (dateTo) params.set("fim", dateTo);

      const response = await fetch(`/api/users/export/comissao-setor?${params.toString()}`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao exportar a planilha.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const tempLink = document.createElement("a");
      tempLink.href = url;
      tempLink.setAttribute("download", "comissao_por_setor.xlsx");
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error(error.message || "Erro na solicitação de exportação.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto hover:cursor-pointer flex-col items-start justify-start gap-2 p-4 text-left hover:bg-accent hover:text-accent-foreground bg-transparent"
        >
          <div className="flex w-full items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
              <Network />
            </div>
            <span className="flex-1 font-medium">Comissão por Setor</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Visualiza e imprime as comissões agrupadas por setor
          </p>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Relatório de Comissão por Setor (Impressão)</DialogTitle>
          <DialogDescription>
            Defina os filtros desejados para agrupar as comissões e clique em Visualizar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 rounded-2xl bg-card p-4">
          <div className="space-y-2">
            <Label>Setor</Label>
            <Select value={selectedSetorId} onValueChange={setSelectedSetorId}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={loadingSetores ? "Carregando setores..." : "Selecione um setor"}
                />
              </SelectTrigger>
              <SelectContent>
                {loadingSetores ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando setores...
                  </div>
                ) : (
                  <>
                    <SelectItem value="all">Todos os Setores</SelectItem>
                    {setores.map((setor) => (
                      <SelectItem key={setor.id} value={String(setor.id)}>
                        {setor.nome}
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={setThisMonth}>
              Este Mês
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={setLastMonth}>
              Mês Anterior
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Data inicial</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom
                      ? format(parseYYYYMMDD(dateFrom)!, "dd/MM/yyyy", { locale: ptBR })
                      : "Selecionar data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={parseYYYYMMDD(dateFrom)}
                    onSelect={(date) => setDateFrom(toYYYYMMDD(date))}
                    locale={ptBR}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Data final</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo
                      ? format(parseYYYYMMDD(dateTo)!, "dd/MM/yyyy", { locale: ptBR })
                      : "Selecionar data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={parseYYYYMMDD(dateTo)}
                    onSelect={(date) => setDateTo(toYYYYMMDD(date))}
                    locale={ptBR}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center gap-2 justify-end w-full">
          <SpreadsheetPdfButton endpoint={`/api/users/export/comissao-setor?${pdfParams.toString()}`} title="Comissão por setor" disabled={isExporting || invalidPeriod} />
          <Button 
            type="button" 
            variant="outline" 
            onClick={handleExportExcel} 
            disabled={isExporting}
            className="text-green-600 hover:text-green-700 hover:bg-green-50 mr-auto sm:mr-0 min-w-28"
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Excel
              </>
            )}
          </Button>
          <Button type="button" variant="default" onClick={handlePrint} disabled={isExporting}>
            <Printer className="mr-2 h-4 w-4" />
            Visualizar
          </Button>
          <DialogClose asChild>
            <Button variant="outline" className="hover:cursor-pointer hidden sm:flex" disabled={isExporting}>Cancelar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
