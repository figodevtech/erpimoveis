import { Printer, ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { carregarComissoes } from "@/lib/ordens/comissoes-de-servico";
import { STATUS_OS_FINALIZADAS } from "@/lib/meu-perfil/regras";

export const runtime = "nodejs";

/**
 * Folha de comissão por setor.
 *
 * A consulta e o agrupamento saem de `@/lib/ordens/comissoes-de-servico`, os
 * mesmos que a exportação em xlsx usa e com o mesmo recorte da Central Pessoal.
 * Antes esta página repetia a consulta inteira, filtrava o período em memória
 * sobre uma busca sem paginação e exigia `CONCLUIDO`, perdendo a OS que já
 * executou e só espera a quitação.
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
    title: "Relatório de Comissão por Setor",
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

export default async function PrintComissaoSetorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const inicio = params.inicio?.trim() || "";
  const fim = params.fim?.trim() || "";
  const setor = params.setor?.trim() || "";

  let relatorio;
  try {
    relatorio = await carregarComissoes({ inicio, fim, setor });
  } catch (error) {
    console.error("[comissao-setor] erro ao carregar comissões:", error);
    return <div className="p-8">Erro ao carregar as comissões.</div>;
  }

  const setoresExibicao = relatorio.setores;

  if (setoresExibicao.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground w-full h-screen">
        Não há serviços executados por realizadores nas OS encerradas do período selecionado.
      </div>
    );
  }

  const totalGeral = relatorio.totalComissao;

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
            <h1 className="text-2xl font-bold uppercase">Relatório de Comissão por Setor</h1>
            <p className="text-sm text-gray-700 mt-1">
              Período: {inicio ? format(new Date(`${inicio}T12:00:00`), "dd/MM/yyyy", { locale: ptBR }) : "Início"} a{" "}
              {fim ? format(new Date(`${fim}T12:00:00`), "dd/MM/yyyy", { locale: ptBR }) : "Hoje"}
            </p>
            {/* O período é medido pelo fim da execução, e não pela saída
                digitada à mão: é o carimbo do sistema, o mesmo da Central
                Pessoal. Os status saem da constante que a consulta usa. */}
            <p className="text-sm text-gray-700 mt-1">
              Recorte: OS em <span className="font-semibold">{STATUS_OS_FINALIZADAS.join(" ou ")}</span>, pelo fim da execução
            </p>
          </div>
        </div>

        {/* Lista de Setores */}
        <div className="space-y-8">
          {setoresExibicao.map((setorGrupo) => (
            <div key={setorGrupo.setorId} className="border border-gray-300 rounded overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 border-b border-gray-300 flex justify-between font-bold text-base uppercase">
                <span>Setor | {setorGrupo.nome}</span>
                <span>{fmtMoney(setorGrupo.totalComissao)}</span>
              </div>

              <div className="p-4 space-y-6">
                {setorGrupo.realizadores.map((realizador) => (
                  <div key={realizador.userId} className="pl-2 border-l-4 border-gray-400">
                    <div className="flex justify-between font-semibold text-sm mb-2 text-gray-800">
                      <span>Funcionário: {realizador.nome}</span>
                      <span>Subtotal Comissões: {fmtMoney(realizador.totalComissao)}</span>
                    </div>

                    <table className="w-full text-xs text-left mb-2">
                      <thead>
                        <tr className="border-b border-gray-200 uppercase text-gray-600">
                          <th className="py-1 w-12 text-center">OS #</th>
                          <th className="py-1">Serviço</th>
                          <th className="py-1 w-32">Início</th>
                          <th className="py-1 w-32">Fim</th>
                          <th className="py-1 text-right w-24">Base (R$)</th>
                          <th className="py-1 text-right w-16">Perc. (%)</th>
                          <th className="py-1 text-right w-24">Comissão (R$)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {realizador.itens.map((item, idx) => (
                          <tr key={`${item.ordemId}-${item.servicoId}-${idx}`}>
                            <td className="py-1 text-gray-500 font-medium text-center">{item.ordemId}</td>
                            <td className="py-1 truncate max-w-[150px]" title={item.servicoDescricao}>
                              {item.servicoDescricao}
                              {/* Serviço marcado para não comissionar: sem isto
                                  a linha zerada parece erro de cálculo. */}
                              {!item.geraComissao && (
                                <span className="ml-1 text-[10px] uppercase text-gray-500">· sem comissão</span>
                              )}
                            </td>
                            <td className="py-1 text-gray-600">{item.execucaoInicio || "—"}</td>
                            <td className="py-1 text-gray-600">{item.execucaoFim || "—"}</td>
                            <td className="py-1 text-right">{fmtMoney(item.valorBase)}</td>
                            <td className="py-1 text-right">{item.percentualAplicado.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2})}%</td>
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
          <span>{fmtMoney(totalGeral)}</span>
        </div>
      </div>

      {/* Um Server Component não pode chamar `window.print` direto; o script
          inline é o menor caminho que evita transformar a folha em client. */}
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
