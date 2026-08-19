"use client";

import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Orientação da folha A4. Sem informar, imprime deitada. */
type Orientacao = "paisagem" | "retrato";

export function openSpreadsheetPdf(endpoint: string, title: string, orientacao: Orientacao = "paisagem") {
  const params = new URLSearchParams({ endpoint, title });
  if (orientacao === "retrato") params.set("orientacao", orientacao);
  window.open(`/print/relatorios/planilha?${params.toString()}`, "_blank", "noopener,noreferrer");
}

export function SpreadsheetPdfButton({
  endpoint,
  title,
  disabled = false,
  variant = "outline",
  orientacao = "paisagem",
}: {
  endpoint: string;
  title: string;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost";
  orientacao?: Orientacao;
}) {
  return (
    <Button type="button" variant={variant} disabled={disabled} onClick={() => openSpreadsheetPdf(endpoint, title, orientacao)}>
      <FileText className="mr-2 h-4 w-4" />Gerar PDF
    </Button>
  );
}
