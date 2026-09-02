import { Printer, ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { carregarVendasPorSetor, STATUS_VENDA_REALIZADA } from "@/lib/vendas/vendas-por-setor";

export const runtime = "nodejs";

/**
 * Folha de vendas por setor.
 *
 * A consulta e o agrupamento saem de `@/lib/vendas/vendas-por-setor`, os mesmos
 * que a exportação em xlsx usa. Antes esta página repetia a consulta inteira, e
 * as duas cópias filtravam o período em memória sobre uma busca sem paginação —
 * o papel e a planilha podiam discordar, e ambos podiam calar vendas.
 */

type PageProps = {
  searchParams: Promise<{
    inicio?: string;
    fim?: string;
    setor?: string;
  }>;
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Relatório de Vendas por Setor (Impressão)",
  };
}

function fmtMoney(v: number | string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export default async function PrintVendasSetorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const inicio = params.inicio?.trim() || "";
  const fim = params.fim?.trim() || "";
  const setor = params.setor?.trim() || "";

  let relatorio;
  try {
    relatorio = await carregarVendasPorSetor({ inicio, fim, setor });
  } catch (error) {
    console.error("[vendas-setor] Erro ao buscar vendas", error);
    return <div className="p-8">Erro ao carregar Vendas.</div>;
  }

  const setoresExibicao = relatorio.setores;

  if (setoresExibicao.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground w-full h-screen">
        Nenhuma venda realizada encontrada neste período.
      </div>
    );
  }

  const totalGeral = relatorio.totalVenda;
  const totalGeralComissao = relatorio.totalComissao;

  return (
    <div className="bg-neutral-200 text-black min-h-screen py-10 print:py-0 print:bg-white flex flex-col items-center">

      {/* Action Bar (Fora do Papel) */}
      <div className="print:hidden w-full max-w-[210mm] flex justify-between items-center mb-6 px-4 sm:px-0">
        <Link
          href="/relatorios"
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Relatórios
        </Link>

        <button
          id="btn-imprimir"
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm rounded-md cursor-pointer hover:bg-primary/90 shadow-sm"
        >
          <Printer className="w-4 h-4" /> Imprimir
        </button>
      </div>

      <div className="print-wrapper w-full max-w-[210mm] min-h-[297mm] mx-auto p-12 font-sans bg-white shadow-2xl print:shadow-none print:p-8 print:max-w-none print:min-h-0">

        {/* Cabeçalho */}
        <div className="flex justify-between items-start mb-8 border-b-2 border-black pb-4">
          <div>
            <h1 className="text-2xl font-bold uppercase">Relatório de Vendas por Setor</h1>
            <p className="text-sm text-gray-700 mt-1">
              Período: {inicio ? format(new Date(`${inicio}T12:00:00`), "dd/MM/yyyy", { locale: ptBR }) : "Início"} a{" "}
              {fim ? format(new Date(`${fim}T12:00:00`), "dd/MM/yyyy", { locale: ptBR }) : "Hoje"}
            </p>
            {/* Os status saem da mesma constante que a consulta usa: a folha não
                pode anunciar um recorte e trazer outro. */}
            <p className="text-sm text-gray-700 mt-1">
              Status da Venda: <span className="font-semibold">{STATUS_VENDA_REALIZADA.join(", ")}</span>
            </p>
          </div>
        </div>

        {/* Lista de Setores */}
        <div className="space-y-8">
          {setoresExibicao.map((setorGrupo) => (
            <div key={setorGrupo.setorId} className="border border-gray-300 rounded overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 border-b border-gray-300 flex justify-between items-center font-bold text-base uppercase">
                <span>Setor | {setorGrupo.nome}</span>
                <div className="text-right text-sm leading-tight">
                  <span className="block text-gray-500 font-medium text-xs">Vendas: {fmtMoney(setorGrupo.totalVenda)}</span>
                  <span className="block text-green-700">Comissão: {fmtMoney(setorGrupo.totalComissao)}</span>
                </div>
              </div>

              <div className="p-4 space-y-6">
                {setorGrupo.vendedores.map((vendedor) => (
                  <div key={vendedor.userId} className="pl-2 border-l-4 border-gray-400">
                    <div className="flex justify-between items-end font-semibold text-sm mb-2 text-gray-800 border-b border-gray-200 pb-1">
                      <span>Vendedor: {vendedor.nome}</span>
                      <div className="text-right text-xs">
                        <span className="mr-4 text-gray-500">Subtotal Vendas: {fmtMoney(vendedor.subtotalVenda)}</span>
                        <span className="text-green-700">Subtotal Comissões: {fmtMoney(vendedor.subtotalComissao)}</span>
                      </div>
                    </div>

                    <table className="w-full text-xs text-left mb-2">
                      <thead>
                        <tr className="border-b border-gray-200 uppercase text-gray-600">
                          <th className="py-1 w-16 text-center">Venda #</th>
                          <th className="py-1">Cliente</th>
                          <th className="py-1 w-32">Data da Venda</th>
                          <th className="py-1 w-24">Status</th>
                          <th className="py-1 text-right w-24">Valor (R$)</th>
                          {/* O frete nao comissiona, entao a base aparece ao
                              lado do valor: sem ela, valor x percentual nao
                              fecha com a comissao impressa. */}
                          <th className="py-1 text-right w-24">Base (R$)</th>
                          <th className="py-1 text-right w-20">Comis. (%)</th>
                          <th className="py-1 text-right w-24">Comissão (R$)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {vendedor.itens.map((item, idx) => (
                          <tr key={`${item.vendaId}-${idx}`}>
                            <td className="py-1 text-gray-500 font-medium text-center">{item.vendaId}</td>
                            <td className="py-1 truncate max-w-[200px]" title={item.cliente}>{item.cliente}</td>
                            <td className="py-1 text-gray-600">{item.dataVenda}</td>
                            <td className="py-1 text-gray-600">{item.status}</td>
                            <td className="py-1 text-right font-medium text-gray-900">{fmtMoney(item.valorTotal)}</td>
                            <td className="py-1 text-right text-gray-600">{fmtMoney(item.baseComissao)}</td>
                            <td className="py-1 text-right text-gray-600">
                              {item.percentualComissao.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%
                            </td>
                            <td className="py-1 text-right font-medium text-gray-900">{fmtMoney(item.valorComissao)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Total Geral */}
        <div className="mt-8 border-t-2 border-black pt-4 flex justify-between items-center text-lg font-bold">
          <span>TOTAL GERAL:</span>
          <div className="text-right">
            <span className="block text-sm text-gray-500 font-medium uppercase leading-tight">Vendas: {fmtMoney(totalGeral)}</span>
            <span className="block text-green-700 uppercase leading-tight">Comissões: {fmtMoney(totalGeralComissao)}</span>
          </div>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.addEventListener('click', function(e) {
              const target = e.target;
              if (target && target.closest('#btn-imprimir')) {
                window.print();
              }
            });
          `
        }}
      />
    </div>
  );
}
