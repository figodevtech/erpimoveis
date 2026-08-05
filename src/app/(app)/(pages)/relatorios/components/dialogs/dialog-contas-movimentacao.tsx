"use client";

import { useState } from "react";
import { FileText, Landmark } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";

export default function DialogContasMovimentacao() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pendentes, setPendentes] = useState<"false" | "true">("false");
  const invalid = isInvalidPeriod(dateFrom, dateTo);

  const generatePdf = () => {
    const params = new URLSearchParams({ pendentes });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    window.open(`/print/relatorios/contas-movimentacao?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ReportTrigger
          icon={<Landmark className="h-4 w-4" />}
          title="Movimentação por conta"
          description="Entradas, saídas e saldo de cada conta bancária cadastrada"
          tone="bg-amber-500/10 text-amber-600"
        />
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Movimentação por conta bancária</DialogTitle>
          <DialogDescription>
            Uma linha por conta, com o saldo antes do período, o que entrou, o que saiu e o saldo resultante.
            Não lista as transações — apenas as somas.
          </DialogDescription>
        </DialogHeader>

        <ReportFiltersPanel>
          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />

          <div className="min-w-0 space-y-2">
            <Label>Lançamentos pendentes</Label>
            <Select value={pendentes} onValueChange={(value) => setPendentes(value as "false" | "true")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Não considerar (somente realizados)</SelectItem>
                <SelectItem value="true">Considerar no saldo</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Saldo é caixa: por padrão só entra o que já foi baixado. Incluir pendentes mostra o saldo projetado.
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
