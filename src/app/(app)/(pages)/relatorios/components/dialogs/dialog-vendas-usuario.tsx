"use client";

import { User } from "lucide-react";
import { BotaoExportVendasUsuario } from "./botao-export-vendas-usuario";
import { UserReportDialog } from "./user-report-dialog";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";

export default function DialogVendasUsuario() {
  return (
    <UserReportDialog
      icon={<User className="h-4 w-4" />}
      cardTitle="Vendas por usuário"
      cardDescription="Vendas realizadas por um vendedor no período"
      dialogTitle="Vendas por usuário"
      dialogDescription="Selecione o vendedor e o período que deseja incluir na planilha."
      userLabel="Vendedor"
      userPlaceholder="Selecionar vendedor"
      tone="bg-cyan-500/10 text-cyan-600"
      renderExport={({ userId, dateFrom, dateTo, disabled }) => (
        <>
          <SpreadsheetPdfButton endpoint={`/api/venda/export/usuario?${new URLSearchParams({ userId, ...(dateFrom && { dateFrom }), ...(dateTo && { dateTo }) }).toString()}`} title="Vendas por usuário" disabled={disabled} />
          <BotaoExportVendasUsuario userId={userId} dateFrom={dateFrom} dateTo={dateTo} disabled={disabled}>Exportar Excel</BotaoExportVendasUsuario>
        </>
      )}
    />
  );
}
