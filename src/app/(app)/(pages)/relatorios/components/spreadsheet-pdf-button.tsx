"use client";

import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function openSpreadsheetPdf(endpoint: string, title: string) {
  const params = new URLSearchParams({ endpoint, title });
  window.open(`/print/relatorios/planilha?${params.toString()}`, "_blank", "noopener,noreferrer");
}

export function SpreadsheetPdfButton({
  endpoint,
  title,
  disabled = false,
  variant = "outline",
}: {
  endpoint: string;
  title: string;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  return (
    <Button type="button" variant={variant} disabled={disabled} onClick={() => openSpreadsheetPdf(endpoint, title)}>
      <FileText className="mr-2 h-4 w-4" />Gerar PDF
    </Button>
  );
}
