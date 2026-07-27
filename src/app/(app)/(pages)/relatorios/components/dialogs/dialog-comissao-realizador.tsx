"use client";

import { BadgePercent } from "lucide-react";
import { BotaoExportComissaoRealizador } from "./botao-export-comissao-realizador";
import { UserReportDialog } from "./user-report-dialog";
import { SpreadsheetPdfButton } from "../spreadsheet-pdf-button";

export default function DialogComissaoRealizador() {
  return (
    <UserReportDialog
      icon={<BadgePercent className="h-4 w-4" />}
      cardTitle="Comissão por realizador"
      cardDescription="Comissões dos serviços executados por funcionário"
      dialogTitle="Comissão por realizador"
      dialogDescription="Selecione o realizador e o período que deseja incluir na planilha."
      userLabel="Realizador"
      userPlaceholder="Selecionar realizador"
      tone="bg-orange-500/10 text-orange-600"
      renderExport={({ userId, dateFrom, dateTo, disabled }) => (
        <>
          <SpreadsheetPdfButton endpoint={`/api/users/export/comissao?${new URLSearchParams({ userId, ...(dateFrom && { dateFrom }), ...(dateTo && { dateTo }) }).toString()}`} title="Comissão por realizador" disabled={disabled} />
          <BotaoExportComissaoRealizador userId={userId} dateFrom={dateFrom} dateTo={dateTo} disabled={disabled}>Exportar Excel</BotaoExportComissaoRealizador>
        </>
      )}
    />
  );
}
