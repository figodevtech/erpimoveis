"use client";

import { useState } from "react";
import { FileText, LayoutList } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";

const SECOES = [
  "Ordens de serviço abertas e concluídas",
  "Vendas",
  "Transações financeiras",
  "Compras e entradas de estoque",
  "Produtos cadastrados",
  "Usuários cadastrados",
  "Clientes cadastrados",
  "Agendamentos",
  "Documentos fiscais (NFe / NFSe)",
];

export default function DialogRelatorioDiario() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const invalid = isInvalidPeriod(dateFrom, dateTo);

  const generatePdf = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    window.open(`/print/relatorios/diario?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ReportTrigger
          icon={<LayoutList className="h-4 w-4" />}
          title="Relatório consolidado"
          description="Tudo que foi executado no período, seção por seção, numa impressão só"
          tone="bg-indigo-500/10 text-indigo-600"
        />
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Relatório consolidado do período</DialogTitle>
          <DialogDescription>
            Uma impressão única com todas as movimentações do intervalo, cada área em sua própria tabela.
          </DialogDescription>
        </DialogHeader>

        <ReportFiltersPanel>
          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />

          <div className="space-y-2">
            <p className="text-sm font-medium">Seções incluídas</p>
            <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {SECOES.map((secao) => (
                <li key={secao}>• {secao}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Cada seção lista no máximo 300 linhas. Se o período estourar esse limite, o relatório avisa na
              própria tabela — reduza o intervalo para ver o restante.
            </p>
          </div>
        </ReportFiltersPanel>

        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          <Button type="button" onClick={generatePdf} disabled={invalid}>
            <FileText className="mr-2 h-4 w-4" />Gerar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
