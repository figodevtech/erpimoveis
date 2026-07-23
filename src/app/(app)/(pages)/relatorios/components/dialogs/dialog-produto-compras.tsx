"use client";

import { useState } from "react";
import { PackageSearch, Search, X } from "lucide-react";

import ProductSelect from "@/app/(app)/components/productSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Produto } from "../../../estoque/types";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";
import { BotaoExportProdutoVendas } from "./botao-export-produto-vendas";

export default function DialogProdutoCompras() {
  const [product, setProduct] = useState<Produto>();
  const [productSelectOpen, setProductSelectOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const invalid = isInvalidPeriod(dateFrom, dateTo);
  const reportParams = new URLSearchParams();
  if (product?.id) reportParams.set("produtoId", String(product.id));
  if (status) reportParams.set("status", status);
  if (dateFrom) reportParams.set("dateFrom", dateFrom);
  if (dateTo) reportParams.set("dateTo", dateTo);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ReportTrigger icon={<PackageSearch className="h-4 w-4" />} title="Vendas por produto" description="Histórico de vendas, quantidades e valores de um produto" tone="bg-blue-500/10 text-blue-600" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vendas por produto</DialogTitle>
          <DialogDescription>Selecione o produto, o período e os status incluídos na planilha.</DialogDescription>
        </DialogHeader>
        <ReportFiltersPanel>
          <div className="space-y-2">
            <Label>Produto</Label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal" onClick={() => setProductSelectOpen(true)}>
                <Search className="mr-2 h-4 w-4" /><span className="truncate">{product?.titulo ?? "Selecionar produto"}</span>
              </Button>
              {product && <Button type="button" variant="outline" size="icon" aria-label="Limpar produto" onClick={() => setProduct(undefined)}><X className="h-4 w-4" /></Button>}
            </div>
            <ProductSelect open={productSelectOpen} setOpen={setProductSelectOpen} OnSelect={(selected) => { setProduct(selected); setProductSelectOpen(false); }} />
          </div>
          <div className="space-y-2">
            <Label>Status da venda</Label>
            <Select value={status || "TODOS"} onValueChange={(value) => setStatus(value === "TODOS" ? "" : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos os status</SelectItem>
                <SelectItem value="PENDENTE">Pendente</SelectItem>
                <SelectItem value="PAGAMENTO">Aguardando pagamento</SelectItem>
                <SelectItem value="FINALIZADA">Finalizada</SelectItem>
                <SelectItem value="CANCELADA">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
        </ReportFiltersPanel>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          <SpreadsheetPdfButton endpoint={`/api/venda/export/produto?${reportParams.toString()}`} title="Vendas por produto" disabled={!product?.id || invalid} />
          <BotaoExportProdutoVendas produtoId={product?.id} dateFrom={dateFrom} dateTo={dateTo} status={status} disabled={!product?.id || invalid}>Exportar Excel</BotaoExportProdutoVendas>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
