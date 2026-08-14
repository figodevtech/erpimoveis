// app/api/ordens/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { StatusOS } from "@/app/(app)/(pages)/ordens/types";
import { requireOSAccess } from "@/app/api/_authz/perms";
import { carregarAutores } from "@/lib/movement-authors";

type Prioridade = "ALTA" | "NORMAL" | "BAIXA" | null;
type AlvoTipo = "VEICULO" | "PECA" | "EQUIPAMENTO" | null;

const PRIORIDADES = ["ALTA", "NORMAL", "BAIXA"];
const ALVOS = ["VEICULO", "PECA", "EQUIPAMENTO"];

/** Ordenar o pai por uma coluna do embed exige PostgREST >= 10. */
const COLUNA_SETOR_POR_NOME = "setor(nome)";

/**
 * Colunas de ordenacao aceitas pela lista de OS.
 *
 * `prioridade` e `status` sao enums: o Postgres ordena pela ordem de declaracao,
 * e em `enum_prioridade_os` (BAIXA, NORMAL, ALTA) isso coincide com a régua usada
 * na tela. `tempo` nao existe como coluna — para OS em aberto, ficar ha mais tempo
 * na oficina e exatamente ter entrado antes, entao invertemos a data de entrada.
 */
const ORDENACOES: Record<string, { coluna: string; inverter?: boolean }> = {
  entrada: { coluna: "dataentrada" },
  saida: { coluna: "datasaida" },
  status: { coluna: "status" },
  prioridade: { coluna: "prioridade" },
  setor: { coluna: COLUNA_SETOR_POR_NOME },
  tempo: { coluna: "dataentrada", inverter: true },
  concluido: { coluna: "pagamento_concluido_em" },
};

function parseStatuses(param?: string | null): StatusOS[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as StatusOS[];
}

export async function GET(req: Request) {
  try {
    await requireOSAccess();
    const { searchParams } = new URL(req.url);


    const status = (searchParams.get("status") as StatusOS) || "TODAS";
    const statuses = parseStatuses(searchParams.get("statuses"));
    const q = searchParams.get("q")?.trim() || "";
    const cliente = searchParams.get("cliente")?.trim() || "";
    const notaNumero = searchParams.get("notaNumero")?.trim() || "";
    const dateFrom = searchParams.get("dateFrom")?.trim() || "";
    const dateTo = searchParams.get("dateTo")?.trim() || "";
    const apenasMinhas = ["1", "true", "yes"].includes(
      (searchParams.get("apenasMinhas") ?? "").trim().toLowerCase()
    );
    const prioridadeParam = (searchParams.get("prioridade") ?? "").trim().toUpperCase();
    const prioridade = PRIORIDADES.includes(prioridadeParam) ? prioridadeParam : "";
    const setor = searchParams.get("setor")?.trim() || "";
    const alvoTipoParam = (searchParams.get("alvoTipo") ?? "").trim().toUpperCase();
    const alvoTipo = ALVOS.includes(alvoTipoParam) ? alvoTipoParam : "";
    const sort = searchParams.get("sort")?.trim() || "";
    const dir = searchParams.get("dir")?.trim().toLowerCase() === "asc" ? "asc" : "desc";

    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10), 1), 200);
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const emptyResponse = () =>
      NextResponse.json({
        items: [],
        page,
        limit,
        total: 0,
        totalPages: 1,
        pageCount: 0,
      });

    // Filtros que dependem de outra tabela sao resolvidos antes de montar a query,
    // porque a ordenacao por setor pode exigir uma segunda tentativa.
    let usuarioCriadorId: string | null = null;
    if (apenasMinhas) {
      // "Minhas ordens": o dono vem da sessao, nunca de um id enviado pelo cliente.
      const session = await auth();
      const usuarioId = (session?.user as any)?.id as string | undefined;
      if (!usuarioId) return emptyResponse();
      usuarioCriadorId = usuarioId;
    }

    let clienteIds: number[] | null = null;
    if (cliente) {
      const { data: clientesData, error: clientesError } = await supabaseAdmin
        .from("cliente")
        .select("id")
        .or(
          `nomerazaosocial.ilike.%${cliente}%,cpfcnpj.ilike.%${cliente}%,telefone.ilike.%${cliente}%`
        )
        .limit(200);

      if (clientesError) throw clientesError;

      clienteIds = (clientesData ?? []).map((item) => item.id);
      if (clienteIds.length === 0) return emptyResponse();
    }

    let notaOrdemIds: number[] | null = null;
    if (notaNumero) {
      const notaNumeroValue = Number(notaNumero.replace(/\D/g, ""));

      if (!Number.isFinite(notaNumeroValue)) {
        return emptyResponse();
      }

      const { data: notasData, error: notasError } = await supabaseAdmin
        .from("nfe")
        .select("ordemservicoid")
        .eq("numero", notaNumeroValue)
        .not("ordemservicoid", "is", null)
        .limit(200);

      if (notasError) throw notasError;

      notaOrdemIds = (notasData ?? [])
        .map((item) => item.ordemservicoid)
        .filter((value): value is number => Number.isFinite(Number(value)));

      if (notaOrdemIds.length === 0) return emptyResponse();
    }

    let setorIds: number[] | null = null;
    if (setor && setor !== "TODOS") {
      const setorIdNumerico = Number(setor);
      if (Number.isFinite(setorIdNumerico)) {
        setorIds = [Math.trunc(setorIdNumerico)];
      } else {
        // O seletor de setor cai para o nome quando /api/tipos/setores nao responde.
        const { data: setoresData, error: setoresError } = await supabaseAdmin
          .from("setor")
          .select("id")
          .ilike("nome", setor)
          .limit(50);

        if (setoresError) throw setoresError;

        setorIds = (setoresData ?? []).map((item) => Number(item.id));
        if (setorIds.length === 0) return emptyResponse();
      }
    }

    const construirQuery = (colunaOrdenacaoSetor: string) => {
      let query = supabaseAdmin
        .from("ordemservico")
        .select(
          `
          id,
          descricao,
          prioridade,
          orcamentototal,
          valor_frete,
          acrescimo_financeiro_tipo,
          acrescimo_financeiro_valor,
          status,
          dataentrada,
          datasaida,
          pagamento_concluido_em,
          destacada,
          destaque_motivo,
          destaque_cor,
          destacada_por,
          destacada_em,
          alvo_tipo,
          equipamento_nome,
          equipamento_patrimonio,
          equipamento_ano,
          equipamento_horimetro,

          cliente:clienteid (
            id,
            nomerazaosocial,
            telefone,
            email
          ),
          veiculo:veiculoid (
            id,
            placa,
            modelo,
            marca
          ),
          peca:pecaid (
            id,
            titulo,
            descricao
          ),
          setor:setorid (
            id,
            nome
          ),

          transacoes:transacao!transacao_ordemservicoid_fkey (
            id,
            descricao,
            valor,
            valorLiquido,
            data,
            metodopagamento,
            categoria,
            tipo,
            evento_financeiro_id,
            is_deleted,
            pendente,
            baixado_por,
            banco_id,
            nomepagador,
            cpfcnpjpagador,
            created_at,
            updated_at
          ),

          usuario:usuario!usuariocriadorid (id, nome),

          cFilter:clienteid(),
          vFilter:veiculoid(),
          pFilter:pecaid()
        `,
          { count: "exact" }
        )
        .range(from, to)
        .order("data", { foreignTable: "transacoes", ascending: false })
        .limit(50, { foreignTable: "transacoes" });

      // status (1 ou vários)
      if (status && status !== "TODAS") {
        query = query.eq("status", status);
      } else if (statuses.length > 0) {
        query = query.in("status", statuses);
      }

      if (usuarioCriadorId) {
        query = query.eq("usuariocriadorid", usuarioCriadorId);
      }

      if (dateFrom) {
        query = query.gte("dataentrada", `${dateFrom}T00:00:00.000Z`);
      }

      if (dateTo) {
        query = query.lte("dataentrada", `${dateTo}T23:59:59.999Z`);
      }

      if (clienteIds) {
        query = query.in("clienteid", clienteIds);
      }

      if (notaOrdemIds) {
        query = query.in("id", notaOrdemIds);
      }

      if (setorIds) {
        query = query.in("setorid", setorIds);
      }

      if (prioridade) {
        query = query.eq("prioridade", prioridade);
      }

      if (alvoTipo === "VEICULO") {
        // OS antigas nasceram sem alvo_tipo e sempre foram tratadas como veiculo.
        query = query.or("alvo_tipo.is.null,alvo_tipo.eq.VEICULO");
      } else if (alvoTipo) {
        query = query.eq("alvo_tipo", alvoTipo);
      }

      if (q) {
        const like = `%${q}%`;
        const onlyDigits = q.replace(/\D/g, "");

        // aplica filtros nos embeds (isso preenche cFilter/vFilter/pFilter quando casar)
        query = query.or(`nomerazaosocial.ilike.${like},telefone.ilike.${like},email.ilike.${like}`, {
          foreignTable: "cFilter",
        });
        query = query.or(`placa.ilike.${like},modelo.ilike.${like},marca.ilike.${like}`, {
          foreignTable: "vFilter",
        });
        query = query.or(`titulo.ilike.${like},descricao.ilike.${like}`, {
          foreignTable: "pFilter",
        });

        // agora faz OR no nível do pai:
        // - descricao bate OU
        // - algum embed "de filtro" não é null (porque passou no filtro acima)
        const topOr: string[] = [
          `descricao.ilike.${like}`,
          `equipamento_nome.ilike.${like}`,
          `equipamento_patrimonio.ilike.${like}`,
          `cFilter.not.is.null`,
          `vFilter.not.is.null`,
          `pFilter.not.is.null`,
        ];
        if (onlyDigits) topOr.push(`id.eq.${Number(onlyDigits)}`);

        query = query.or(topOr.join(","));
      }

      const ordenacao = ORDENACOES[sort];
      if (ordenacao) {
        const coluna = sort === "setor" ? colunaOrdenacaoSetor : ordenacao.coluna;
        const ascendente = ordenacao.inverter ? dir !== "asc" : dir === "asc";
        query = query.order(coluna, { ascending: ascendente, nullsFirst: false });
      } else if (status === "CONCLUIDO" || statuses.includes("CONCLUIDO")) {
        query = query.order("pagamento_concluido_em", { ascending: false, nullsFirst: false });
      } else {
        query = query.order("dataentrada", { ascending: false });
      }
      // Desempate estavel: sem ele a paginacao pode repetir/perder linhas.
      return query.order("id", { ascending: false });
    };

    let { data, error, count } = await construirQuery(COLUNA_SETOR_POR_NOME);
    if (error && sort === "setor") {
      // Ordenar o pai por coluna de embed exige PostgREST recente; se nao houver
      // suporte, agrupamos por setor usando a propria FK em vez de quebrar a lista.
      console.warn("[ordens] ordenacao por setor(nome) indisponivel, usando setorid:", error);
      ({ data, error, count } = await construirQuery("setorid"));
    }
    if (error) throw error;

    const items = (data ?? []).map((r: any) => ({
      id: r.id as number,
      descricao: (r.descricao as string) ?? "",
      prioridade: (r.prioridade as Prioridade) ?? null,
      status: r.status as Exclude<StatusOS, "TODAS">,
      dataEntrada: r.dataentrada as string | null,
      orcamentototal: r.orcamentototal as number | null,
      valor_frete: r.valor_frete as number | null,
      acrescimo_financeiro_tipo: r.acrescimo_financeiro_tipo as "FIXO" | "PORCENTAGEM" | null,
      acrescimo_financeiro_valor: r.acrescimo_financeiro_valor as number | null,
      dataSaida: r.datasaida as string | null,
      pagamentoConcluidoEm: r.pagamento_concluido_em as string | null,
      destacada: Boolean(r.destacada),
      destaque_motivo: (r.destaque_motivo as string | null) ?? null,
      destaque_cor: (r.destaque_cor as string | null) ?? "vermelho",
      destacada_por: (r.destacada_por as string | null) ?? null,
      destacada_em: (r.destacada_em as string | null) ?? null,
      notaNumero: null as number | null,

      alvo_tipo: (r.alvo_tipo as AlvoTipo) ?? null,

      responsavel: (r.usuario)
      ?{
        id: r.usuario.id as string,
        nome: r.usuario.nome as string,

      }: null,

      cliente: r.cliente
        ? {
            id: r.cliente.id as number,
            nome: r.cliente.nomerazaosocial as string,
            telefone: (r.cliente.telefone as string | null) ?? null,
            email: (r.cliente.email as string | null) ?? null,
          }
        : null,

      veiculo: r.veiculo
        ? {
            id: r.veiculo.id as number,
            placa: r.veiculo.placa as string,
            modelo: r.veiculo.modelo as string,
            marca: r.veiculo.marca as string,
          }
        : null,

      peca: r.peca
        ? {
            id: r.peca.id as number,
            titulo: r.peca.titulo as string,
            descricao: (r.peca.descricao as string | null) ?? null,
          }
        : null,

      equipamento: r.alvo_tipo === "EQUIPAMENTO" && r.equipamento_nome
        ? {
            nome: r.equipamento_nome as string,
            patrimonio: (r.equipamento_patrimonio as string | null) ?? null,
            ano: (r.equipamento_ano as number | null) ?? null,
            horimetro: (r.equipamento_horimetro as number | null) ?? null,
          }
        : null,

      setor: r.setor
        ? {
            id: r.setor.id as number,
            nome: r.setor.nome as string,
          }
        : null,

      transacoes: (r.transacoes ?? []).map((t: any) => ({
        id: Number(t.id),
        descricao: t.descricao as string,
        valor: Number(t.valor),
        // Pagamento por maquineta guarda o liquido separado; a lista mostra os
        // dois para a taxa de recebimento nao sumir do total pago.
        valorLiquido: t.valorLiquido == null ? null : Number(t.valorLiquido),
        data: t.data as string,
        metodoPagamento: t.metodopagamento as string,
        categoria: t.categoria as string,
        tipo: t.tipo as string,
        // A lista usa estes campos para somar apenas os recebimentos reais da OS.
        evento_financeiro_id: (t.evento_financeiro_id as number | null) ?? null,
        is_deleted: Boolean(t.is_deleted),
        pendente: Boolean(t.pendente),
        baixado_por: (t.baixado_por as string | null) ?? null,
        baixadoPor: null as { id: string; nome: string | null } | null,
        bancoId: Number(t.banco_id),
        pagador: { nome: t.nomepagador as string, cpfcnpj: t.cpfcnpjpagador as string },
        createdAt: t.created_at as string,
        updatedAt: t.updated_at as string,
      })),
    }));

    const autores = await carregarAutores(
      items.flatMap((item) => item.transacoes.map((t: any) => t.baixado_por)),
    );
    for (const item of items) {
      for (const transacao of item.transacoes as any[]) {
        transacao.baixadoPor = autores.get(String(transacao.baixado_por ?? "")) ?? null;
      }
    }

    const ordemIds = items.map((item) => item.id).filter(Boolean);

    // Pagamento múltiplo não preenche `ordemservicoid` — a transação cobre
    // várias OS e o elo é o rateio. Sem juntar as fatias aqui, a OS paga em
    // grupo aparece com total pago zero mesmo estando concluída.
    if (ordemIds.length > 0) {
      const { data: rateio, error: rateioError } = await supabaseAdmin
        .from("pagamento_multiplo_rateio")
        .select(
          "documento_id, valor, transacao:transacao_id ( id, descricao, data, metodopagamento, categoria, pendente, is_deleted )",
        )
        .eq("tipo_documento", "OS")
        .in("documento_id", ordemIds);
      if (rateioError) throw rateioError;

      const fatiasPorOrdem = new Map<number, any[]>();
      for (const linha of (rateio ?? []) as any[]) {
        const transacao = linha.transacao;
        if (!transacao || transacao.is_deleted) continue;

        const ordemId = Number(linha.documento_id);
        const lista = fatiasPorOrdem.get(ordemId) ?? [];
        lista.push({
          id: Number(transacao.id),
          descricao: String(transacao.descricao ?? ""),
          // A fatia é o que coube a ESTA OS; o valor da linha é o recebimento
          // inteiro, que pertence a várias.
          valor: Number(linha.valor ?? 0),
          valorLiquido: Number(linha.valor ?? 0),
          data: transacao.data,
          metodoPagamento: transacao.metodopagamento,
          categoria: transacao.categoria,
          tipo: "RECEITA",
          evento_financeiro_id: null,
          is_deleted: false,
          pendente: Boolean(transacao.pendente),
          baixado_por: null,
          baixadoPor: null,
          rateado: true,
        });
        fatiasPorOrdem.set(ordemId, lista);
      }

      for (const item of items as any[]) {
        const fatias = fatiasPorOrdem.get(Number(item.id));
        if (fatias?.length) item.transacoes = [...(item.transacoes ?? []), ...fatias];
      }
    }

    if (ordemIds.length > 0) {
      const { data: notasData, error: notasError } = await supabaseAdmin
        .from("nfe")
        .select("ordemservicoid, numero, createdat")
        .in("ordemservicoid", ordemIds)
        .not("ordemservicoid", "is", null)
        .order("numero", { ascending: false });

      if (notasError) throw notasError;

      const notaPorOrdem = new Map<number, number>();

      for (const nota of notasData ?? []) {
        const ordemId = Number((nota as any).ordemservicoid);
        const numero = Number((nota as any).numero);

        if (!Number.isFinite(ordemId) || !Number.isFinite(numero)) continue;
        if (notaPorOrdem.has(ordemId)) continue;

        notaPorOrdem.set(ordemId, numero);
      }

      items.forEach((item) => {
        item.notaNumero = notaPorOrdem.get(item.id) ?? null;
      });
    }

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageCount = items.length;

    return NextResponse.json({ items, page, limit, total, totalPages, pageCount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao listar OS" }, { status: 500 });
  }
}
