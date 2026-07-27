"use client";

import { useEffect, useState } from "react";
import { format, startOfMonth, subMonths, endOfMonth } from "date-fns";
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
import { CalendarIcon, Loader2, Printer, FileSpreadsheet, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";

type Setor = {
  id: number;
  nome: string;
};

function parseYYYYMMDD(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toYYYYMMDD(date?: Date) {
  return date ? format(date, "yyyy-MM-dd") : "";
}

export default function DialogVendasSetor() {
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
    const lastMonth = subMonths(new Date(), 1);
    setDateFrom(toYYYYMMDD(startOfMonth(lastMonth)));
    setDateTo(toYYYYMMDD(endOfMonth(lastMonth)));
  };

  useEffect(() => {
    const loadSetores = async () => {
      try {
        setLoadingSetores(true);
        const response = await fetch("/api/tipos/setores", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Falha ao carregar setores.");
        
        setSetores(Array.isArray(data?.items) ? data.items : []);
      } catch (error) {
        console.error(error);
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

    window.open(`/print/relatorios/vendas-setor?${params.toString()}`, "_blank");
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

      const response = await fetch(`/api/users/export/vendas-setor?${params.toString()}`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao exportar a planilha.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const tempLink = document.createElement("a");
      tempLink.href = url;
      tempLink.setAttribute("download", "vendas_por_setor.xlsx");
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
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
              <Store className="h-4 w-4" />
            </div>
            <span className="flex-1 font-medium">Vendas por Setor</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Exporta as vendas agrupadas por setor e vendedor
          </p>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Relatório de Vendas por Setor</DialogTitle>
          <DialogDescription>
            Selecione o setor e o período para visualizar ou baixar o relatório de vendas concluídas (PAGO ou FINALIZADA).
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
                <SelectItem value="all">Todos os setores</SelectItem>
                {loadingSetores ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando setores...
                  </div>
                ) : (
                  setores.map((setor) => (
                    <SelectItem key={setor.id} value={String(setor.id)}>
                      {setor.nome}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Período</Label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={setLastMonth}>Mês Anterior</Button>
                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={setThisMonth}>Este Mês</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
                      : "Data inicial"}
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
                      : "Data final"}
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
          <SpreadsheetPdfButton endpoint={`/api/users/export/vendas-setor?${pdfParams.toString()}`} title="Vendas por setor" disabled={isExporting || invalidPeriod} />
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
