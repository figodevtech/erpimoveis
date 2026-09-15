export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { idDeBusca } from "@/lib/busca-numerica";
import { getExecucaoSession, isNextResponse, STATUS_EXECUTAVEIS } from "../_helpers";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getFortalezaDayRangeUtc() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  const start = new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, 3, 0, 0, 0));

  return { start: start.toISOString(), end: end.toISOString() };
}

export async function GET(req: Request) {
  try {
    const session = await getExecucaoSession();
    if (isNextResponse(session)) return session;

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") ?? "ativas").toLowerCase();
    const q = (searchParams.get("q") ?? "").trim();
    const setorParam = searchParams.get("setorId");
    const prioridadeParam = searchParams.get("prioridade");
    let ordemIdsFinalizadasHoje: number[] | null = null;

    if (status === "finalizadas") {
      const { start, end } = getFortalezaDayRangeUtc();
      const finalizadasRes = await supabaseAdmin
        .from("osservico_realizador")
        .select("ordemservicoid")
        .eq("usuarioid", session.userId)
        .eq("status_execucao", "FINALIZADO")
        .gte("finalizado_em", start)
        .lt("finalizado_em", end);

      if (finalizadasRes.error) throw finalizadasRes.error;

      ordemIdsFinalizadasHoje = Array.from(
        new Set((finalizadasRes.data ?? []).map((row: any) => Number(row.ordemservicoid)).filter(Boolean))
      );

      if (ordemIdsFinalizadasHoje.length === 0) {
        return NextResponse.json(
          {
            setorId: session.setorId,
            userId: session.userId,
            items: [],
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    let query = supabaseAdmin
      .from("ordemservico")
      .select(
        `
          id,
          descricao,
          prioridade,
          orcamentototal,
          status,
          dataentrada,
          datasaida,
          execucao_inicio_em,
          execucao_fim_em,
          alvo_tipo,
          cliente:clienteid ( id, nomerazaosocial, telefone ),
          veiculo:veiculoid ( id, placa, modelo, marca ),
          peca:pecaid ( id, titulo, descricao, lacre ),
          setor:setorid ( id, nome )
        `
      )
      .eq("is_deleted", false)
      .order("dataentrada", { ascending: true });

    // Filtro de Setor: Se não for 'todos', usa o parâmetro ou o padrão da sessão
    if (setorParam !== "todos") {
      const sId = setorParam ? Number(setorParam) : session.setorId;
      if (sId) {
        query = query.eq("setorid", sId);
      }
    }

    // Filtro de Prioridade
    if (prioridadeParam && prioridadeParam !== "todos") {
      query = query.eq("prioridade", prioridadeParam);
    }

    if (status === "finalizadas") {
      query = query.in("id", ordemIdsFinalizadasHoje ?? []);
    } else {
      query = query.in("status", [...STATUS_EXECUTAVEIS]);
    }

    if (q) {
      const like = `%${q}%`;
      const idNumerico = idDeBusca(q);
      const filters = [`descricao.ilike.${like}`];
      if (idNumerico !== null) filters.push(`id.eq.${idNumerico}`);
      query = query.or(filters.join(","));
    }

    const { data, error } = await query;
    if (error) throw error;

    const ordensRaw = data ?? [];
    const ordemIds = ordensRaw.map((row: any) => Number(row.id)).filter(Boolean);

    const servicosByOrdem = new Map<number, any[]>();
    const produtosByOrdem = new Map<number, any[]>();

    if (ordemIds.length > 0) {
      // Carregar Serviços
      const { data: servicos, error: servicosError } = await supabaseAdmin
        .from("osservico")
        .select(`
          ordemservicoid,
          servicoid,
          descricao,
          quantidade,
          precounitario,
          subtotal,
          servico:servicoid ( id, codigo, descricao, precohora )
        `)
        .in("ordemservicoid", ordemIds);

      if (servicosError) throw servicosError;

      for (const s of servicos ?? []) {
        const osId = Number(s.ordemservicoid);
        const list = servicosByOrdem.get(osId) ?? [];
        list.push(s);
        servicosByOrdem.set(osId, list);
      }

      // Carregar Produtos
      const { data: produtos, error: produtosError } = await supabaseAdmin
        .from("osproduto")
        .select(`
          ordemservicoid,
          produtoid,
          quantidade,
          precounitario,
          subtotal,
          produto:produtoid ( id, titulo, referencia )
        `)
        .in("ordemservicoid", ordemIds);

      if (produtosError) throw produtosError;

      for (const p of produtos ?? []) {
        const osId = Number(p.ordemservicoid);
        const list = produtosByOrdem.get(osId) ?? [];
        list.push(p);
        produtosByOrdem.set(osId, list);
      }
    }

    const realizadoresByServico = new Map<string, any[]>();
    if (ordemIds.length > 0) {
      const { data: realizadores, error: realizadoresError } = await supabaseAdmin
        .from("osservico_realizador")
        .select(
          `
            ordemservicoid,
            servicoid,
            usuarioid,
            status_execucao,
            iniciado_em,
            finalizado_em,
            observacao_execucao,
            usuario:usuarioid ( id, nome )
          `
        )
        .in("ordemservicoid", ordemIds);

      if (realizadoresError) throw realizadoresError;

      for (const realizador of realizadores ?? []) {
        const key = `${Number((realizador as any).ordemservicoid)}:${Number((realizador as any).servicoid)}`;
        const list = realizadoresByServico.get(key) ?? [];
        list.push(realizador);
        realizadoresByServico.set(key, list);
      }
    }

    const items = ordensRaw.map((row: any) => {
      const cliente = one<any>(row.cliente);
      const veiculo = one<any>(row.veiculo);
      const peca = one<any>(row.peca);
      const setor = one<any>(row.setor);
      const osId = Number(row.id);

      const servicos = (servicosByOrdem.get(osId) ?? []).map((servico: any) => {
        const servicoId = Number(servico.servicoid);
        const key = `${osId}:${servicoId}`;
        const realizadores = (realizadoresByServico.get(key) ?? []).map((realizador: any) => {
          const usuario = one<any>(realizador.usuario);
          return {
            id: String(realizador.usuarioid),
            nome: usuario?.nome ?? null,
            statusExecucao: realizador.status_execucao ?? "PENDENTE",
            iniciadoEm: realizador.iniciado_em ?? null,
            finalizadoEm: realizador.finalizado_em ?? null,
            observacao: realizador.observacao_execucao ?? null,
            meu: String(realizador.usuarioid) === session.userId,
          };
        });

        const minhaExecucao = realizadores.find((realizador) => realizador.meu) ?? null;

        return {
          ordemservicoid: osId,
          servicoid: servicoId,
          descricao: servico.servico?.descricao ?? servico.descricao ?? "Servico",
          observacao: (servico.descricao && servico.descricao !== servico.servico?.descricao)
            ? (servico.descricao as string)
            : null,
          quantidade: toNumber(servico.quantidade),
          precounitario: toNumber(servico.precounitario),
          subtotal: toNumber(servico.subtotal),
          realizadores,
          minhaExecucao,
        };
      });

      const totalServicos = servicos.length;
      const servicosFinalizados = servicos.filter((servico) =>
        servico.realizadores.length > 0 &&
        servico.realizadores.every((realizador: any) => realizador.statusExecucao === "FINALIZADO")
      ).length;

      const produtos = (produtosByOrdem.get(osId) ?? []).map((p: any) => ({
        id: Number(p.produtoid),
        titulo: p.produto?.titulo ?? "Produto",
        quantidade: toNumber(p.quantidade),
        subtotal: toNumber(p.subtotal),
      }));

      return {
        id: osId,
        descricao: row.descricao ?? "",
        prioridade: row.prioridade ?? "NORMAL",
        status: row.status ?? null,
        dataEntrada: row.dataentrada ?? null,
        dataSaida: row.datasaida ?? null,
        execucaoInicioEm: row.execucao_inicio_em ?? null,
        execucaoFimEm: row.execucao_fim_em ?? null,
        orcamentoTotal: toNumber(row.orcamentototal),
        alvoTipo: row.alvo_tipo ?? "VEICULO",
        cliente: cliente
          ? { id: Number(cliente.id), nome: cliente.nomerazaosocial ?? "", telefone: cliente.telefone ?? null }
          : null,
        veiculo: veiculo
          ? { id: Number(veiculo.id), placa: veiculo.placa ?? null, modelo: veiculo.modelo ?? null, marca: veiculo.marca ?? null }
          : null,
        peca: peca
          ? { id: Number(peca.id), titulo: peca.titulo ?? "", descricao: peca.descricao ?? null, lacre: peca.lacre ?? null }
          : null,
        setor: setor ? { id: Number(setor.id), nome: setor.nome ?? "" } : null,
        progresso: { totalServicos, servicosFinalizados },
        servicos,
        produtos,
      };
    });

    return NextResponse.json(
      {
        setorId: session.setorId,
        userId: session.userId,
        items,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    console.error("GET /api/execucao/ordens", error);
    return NextResponse.json(
      { error: error?.message ?? "Falha ao listar ordens para execucao" },
      { status: 500 }
    );
  }
}
