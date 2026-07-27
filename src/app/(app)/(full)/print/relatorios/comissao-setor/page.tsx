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
    title: "Relatório de Comissão por Setor",
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

export default async function PrintComissaoSetorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const inicio = params.inicio?.trim() || "";
  const fim = params.fim?.trim() || "";
  const setorQuery = params.setor?.trim() || "";

  // 1. Buscar a OS baseada na data + filtro de concluída
  const osQueryDb = supabaseAdmin
    .from("ordemservico")
    .select("id, status, datasaida, createdat, execucao_inicio_em, execucao_fim_em")
    .eq("status", "CONCLUIDO");

  const inicioUtc = inicio ? new Date(localDayStartToUtcIso(inicio)) : null;
  const fimUtc = fim ? new Date(localNextDayStartToUtcIso(fim)) : null;

  const { data: osRows, error: osErr } = await osQueryDb;

  if (osErr) {
    console.error("[comissão-setor] Erro ao buscar ordens", osErr);
    return <div>Erro ao carregar Ordens de Serviço.</div>;
  }

  // Filtragem extra das datas de OS concluídas no servidor da aplicação
  const filteredOsIds = (osRows || [])
    .filter((os: any) => {
      // Prioridade na lógica foi pedida na task de datasaida (a data em que foi encerrado).
      const refDateIso = os.datasaida || os.createdat;
      if (!refDateIso) return !inicioUtc && !fimUtc;

      const d = new Date(refDateIso);
      if (Number.isNaN(d.getTime())) return !inicioUtc && !fimUtc;

      if (inicioUtc && d < inicioUtc) return false;
      if (fimUtc && d >= fimUtc) return false;

      return true;
    })
    .map((os) => Number(os.id));

  if (filteredOsIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground w-full h-screen">
        Nenhuma comissão de Ordem Concluída encontrada neste período.
      </div>
    );
  }

  // 2. Buscar relacionamentos OSServico
  const { data: osServicosRel, error: osServicosErr } = await supabaseAdmin
    .from("osservico")
    .select("ordemservicoid, servicoid, servico(descricao)")
    .in("ordemservicoid", filteredOsIds);

  if (osServicosErr) {
    console.error("[comissão-setor] erro os_servico:", osServicosErr);
  }

  const mapServicoDesc = new Map<string, string>();
  if (osServicosRel) {
    for (const r of osServicosRel as any[]) {
      const key = `${r.ordemservicoid}::${r.servicoid}`;
      mapServicoDesc.set(key, r.servico?.descricao || "Serviço sem descrição");
    }
  }

  const mapOsDatasExec = new Map<number, { inicio: string | null, fim: string | null }>();
  if (osRows) {
    for (const os of osRows as any[]) {
      mapOsDatasExec.set(Number(os.id), {
        inicio: os.execucao_inicio_em ? format(new Date(os.execucao_inicio_em), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—",
        fim: os.execucao_fim_em ? format(new Date(os.execucao_fim_em), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—"
      });
    }
  }

  // 3. Buscar comissões dos serviços
  const { data: comissoes, error: comissoesErr } = await supabaseAdmin
    .from("osservico_realizador")
    .select("ordemservicoid, servicoid, usuarioid, valor_comissao, valor_base, comissao_percent_aplicada")
    .in("ordemservicoid", filteredOsIds);

  if (comissoesErr) {
    console.error("[comissao-setor] erro comissoes:", comissoesErr);
    return <div>Erro ao carregar as comissões.</div>;
  }

  const relRealizadores = comissoes || [];

  if (relRealizadores.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground w-full h-screen">
        Não há realizadores vinculados às OS concluídas do período selecionado.
      </div>
    );
  }

  const userIds = Array.from(new Set(relRealizadores.map((i: any) => i.usuarioid).filter(Boolean)));

  // 4. Buscar Usuários e Setores
  const { data: userRows } = userIds.length
    ? await supabaseAdmin.from("usuario").select("id, nome, email, setorid").in("id", userIds)
    : { data: [] };

  const { data: setoresRows } = await supabaseAdmin.from("setor").select("id, nome");

  const mapUsuarios = new Map<string, any>();
  for (const u of userRows || []) mapUsuarios.set(String(u.id), u);

  const mapSetorNome = new Map<string, string>();
  for (const s of setoresRows || []) mapSetorNome.set(String(s.id), s.nome);

  // AGRUPAMENTO DOS DADOS (Sector -> User -> Items)
  // Estrutura:
  // agrupamento[setorId].realizadores[userId].itens
  type ComissãoItem = {
    osId: number;
    servico: string;
    execInicio: string | null;
    execFim: string | null;
    valorBase: number;
    percentualAplicado: number;
    valorComissao: number;
  };

  type RealizadorResult = {
    userId: string;
    nome: string;
    itens: ComissãoItem[];
    subtotalComissao: number;
  };

  type SetorResult = {
    setorId: string;
    nome: string;
    realizadores: RealizadorResult[];
    totalComissao: number;
  };

  const mapGrpSetor = new Map<string, SetorResult>();

  const idSemSetor = "SEM_SETOR";

  for (const row of relRealizadores as any[]) {
    const uId = String(row.usuarioid);
    const usuarioInfo = mapUsuarios.get(uId);
    const sId = usuarioInfo?.setorid ? String(usuarioInfo.setorid) : idSemSetor;

    // Se houver um filtro por setor ativo, ignoramos quem não pertence a esse setor
    if (setorQuery && setorQuery !== "all" && sId !== setorQuery) {
      continue;
    }

    if (!mapGrpSetor.has(sId)) {
      mapGrpSetor.set(sId, {
        setorId: sId,
        nome: sId === idSemSetor ? "Sem Setor" : (mapSetorNome.get(sId) || "Setor Oculto"),
        realizadores: [],
        totalComissao: 0
      });
    }

    const setorObj = mapGrpSetor.get(sId)!;
    let realizadorObj = setorObj.realizadores.find(r => r.userId === uId);

    if (!realizadorObj) {
      realizadorObj = {
        userId: uId,
        nome: usuarioInfo?.nome || usuarioInfo?.email || "Usuário Desconhecido",
        itens: [],
        subtotalComissao: 0
      };
      setorObj.realizadores.push(realizadorObj);
    }

    const vComissao = toNum(row.valor_comissao) || 0;
    const pComissao = toNum(row.comissao_percent_aplicada) || 0;
    const ordemservicoid = Number(row.ordemservicoid);
    const osDatas = mapOsDatasExec.get(ordemservicoid);

    realizadorObj.itens.push({
      osId: ordemservicoid,
      servico: mapServicoDesc.get(`${row.ordemservicoid}::${row.servicoid}`) || "N/A",
      execInicio: osDatas?.inicio || "—",
      execFim: osDatas?.fim || "—",
      valorBase: toNum(row.valor_base) || 0,
      percentualAplicado: pComissao,
      valorComissao: vComissao
    });

    realizadorObj.subtotalComissao += vComissao;
    setorObj.totalComissao += vComissao;
  }

  // Filtrar setores sem realizadores
  const setoresExibicao = Array.from(mapGrpSetor.values()).filter(s => s.realizadores.length > 0);

  // Ordenação alfabética de Setor e de Realizador dentro
  setoresExibicao.sort((a, b) => a.nome.localeCompare(b.nome));
  setoresExibicao.forEach(s => s.realizadores.sort((a, b) => a.nome.localeCompare(b.nome)));

  const totalGeral = setoresExibicao.reduce((acc, s) => acc + s.totalComissao, 0);

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
            <p className="text-sm text-gray-700 mt-1">
              Status OS: <span className="font-semibold">CONCLUIDA</span>
            </p>
          </div>
        </div>

        {/* Lista de Setores */}
        <div className="space-y-8">
          {setoresExibicao.map((setor) => (
            <div key={setor.setorId} className="border border-gray-300 rounded overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 border-b border-gray-300 flex justify-between font-bold text-base uppercase">
                <span>Setor | {setor.nome}</span>
                <span>{fmtMoney(setor.totalComissao)}</span>
              </div>

              <div className="p-4 space-y-6">
                {setor.realizadores.map((realizador) => (
                  <div key={realizador.userId} className="pl-2 border-l-4 border-gray-400">
                    <div className="flex justify-between font-semibold text-sm mb-2 text-gray-800">
                      <span>Funcionário: {realizador.nome}</span>
                      <span>Subtotal Comissões: {fmtMoney(realizador.subtotalComissao)}</span>
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
                          <tr key={`${item.osId}-${idx}`}>
                            <td className="py-1 text-gray-500 font-medium text-center">{item.osId}</td>
                            <td className="py-1 truncate max-w-[150px]" title={item.servico}>{item.servico}</td>
                            <td className="py-1 text-gray-600">{item.execInicio}</td>
                            <td className="py-1 text-gray-600">{item.execFim}</td>
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

      {/* Script do botão de print inline pra funcionar caso JS seja parseado dps? Nao, botamos onClick lá em cima de forma safe pro SSR. Wait, pra um Server Component rodar `window.print` ele tem que ter um Client Component. */}
      {/* Solução: um script inline minimalista. */}
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
