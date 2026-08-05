import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrdemFinancialReportView } from "./ordem-financial-report-view";

export const metadata: Metadata = { title: "Eventos financeiros por OS" };

export default async function OrdemFinancialReportPage({
  searchParams,
}: {
  searchParams: Promise<{ endpoint?: string; layout?: string }>;
}) {
  const { endpoint = "", layout = "" } = await searchParams;
  if (!(endpoint === "/api/reports/ordens/export" || endpoint.startsWith("/api/reports/ordens/export?"))) notFound();

  return <OrdemFinancialReportView endpoint={endpoint} umaPorPagina={layout === "UMA_OS"} />;
}
