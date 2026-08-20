import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrdemListReportView } from "./ordem-list-report-view";

export const metadata: Metadata = { title: "Relação de ordens de serviço" };

export default async function OrdemListReportPage({
  searchParams,
}: {
  searchParams: Promise<{ endpoint?: string }>;
}) {
  const { endpoint = "" } = await searchParams;
  // Mesma trava das outras folhas: o endereço vem da barra e só pode apontar
  // para a exportação de ordens.
  if (!(endpoint === "/api/reports/ordens/export" || endpoint.startsWith("/api/reports/ordens/export?"))) {
    notFound();
  }

  return <OrdemListReportView endpoint={endpoint} />;
}
