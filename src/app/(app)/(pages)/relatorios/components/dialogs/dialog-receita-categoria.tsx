"use client";

import { useState } from "react";
import { PieChart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExportTransactionsButton } from "../../../(financeiro)/fluxodecaixa/components/ExportTransactionsButton";
import { useCategoriasTransacao } from "../../../(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";
import { Tipo_transacao } from "../../../(financeiro)/fluxodecaixa/types";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";

export default function DialogReceitaCategoria() {
  const [open, setOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const { categorias, loadingCategorias, errorCategorias } = useCategoriasTransacao(open);
  const invalid = isInvalidPeriod(dateFrom, dateTo);
  const reportParams = new URLSearchParams({ tipo: Tipo_transacao.RECEITA });
  if (categoriaId) reportParams.set("categoriaId", categoriaId);
  if (dateFrom) reportParams.set("dateFrom", dateFrom);
  if (dateTo) reportParams.set("dateTo", dateTo);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <ReportTrigger icon={<PieChart className="h-4 w-4" />} title="Receitas por categoria" description="Detalhamento das receitas por classificação financeira" tone="bg-emerald-500/10 text-emerald-600" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receitas por categoria</DialogTitle>
          <DialogDescription>Selecione uma categoria e o período para exportar a planilha.</DialogDescription>
        </DialogHeader>
        <ReportFiltersPanel>
          <div className="space-y-2 ">
            <Label>Categoria da transação</Label>
            <Select value={categoriaId || "TODOS"} onValueChange={(value) => setCategoriaId(value === "TODOS" ? "" : value)} disabled={loadingCategorias || Boolean(errorCategorias)}>
              <SelectTrigger><SelectValue placeholder={loadingCategorias ? "Carregando..." : "Todas as categorias"} /></SelectTrigger>
              <SelectContent><SelectItem value="TODOS">Todas as categorias</SelectItem>{categorias.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>)}</SelectContent>
            </Select>
            {errorCategorias && <p className="text-xs text-destructive">{errorCategorias}</p>}
          </div>
          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
        </ReportFiltersPanel>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          <SpreadsheetPdfButton endpoint={`/api/transaction/export?${reportParams.toString()}`} title="Receitas por categoria" disabled={invalid} />
          <ExportTransactionsButton tipo={Tipo_transacao.RECEITA} categoriaId={categoriaId ? Number(categoriaId) : null} dateTo={dateTo} dateFrom={dateFrom} disabled={invalid}>Exportar Excel</ExportTransactionsButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
