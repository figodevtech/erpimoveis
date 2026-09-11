import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { endpointServicosValido } from "./report-model";
import { ServicosReportView } from "./report-view";

export const metadata: Metadata = { title: "Serviços Realizados" };
export default async function ServicosRealizadosPage({ searchParams }: { searchParams: Promise<{ endpoint?: string }> }) {
  await requireRelatoriosAccess();
  const { endpoint = "" } = await searchParams;
  if (!endpointServicosValido(endpoint)) notFound();
  return <ServicosReportView endpoint={endpoint} />;
}
