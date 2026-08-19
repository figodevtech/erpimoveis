import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SpreadsheetReportView } from "./spreadsheet-report-view";

export const metadata: Metadata = { title: "Visualização do relatório" };

const ALLOWED_ENDPOINTS = [
  "/api/products/export",
  "/api/transaction/export",
  "/api/venda/export/produto",
  "/api/venda/export/cliente",
  "/api/venda/export/usuario",
  "/api/users/export/comissao",
  "/api/users/export/comissao-setor",
  "/api/users/export/vendas-setor",
  "/api/reports/ordens/export",
  "/api/reports/estoque/movimentos/export",
];

export default async function SpreadsheetReportPage({
  searchParams,
}: {
  searchParams: Promise<{ endpoint?: string; title?: string; orientacao?: string }>;
}) {
  const params = await searchParams;
  const endpoint = params.endpoint ?? "";
  if (!ALLOWED_ENDPOINTS.some((allowed) => endpoint === allowed || endpoint.startsWith(`${allowed}?`))) notFound();
  // Paisagem continua sendo o padrão: quem não pede orientação imprime como sempre imprimiu.
  const orientacao = params.orientacao === "retrato" ? "retrato" : "paisagem";
  return (
    <SpreadsheetReportView
      endpoint={endpoint}
      title={(params.title || "Relatório").slice(0, 100)}
      orientacao={orientacao}
    />
  );
}
