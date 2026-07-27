"use client";

import { useState } from "react";
import { Search, ShoppingBag, X } from "lucide-react";

import CustomerSelect from "@/app/(app)/components/customerSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Customer } from "../../../clientes/types";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";
import { BotaoExportHistoricoCompras } from "./botao-export-cliente-compra";

export default function DialogClienteCompras() {
  const [customer, setCustomer] = useState<Customer>();
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const invalid = isInvalidPeriod(dateFrom, dateTo);
  const reportParams = new URLSearchParams();
  if (customer?.id) reportParams.set("clienteId", String(customer.id));
  if (dateFrom) reportParams.set("dateFrom", dateFrom);
  if (dateTo) reportParams.set("dateTo", dateTo);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ReportTrigger icon={<ShoppingBag className="h-4 w-4" />} title="Histórico de compras" description="Vendas e valores registrados para um cliente" tone="bg-violet-500/10 text-violet-600" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Histórico de compras do cliente</DialogTitle>
          <DialogDescription>Selecione o cliente e o período que deseja incluir na planilha.</DialogDescription>
        </DialogHeader>
        <ReportFiltersPanel>
          <div className="space-y-2">
            <Label>Cliente</Label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal" onClick={() => setCustomerSelectOpen(true)}>
                <Search className="mr-2 h-4 w-4" /><span className="truncate">{customer?.nomerazaosocial ?? "Selecionar cliente"}</span>
              </Button>
              {customer && <Button type="button" variant="outline" size="icon" aria-label="Limpar cliente" onClick={() => setCustomer(undefined)}><X className="h-4 w-4" /></Button>}
            </div>
            <CustomerSelect open={customerSelectOpen} setOpen={setCustomerSelectOpen} OnSelect={(selected) => { setCustomer(selected); setCustomerSelectOpen(false); }} />
          </div>
          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
        </ReportFiltersPanel>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          <SpreadsheetPdfButton endpoint={`/api/venda/export/cliente?${reportParams.toString()}`} title="Histórico de compras" disabled={!customer?.id || invalid} />
          <BotaoExportHistoricoCompras clienteId={customer?.id} dateFrom={dateFrom} dateTo={dateTo} disabled={!customer?.id || invalid} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
