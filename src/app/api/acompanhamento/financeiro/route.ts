export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Origem = "OS" | "VENDA";

type Cobranca = {
  chave: string;
  origem: Origem;
  id: number;
  status: string;
  cliente: string;
  setor: { id: number; nome: string } | null;
  responsavel: string | null;
  descricao: string | null;
  referencia: string | null;
  data: string | null;
  atualizadoEm: string | null;
  total: number;
  pago: number;
  saldo: number;
  percentual: number;
  ultimoPagamentoEm: string | null;
};

const OS_SELECT = `
  id, descricao, status, orcamentototal, dataentrada, datasaida, updatedat,
  cliente:clienteid ( id, nomerazaosocial ),
  setor:setorid ( id, nome ),
  veiculo:veiculoid ( placa, modelo, marca ),
  peca:pecaid ( titulo, lacre ),
  responsavel:usuariocriadorid ( id, nome )
`;

const VENDA_SELECT = `
  id, status, valortotal, datavenda, updatedat, canal,
  cliente:clienteid ( id, nomerazaosocial ),
  categoria:categoriavendaid ( id, nome ),
  vendedor_rel:vendedor (
    id, nome,
    setor:setorid ( id, nome )
  )
`;

function numero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moeda(value: number) {
  return Math.round(value * 100) / 100;
}

function errorResponse(error: any) {
  const status = Number(error?.statusCode) || (error?.message === "Não autenticado" ? 401 : 500);
  return NextResponse.json(
    { error: error?.message || "Falha ao carregar acompanhamento financeiro" },
    { status },
  );
}

export async function GET(req: NextRequest) {
  try {
    await requireFinanceirosAccess();

    const { searchParams } = new URL(req.url);
    const setorId = numero(searchParams.get("setorId")) || null;
    const origemParam = String(searchParams.get("origem") || "TODAS").toUpperCase();
    const origem = origemParam === "OS" || origemParam === "VENDA" ? origemParam : "TODAS";
    const horasRecentes = Math.min(168, Math.max(1, numero(searchParams.get("horasRecentes")) || 24));
    const limite = Math.min(1000, Math.max(10, numero(searchParams.get("limit")) || 500));
    const desde = new Date(Date.now() - horasRecentes * 60 * 60 * 1000).toISOString();

    const osPromise =
      origem === "VENDA"
        ? Promise.resolve({ data: [], error: null })
        : supabaseAdmin
            .from("ordemservico")
            .select(OS_SELECT)
            .in("status", ["PAGAMENTO", "CONCLUIDO"])
            .eq("is_deleted", false)
            .order("updatedat", { ascending: false })
            .limit(limite);

    const vendasPromise =
      origem === "OS"
        ? Promise.resolve({ data: [], error: null })
        : supabaseAdmin
            .from("venda")
            .select(VENDA_SELECT)
            .in("status", ["PAGAMENTO", "PAGO", "FINALIZADA"])
            .order("updatedat", { ascending: false })
            .limit(limite);

    const [osResult, vendasResult] = await Promise.all([osPromise, vendasPromise]);
    if (osResult.error) throw osResult.error;
    if (vendasResult.error) throw vendasResult.error;

    const ordens = (osResult.data ?? []) as any[];
    const vendas = (vendasResult.data ?? []) as any[];
    const ordemIds = ordens.map((item) => Number(item.id)).filter(Number.isFinite);
    const vendaIds = vendas.map((item) => Number(item.id)).filter(Number.isFinite);

    const transacoesOsPromise = ordemIds.length
      ? supabaseAdmin
          .from("transacao")
          .select("id, ordemservicoid, valor, data, tipo, pendente")
          .in("ordemservicoid", ordemIds)
          .eq("is_deleted", false)
          .eq("tipo", "RECEITA")
      : Promise.resolve({ data: [], error: null });

    const transacoesVendasPromise = vendaIds.length
      ? supabaseAdmin
          .from("transacao")
          .select("id, vendaid, valor, data, tipo, pendente")
          .in("vendaid", vendaIds)
          .eq("is_deleted", false)
          .eq("tipo", "RECEITA")
      : Promise.resolve({ data: [], error: null });

    const [transacoesOsResult, transacoesVendasResult] = await Promise.all([
      transacoesOsPromise,
      transacoesVendasPromise,
    ]);
    if (transacoesOsResult.error) throw transacoesOsResult.error;
    if (transacoesVendasResult.error) throw transacoesVendasResult.error;

    const pagamentosOs = new Map<number, { total: number; ultimo: string | null }>();
    for (const transacao of (transacoesOsResult.data ?? []) as any[]) {
      if (transacao.pendente) continue;
      const id = Number(transacao.ordemservicoid);
      const atual = pagamentosOs.get(id) ?? { total: 0, ultimo: null };
      atual.total += numero(transacao.valor);
      if (transacao.data && (!atual.ultimo || transacao.data > atual.ultimo)) atual.ultimo = transacao.data;
      pagamentosOs.set(id, atual);
    }

    const pagamentosVendas = new Map<number, { total: number; ultimo: string | null }>();
    for (const transacao of (transacoesVendasResult.data ?? []) as any[]) {
      if (transacao.pendente) continue;
      const id = Number(transacao.vendaid);
      const atual = pagamentosVendas.get(id) ?? { total: 0, ultimo: null };
      atual.total += numero(transacao.valor);
      if (transacao.data && (!atual.ultimo || transacao.data > atual.ultimo)) atual.ultimo = transacao.data;
      pagamentosVendas.set(id, atual);
    }

    const cobrancas: Cobranca[] = [];

    for (const ordem of ordens) {
      const pagamento = pagamentosOs.get(Number(ordem.id)) ?? { total: 0, ultimo: null };
      const total = moeda(numero(ordem.orcamentototal));
      const pago = moeda(pagamento.total);
      const concluida = ordem.status === "CONCLUIDO";
      const atualizadoEm = ordem.datasaida ?? ordem.updatedat ?? null;
      if (concluida && (!atualizadoEm || new Date(atualizadoEm).getTime() < new Date(desde).getTime())) continue;
      if (setorId && Number(ordem.setor?.id) !== setorId) continue;

      const veiculo = ordem.veiculo
        ? [ordem.veiculo.marca, ordem.veiculo.modelo, ordem.veiculo.placa].filter(Boolean).join(" • ")
        : null;
      const peca = ordem.peca
        ? [ordem.peca.titulo, ordem.peca.lacre].filter(Boolean).join(" • ")
        : null;

      cobrancas.push({
        chave: `OS-${ordem.id}`,
        origem: "OS",
        id: Number(ordem.id),
        status: String(ordem.status),
        cliente: ordem.cliente?.nomerazaosocial || "Cliente não informado",
        setor: ordem.setor ? { id: Number(ordem.setor.id), nome: ordem.setor.nome } : null,
        responsavel: ordem.responsavel?.nome ?? null,
        descricao: ordem.descricao ?? null,
        referencia: veiculo || peca,
        data: ordem.dataentrada ?? null,
        atualizadoEm,
        total,
        pago,
        saldo: moeda(Math.max(0, total - pago)),
        percentual: total > 0 ? Math.min(100, Math.round((pago / total) * 100)) : 0,
        ultimoPagamentoEm: pagamento.ultimo,
      });
    }

    for (const venda of vendas) {
      const pagamento = pagamentosVendas.get(Number(venda.id)) ?? { total: 0, ultimo: null };
      const total = moeda(numero(venda.valortotal));
      const pago = moeda(pagamento.total);
      const finalizada = venda.status === "FINALIZADA" || venda.status === "PAGO";
      const atualizadoEm = venda.updatedat ?? null;
      if (finalizada && (!atualizadoEm || new Date(atualizadoEm).getTime() < new Date(desde).getTime())) continue;

      const setorVenda = venda.vendedor_rel?.setor ?? null;
      if (setorId && Number(setorVenda?.id) !== setorId) continue;

      cobrancas.push({
        chave: `VENDA-${venda.id}`,
        origem: "VENDA",
        id: Number(venda.id),
        status: String(venda.status),
        cliente: venda.cliente?.nomerazaosocial || "Cliente não informado",
        setor: setorVenda ? { id: Number(setorVenda.id), nome: setorVenda.nome } : null,
        responsavel: venda.vendedor_rel?.nome ?? null,
        descricao: venda.categoria?.nome ? `Categoria: ${venda.categoria.nome}` : null,
        referencia: venda.canal ? `Canal: ${String(venda.canal).replaceAll("_", " ")}` : null,
        data: venda.datavenda ?? null,
        atualizadoEm,
        total,
        pago,
        saldo: moeda(Math.max(0, total - pago)),
        percentual: total > 0 ? Math.min(100, Math.round((pago / total) * 100)) : 0,
        ultimoPagamentoEm: pagamento.ultimo,
      });
    }

    const recebidos = cobrancas
      .filter((item) => item.total > 0 && item.pago >= item.total - 0.009)
      .sort((a, b) => String(b.ultimoPagamentoEm ?? b.atualizadoEm).localeCompare(String(a.ultimoPagamentoEm ?? a.atualizadoEm)));
    const parciais = cobrancas
      .filter((item) => item.pago > 0 && (item.total <= 0 || item.pago < item.total - 0.009))
      .sort((a, b) => b.saldo - a.saldo);
    const aguardando = cobrancas
      .filter((item) => item.pago <= 0 || item.total <= 0)
      .sort((a, b) => String(a.data).localeCompare(String(b.data)));

    return NextResponse.json({
      aguardando,
      parciais,
      recebidos,
      resumo: {
        quantidade: cobrancas.length,
        aReceber: moeda([...aguardando, ...parciais].reduce((acc, item) => acc + item.saldo, 0)),
        recebido: moeda(cobrancas.reduce((acc, item) => acc + item.pago, 0)),
        total: moeda(cobrancas.reduce((acc, item) => acc + item.total, 0)),
      },
      meta: {
        setorId,
        origem,
        horasRecentes,
        atualizadoEm: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("[GET] /api/acompanhamento/financeiro", error);
    return errorResponse(error);
  }
}
