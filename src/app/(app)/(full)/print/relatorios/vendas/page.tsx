import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasFinanceiroAccess, hasVendasAccess } from "@/app/api/_authz/perms";
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

  // Custo e lucro da venda têm a trava do painel de eventos da tela da venda.
  // Decidir aqui, no servidor, faz a opção simplesmente não existir para quem
  // não pode vê-la — melhor que oferecê-la e responder 403 quando for marcada.
  const [vendas, financeiro] = await Promise.all([hasVendasAccess(), hasFinanceiroAccess()]);

  return <VendaListReportView endpoint={endpoint} podeVerEventos={vendas && financeiro} />;
}
