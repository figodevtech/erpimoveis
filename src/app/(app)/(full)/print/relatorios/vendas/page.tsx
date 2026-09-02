import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VendaListReportView } from "./venda-list-report-view";

export const metadata: Metadata = { title: "Relação de vendas" };

export default async function VendaListReportPage({
  searchParams,
}: {
  searchParams: Promise<{ endpoint?: string }>;
}) {
  const { endpoint = "" } = await searchParams;
  // Mesma trava das outras folhas: o endereço vem da barra e só pode apontar
  // para a exportação de vendas.
  if (!(endpoint === "/api/reports/vendas/export" || endpoint.startsWith("/api/reports/vendas/export?"))) {
    notFound();
  }

  return <VendaListReportView endpoint={endpoint} />;
}
