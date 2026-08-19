export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireDashboardAccess } from "@/app/api/_authz/perms";
import { saldoEmAberto } from "@/lib/financeiro/transacao";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const FORTALEZA_OFFSET = "-03:00";

function todayLocalYYYYMMDD() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countBy<T extends Record<string, any>>(rows: T[], key: keyof T) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] ?? "Não informado");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function sumBy<T>(rows: T[], selector: (row: T) => unknown) {
  return rows.reduce((acc, row) => acc + toNumber(selector(row)), 0);
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function topFromMap(map: Record<string, number>, limit = 5) {
  return Object.entries(map)
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function latest<T extends Record<string, any>>(rows: T[], dateField: keyof T, limit = 6) {
  return [...rows]
    .sort((a, b) => new Date(String(b[dateField] ?? 0)).getTime() - new Date(String(a[dateField] ?? 0)).getTime())
    .slice(0, limit);
}

export async function GET(req: Request) {
  try {
    await requireDashboardAccess();

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date")?.trim() || todayLocalYYYYMMDD();
    const startIso = localDayStartToUtcIso(date);
    const endIso = localNextDayStartToUtcIso(date);

    const [
      osCriadasRes,
      osConcluidasRes,
      vendasRes,
      transacoesRes,
      clientesRes,
      agendamentosRes,
      produtosRes,
      entradasRes,
      nfeRes,
      nfseRes,
    ] = await Promise.all([
      supabaseAdmin
        .from("ordemservico")
        .select(
          "id, status, descricao, orcamentototal, dataentrada, datasaida, cliente:clienteid ( nomerazaosocial ), veiculo:veiculoid ( placa, modelo )",
        )
        .gte("dataentrada", startIso)
        .lt("dataentrada", endIso)
        .order("dataentrada", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("ordemservico")
        .select("id, status, descricao, orcamentototal, dataentrada, datasaida")
        .gte("datasaida", startIso)
        .lt("datasaida", endIso)
        .order("datasaida", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("venda")
        .select(
          "id, status, valortotal, datavenda, forma_pagamento, canal, cliente:clienteid ( nomerazaosocial ), vendedor_rel:vendedor ( nome )",
        )
        .gte("datavenda", startIso)
        .lt("datavenda", endIso)
        .order("datavenda", { ascending: false })
        .limit(80),
      supabaseAdmin
        .from("transacao")
        .select("id, descricao, valor, valorLiquido, valor_descontos, valor_baixado, data, metodopagamento, categoria, tipo, pendente, created_at")
        .gte("data", startIso)
        .lt("data", endIso)
        .eq("is_deleted", false)
        /*
         * A baixa parcial é o dinheiro de um título que também está aqui. Contar
         * as duas linhas somaria o mesmo recebimento duas vezes no resumo do dia.
         * Fica o título, que é o que a pessoa reconhece na lista.
         */
        .is("baixa_de_transacao_id", null)
        .order("data", { ascending: false })
        .limit(120),
      supabaseAdmin
        .from("cliente")
        .select("id, nomerazaosocial, cidade, estado, status, createdat")
        .gte("createdat", startIso)
        .lt("createdat", endIso)
        .eq("is_deleted", false)
        .order("createdat", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("agendamento")
        .select(
          "id, titulo, status, origem, inicio, fim, solicitante_nome, createdat, cliente:clienteid ( nomerazaosocial ), veiculo:veiculoid ( placa, modelo )",
        )
        .gte("createdat", startIso)
        .lt("createdat", endIso)
        .order("createdat", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("produto")
        .select("id, titulo, estoque, estoqueminimo, status_estoque, createdat")
        .gte("createdat", startIso)
        .lt("createdat", endIso)
        .eq("is_deleted", false)
        .order("createdat", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("entrada")
        .select("id, tipo, status, fiscal, notachave, created_at, fornecedor:fornecedorid ( nomerazaosocial )")
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("nfe")
        .select("id, status, modelo, numero, total_nfe, dataemissao, ordemservicoid, vendaid")
        .gte("dataemissao", startIso)
        .lt("dataemissao", endIso)
        .eq("is_deleted", false)
        .order("dataemissao", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("nfse")
        .select("id, status, numero, valor_total, dataemissao, ordemservicoid")
        .gte("dataemissao", startIso)
        .lt("dataemissao", endIso)
        .order("dataemissao", { ascending: false })
        .limit(50),
    ]);

    const errors = [
      osCriadasRes.error,
      osConcluidasRes.error,
      vendasRes.error,
      transacoesRes.error,
      clientesRes.error,
      agendamentosRes.error,
      produtosRes.error,
      entradasRes.error,
      nfeRes.error,
      nfseRes.error,
    ].filter(Boolean);

    if (errors.length > 0) throw errors[0];

    const osCriadas = osCriadasRes.data ?? [];
    const osConcluidas = osConcluidasRes.data ?? [];
    const vendas = vendasRes.data ?? [];
    const transacoes = transacoesRes.data ?? [];
    const clientes = clientesRes.data ?? [];
    const agendamentos = agendamentosRes.data ?? [];
    const produtos = produtosRes.data ?? [];
    const entradas = entradasRes.data ?? [];
    const nfes = nfeRes.data ?? [];
    const nfses = nfseRes.data ?? [];

    let receita = 0;
    let despesa = 0;
    let receitaPendente = 0;
    const financeiroPorCategoria: Record<string, { receita: number; despesa: number }> = {};

    for (const transacao of transacoes as any[]) {
      const tipo = String(transacao.tipo ?? "").toUpperCase();
      const valor = toNumber(transacao.valorLiquido ?? transacao.valor);
      const pendente = transacao.pendente === true;
      const categoria = String(transacao.categoria ?? "Não informado");

      if (pendente) {
        // Em aberto é o que falta: um título já pago pela metade não tem o valor
        // cheio a receber.
        if (tipo === "RECEITA") receitaPendente += saldoEmAberto(transacao);
        continue;
      }

      const bucket = financeiroPorCategoria[categoria] ?? { receita: 0, despesa: 0 };
      financeiroPorCategoria[categoria] = bucket;

      if (tipo === "RECEITA") {
        receita += valor;
        bucket.receita += valor;
      }
      if (tipo === "DESPESA") {
        despesa += valor;
        bucket.despesa += valor;
      }
    }

    const clienteCidadeMap = clientes.reduce<Record<string, number>>((acc: Record<string, number>, cliente: any) => {
      const cidade = [cliente.cidade, cliente.estado].filter(Boolean).join(" / ") || "Não informado";
      acc[cidade] = (acc[cidade] ?? 0) + 1;
      return acc;
    }, {});

    const movimentacoes =
      osCriadas.length +
      osConcluidas.length +
      vendas.length +
      transacoes.length +
      clientes.length +
      agendamentos.length +
      produtos.length +
      entradas.length +
      nfes.length +
      nfses.length;

    return NextResponse.json(
      {
        periodo: { date, inicio: startIso, fim: endIso },
        kpis: {
          movimentacoes,
          receita,
          despesa,
          saldo: receita - despesa,
          osCriadas: osCriadas.length,
          vendas: vendas.length,
          clientesNovos: clientes.length,
          agendamentos: agendamentos.length,
        },
        ordens: {
          criadas: osCriadas.length,
          concluidas: osConcluidas.length,
          valorOrcado: sumBy(osCriadas as any[], (row) => row.orcamentototal),
          porStatus: countBy(osCriadas as any[], "status"),
          recentes: latest(osCriadas as any[], "dataentrada").map((row: any) => {
            const cliente = relationOne(row.cliente);
            const veiculo = relationOne(row.veiculo);
            return {
              id: row.id,
              status: row.status,
              descricao: row.descricao,
              valor: toNumber(row.orcamentototal),
              horario: row.dataentrada,
              cliente: cliente?.nomerazaosocial ?? null,
              veiculo: [veiculo?.placa, veiculo?.modelo].filter(Boolean).join(" - ") || null,
            };
          }),
        },
        vendas: {
          total: vendas.length,
          valorTotal: sumBy(vendas as any[], (row) => row.valortotal),
          ticketMedio: vendas.length ? sumBy(vendas as any[], (row) => row.valortotal) / vendas.length : 0,
          porStatus: countBy(vendas as any[], "status"),
          porCanal: countBy(vendas as any[], "canal"),
          recentes: latest(vendas as any[], "datavenda").map((row: any) => {
            const cliente = relationOne(row.cliente);
            const vendedor = relationOne(row.vendedor_rel);
            return {
              id: row.id,
              status: row.status,
              valor: toNumber(row.valortotal),
              horario: row.datavenda,
              cliente: cliente?.nomerazaosocial ?? null,
              vendedor: vendedor?.nome ?? null,
              formaPagamento: row.forma_pagamento ?? null,
            };
          }),
        },
        financeiro: {
          receitas: receita,
          despesas: despesa,
          saldo: receita - despesa,
          receitaPendente,
          transacoes: transacoes.length,
          porTipo: countBy(transacoes as any[], "tipo"),
          porCategoria: Object.entries(financeiroPorCategoria)
            .map(([categoria, valores]) => ({ categoria, ...valores }))
            .sort((a, b) => b.receita + b.despesa - (a.receita + a.despesa)),
          recentes: latest(transacoes as any[], "data").map((row: any) => ({
            id: row.id,
            tipo: row.tipo,
            descricao: row.descricao,
            valor: toNumber(row.valorLiquido ?? row.valor),
            horario: row.created_at,
            dataFinanceira: row.data,
            categoria: row.categoria ?? null,
            metodo: row.metodopagamento ?? null,
            pendente: row.pendente === true,
          })),
        },
        clientes: {
          novos: clientes.length,
          porStatus: countBy(clientes as any[], "status"),
          topCidades: topFromMap(clienteCidadeMap),
          recentes: latest(clientes as any[], "createdat").map((row: any) => ({
            id: row.id,
            nome: row.nomerazaosocial,
            status: row.status,
            horario: row.createdat,
            local: [row.cidade, row.estado].filter(Boolean).join(" / ") || null,
          })),
        },
        agendamentos: {
          total: agendamentos.length,
          porStatus: countBy(agendamentos as any[], "status"),
          itens: (agendamentos as any[]).map((row) => {
            const cliente = relationOne(row.cliente);
            const veiculo = relationOne(row.veiculo);
            return {
              id: row.id,
              titulo: row.titulo,
              status: row.status,
              origem: row.origem,
              horario: row.createdat,
              inicio: row.inicio,
              fim: row.fim,
              cliente: cliente?.nomerazaosocial ?? row.solicitante_nome ?? null,
              veiculo: [veiculo?.placa, veiculo?.modelo].filter(Boolean).join(" - ") || null,
            };
          }),
        },
        estoque: {
          produtosNovos: produtos.length,
          entradas: entradas.length,
          produtosPorStatus: countBy(produtos as any[], "status_estoque"),
          produtos: latest(produtos as any[], "createdat").map((row: any) => ({
            id: row.id,
            titulo: row.titulo,
            estoque: row.estoque,
            estoqueMinimo: row.estoqueminimo,
            status: row.status_estoque,
            horario: row.createdat,
          })),
          entradasRecentes: latest(entradas as any[], "created_at").map((row: any) => {
            const fornecedor = relationOne(row.fornecedor);
            return {
              id: row.id,
              tipo: row.tipo,
              status: row.status,
              fiscal: row.fiscal === true,
              notaChave: row.notachave ?? null,
              horario: row.created_at,
              fornecedor: fornecedor?.nomerazaosocial ?? null,
            };
          }),
        },
        fiscal: {
          nfe: nfes.length,
          nfse: nfses.length,
          valorNfe: sumBy(nfes as any[], (row) => row.total_nfe),
          valorNfse: sumBy(nfses as any[], (row) => row.valor_total),
          nfePorStatus: countBy(nfes as any[], "status"),
          nfsePorStatus: countBy(nfses as any[], "status"),
          recentes: [
            ...(nfes as any[]).map((row) => ({
              id: row.id,
              tipo: "NFe",
              status: row.status,
              numero: row.numero,
              valor: toNumber(row.total_nfe),
              horario: row.dataemissao,
              ordemservicoid: row.ordemservicoid ?? null,
              vendaid: row.vendaid ?? null,
              origem: row.vendaid ? `Venda #${row.vendaid}` : row.ordemservicoid ? `OS #${row.ordemservicoid}` : null,
            })),
            ...(nfses as any[]).map((row) => ({
              id: row.id,
              tipo: "NFSe",
              status: row.status,
              numero: row.numero,
              valor: toNumber(row.valor_total),
              horario: row.dataemissao,
              ordemservicoid: row.ordemservicoid ?? null,
              vendaid: null,
              origem: row.ordemservicoid ? `OS #${row.ordemservicoid}` : null,
            })),
          ]
            .sort((a, b) => new Date(b.horario ?? 0).getTime() - new Date(a.horario ?? 0).getTime())
            .slice(0, 8),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = error?.statusCode ?? (/autenticado|permiss/i.test(error?.message) ? 403 : 500);
    return NextResponse.json(
      { error: error?.message ?? "Erro ao gerar resumo diário" },
      { status },
    );
  }
}
