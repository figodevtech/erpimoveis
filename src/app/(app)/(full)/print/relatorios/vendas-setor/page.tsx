import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Printer, ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const runtime = "nodejs";

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

const FORTALEZA_OFFSET = "-03:00";

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();
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

function toNum(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default async function PrintVendasSetorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const inicio = params.inicio?.trim() || "";
  const fim = params.fim?.trim() || "";
  const setorQuery = params.setor?.trim() || "";

  // 1. Buscar a Venda baseada na data + status (PAGO ou FINALIZADA)
  const vendaQueryDb = supabaseAdmin
    .from("venda")
    .select(`
      id, 
      status, 
      datavenda, 
      valortotal,
      comissao_venda_percent_aplicada,
      cliente:cliente ( id, nomerazaosocial ),
      vendedor:vendedor ( id, nome, email, setorid )
    `)
    .in("status", ["PAGO", "FINALIZADA"]);

  const inicioUtc = inicio ? new Date(localDayStartToUtcIso(inicio)) : null;
  const fimUtc = fim ? new Date(localNextDayStartToUtcIso(fim)) : null;

  const { data: vendasRows, error: vendasErr } = await vendaQueryDb;

  if (vendasErr) {
    console.error("[vendas-setor] Erro ao buscar vendas", vendasErr);
    return <div>Erro ao carregar Vendas.</div>;
  }

  // Filtragem extra das datas de Vendas no servidor
  const filteredVendas = (vendasRows || []).filter((venda: any) => {
    const refDateIso = venda.datavenda;
    if (!refDateIso) return !inicioUtc && !fimUtc;

    const d = new Date(refDateIso);
    if (Number.isNaN(d.getTime())) return !inicioUtc && !fimUtc;

    if (inicioUtc && d < inicioUtc) return false;
    if (fimUtc && d >= fimUtc) return false;

    return true;
  });

  if (filteredVendas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground w-full h-screen">
        Nenhuma venda concluída (PAGA/FINALIZADA) encontrada neste período.
      </div>
    );
  }

  // 2. Buscar Setores para mapear os nomes
  const { data: setoresRows } = await supabaseAdmin.from("setor").select("id, nome");

  const mapSetorNome = new Map<string, string>();
  for (const s of setoresRows || []) mapSetorNome.set(String(s.id), s.nome);

  // AGRUPAMENTO DOS DADOS (Sector -> User -> Items)
  type VendaItem = {
    vendaId: number;
    cliente: string;
    dataVenda: string;
    valorTotal: number;
    percentualComissao: number;
    valorComissao: number;
  };

  type VendedorResult = {
    userId: string;
    nome: string;
    itens: VendaItem[];
    subtotalVenda: number;
    subtotalComissao: number;
  };

  type SetorResult = {
    setorId: string;
    nome: string;
    vendedores: VendedorResult[];
    totalVenda: number;
    totalComissao: number;
  };

  const mapGrpSetor = new Map<string, SetorResult>();
  const idSemSetor = "SEM_SETOR";

  for (const venda of filteredVendas) {
    const vinfo = venda.vendedor as any;
    const uId = vinfo ? String(vinfo.id) : "SEM_VENDEDOR";
    const sId = vinfo?.setorid ? String(vinfo.setorid) : idSemSetor;

    // Se houver um filtro por setor ativo, ignoramos quem não pertence a esse setor
    if (setorQuery && setorQuery !== "all" && sId !== setorQuery) {
      continue;
    }

    if (!mapGrpSetor.has(sId)) {
      mapGrpSetor.set(sId, {
        setorId: sId,
        nome: sId === idSemSetor ? "Sem Setor" : (mapSetorNome.get(sId) || "Setor Oculto"),
        vendedores: [],
        totalVenda: 0,
        totalComissao: 0
      });
    }

    const setorObj = mapGrpSetor.get(sId)!;
    let vendedorObj = setorObj.vendedores.find(r => r.userId === uId);

    if (!vendedorObj) {
      vendedorObj = {
        userId: uId,
        nome: uId === "SEM_VENDEDOR" ? "Sem Vendedor Vinculado" : (vinfo?.nome || vinfo?.email || "Usuário Desconhecido"),
        itens: [],
        subtotalVenda: 0,
        subtotalComissao: 0
      };
      setorObj.vendedores.push(vendedorObj);
    }

    const vTotal = toNum(venda.valortotal) || 0;
    const cInfo = Array.isArray(venda.cliente) ? venda.cliente[0] : venda.cliente;
    const cNome = cInfo?.nomerazaosocial ? cInfo.nomerazaosocial : "Cliente Desconhecido";
    const percent = toNum(venda.comissao_venda_percent_aplicada) || 0;
    const vComissao = (vTotal * percent) / 100;

    vendedorObj.itens.push({
      vendaId: Number(venda.id),
      cliente: cNome,
      dataVenda: venda.datavenda ? format(new Date(venda.datavenda), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—",
      valorTotal: vTotal,
      percentualComissao: percent,
      valorComissao: vComissao
    });

    vendedorObj.subtotalVenda += vTotal;
    vendedorObj.subtotalComissao += vComissao;
    setorObj.totalVenda += vTotal;
    setorObj.totalComissao += vComissao;
  }

  // Filtrar setores sem vendas
  const setoresExibicao = Array.from(mapGrpSetor.values()).filter(s => s.vendedores.length > 0);

  // Ordenação alfabética de Setor e de Vendedor dentro
  setoresExibicao.sort((a, b) => a.nome.localeCompare(b.nome));
  setoresExibicao.forEach(s => s.vendedores.sort((a, b) => a.nome.localeCompare(b.nome)));

  const totalGeral = setoresExibicao.reduce((acc, s) => acc + s.totalVenda, 0);
  const totalGeralComissao = setoresExibicao.reduce((acc, s) => acc + s.totalComissao, 0);

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
            <p className="text-sm text-gray-700 mt-1">
              Status da Venda: <span className="font-semibold">PAGO, FINALIZADA</span>
            </p>
          </div>
        </div>

        {/* Lista de Setores */}
        <div className="space-y-8">
          {setoresExibicao.map((setor) => (
            <div key={setor.setorId} className="border border-gray-300 rounded overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 border-b border-gray-300 flex justify-between items-center font-bold text-base uppercase">
                <span>Setor | {setor.nome}</span>
                <div className="text-right text-sm leading-tight">
                  <span className="block text-gray-500 font-medium text-xs">Vendas: {fmtMoney(setor.totalVenda)}</span>
                  <span className="block text-green-700">Comissão: {fmtMoney(setor.totalComissao)}</span>
                </div>
              </div>

              <div className="p-4 space-y-6">
                {setor.vendedores.map((vendedor) => (
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
                          <th className="py-1 text-right w-24">Valor (R$)</th>
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
                            <td className="py-1 text-right font-medium text-gray-900">{fmtMoney(item.valorTotal)}</td>
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
