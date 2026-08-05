"use client";

import { useState } from "react";
import { CreditCard, FileText } from "lucide-react";

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

export default function DialogMetodosMovimentacao() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pendentes, setPendentes] = useState<"false" | "true">("false");
  const invalid = isInvalidPeriod(dateFrom, dateTo);

  const generatePdf = () => {
    const params = new URLSearchParams({ pendentes });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    window.open(`/print/relatorios/metodos-movimentacao?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ReportTrigger
          icon={<CreditCard className="h-4 w-4" />}
          title="Movimentação por método"
          description="Entradas, saídas e saldo de cada método de pagamento"
          tone="bg-cyan-500/10 text-cyan-600"
        />
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Movimentação por método de pagamento</DialogTitle>
          <DialogDescription>
            Uma linha por método, com quanto entrou, quanto saiu e o saldo do período.
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
              Por padrão só entra o que já foi baixado. Incluir pendentes mostra o movimento projetado.
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
