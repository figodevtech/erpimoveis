"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, FileSpreadsheet, FileText, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { openSpreadsheetPdf } from "./spreadsheet-pdf-button";

type ProductStatus = "OK" | "CRITICO" | "BAIXO" | "TODOS" | "SEM_ESTOQUE";

export function ProductStockReportButton({
  icon,
  title,
  description,
  status,
  tone,
  search,
  chunk,
  filename,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: ProductStatus;
  tone: string;
  search?: string | null;
  chunk?: number;
  filename?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function exportReport() {
    if (loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status });
      if (search) params.set("search", search);
      if (chunk) params.set("chunk", String(chunk));
      const response = await fetch(`/api/products/export?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Falha ao exportar o relatório.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename || `produtos_${status}`}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao exportar o relatório.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" disabled={loading} variant="outline" className="h-auto min-h-24 flex-col items-start justify-start gap-2 bg-transparent p-4 text-left hover:cursor-pointer">
          <div className="flex w-full items-center gap-2">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</div>
            <span className="flex-1 font-medium">{title}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>
          {loading ? <span className="flex items-center gap-2 text-xs text-primary"><LoaderCircle className="h-4 w-4 animate-spin" />Gerando planilha...</span> : <p className="line-clamp-2 whitespace-normal text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => void exportReport()}><FileSpreadsheet className="h-4 w-4" />Exportar Excel</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openSpreadsheetPdf(`/api/products/export?${new URLSearchParams({ status, ...(search && { search }), ...(chunk && { chunk: String(chunk) }) }).toString()}`, title)}>
          <FileText className="h-4 w-4" />Gerar PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
