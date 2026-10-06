export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { requireFinanceiroCreate, requireFinanceirosAccess, requireVendasAccess } from "@/app/api/_authz/perms";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { distribuirPorPesos } from "@/lib/financeiro/rateio";
import { somarRecebimentosDeFace } from "@/lib/financeiro/recebimentos-do-documento";
import { aplicarCamposDocumento, erroDeDocumento } from "./_lib/documento";
import { aplicarCamposBandeira, erroDeBandeira, resolverBandeira } from "./_lib/bandeira";
import { filtroDeBusca } from "./_lib/busca";
import {
  aplicarRecorteDeAutoria,
  criterioDeAlteracao,
  leApenasMinhas,
  recorteDeAutoria,
} from "./_lib/autoria";
import { hasOSAccess, hasVendasAccess } from "@/app/api/_authz/perms";
import { erroDeBancoNoLancamento } from "@/lib/financeiro/banco-lancamento";
import { reportErpDiagnostic } from "@/lib/monitoring/erp-diagnostic";

const WRITABLE_FIELDS = new Set([
  "ordemservicoid",
  "vendaid",
  "descricao",
  "descricao_pagamento",
  "valor",
  "valorLiquido",
  "data",
  /*
   * Competência do lançamento avulso, informada já no cadastro.
   *
   * Ela é o que decide o mês da DRE — `data` é vencimento/caixa. Até aqui o
   * campo só existia na edição, então uma conta de luz de julho lançada em
   * agosto nascia com competência de agosto e alguém precisava voltar depois
   * para corrigir. No Demir isso já tinha acontecido 610 vezes.
   *
   * Vale só para lançamento avulso. Quando a transação nasce de uma OS, de uma
   * venda ou da baixa de um evento, a competência é do documento — a regra é a
   * mesma que a edição aplica, e a checagem está logo abaixo, no POST.
   */
  "competencia_em",
  "metodopagamento",
  "categoria",
  "categoria_id",
  "plano_de_conta",
  "plano_de_conta_id",
  "centro_custo",
  "centro_custo_id",
  "tipo",
  "cliente_id",
  "fornecedor_id",
  "banco_id",
  "nomepagador",
  "cpfcnpjpagador",
  "pendente",
  "evento_financeiro_id",
]);

/**
 * Tipos aceitos no filtro `tipos` (lista separada por vírgula).
 *
 * Allowlist porque o valor vai para um `in(...)`: o que não for tipo conhecido
 * é descartado em silêncio, e uma lista que sobrou vazia não filtra nada — o
 * contrário faria a tela vir vazia sem explicar por quê.
 */
const TIPOS_TRANSACAO = new Set(["RECEITA", "DESPESA", "DEPOSITO", "SAQUE"]);

function TIPOS_VALIDOS(bruto: string | null): string[] {
  return String(bruto ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => TIPOS_TRANSACAO.has(item));
}

/** Colunas aceitas em `ordenarPor`. Ver `CampoOrdenacao` no fluxo de caixa. */
const ORDENAVEIS = new Set([
  "descricao",
  "competencia_em",
  "data",
  "tipo",
  "categoria",
  "metodopagamento",
  "valor",
]);

/**
 * Valores aceitos em `vinculo`. Mesma lista da exportação, que já filtrava por
 * origem do lançamento; qualquer outra coisa não filtra nada.
 */
const VINCULOS = new Set(["OS", "VENDA", "EVENTO", "AVULSO"]);

const FORTALEZA_OFFSET = "-03:00";

const TRANSACAO_FIELDS =
  "id, descricao, descricao_pagamento, valor, valorLiquido, valor_base, valor_acrescimos, valor_descontos, valor_baixado, baixa_de_transacao_id, transferencia_id, adiantamento_id, eh_adiantamento, pagamento_multiplo_id, nomepagador, cpfcnpjpagador, pendente, data, competencia_em, ordemservicoid, vendaid, evento_financeiro_id, metodopagamento, categoria, categoria_id, plano_de_conta, plano_de_conta_id, centro_custo, centro_custo_id, tipo, cliente_id, fornecedor_id, banco_id, documento_tipo_id, documento_numero, documento_serie, documento_chave, documento_emitido_em, documento_valor, documento_observacao, bandeira_id, bandeira_parcelas, bandeira_taxa_percentual, bandeira_taxa_ajustada, abonado, abonado_por, abonado_em, abono_motivo, created_by, created_at, updated_at";

const BANCO_FIELDS =
  "id, titulo, tipo, agencia, contanumero, proprietario, valorinicial, empresa_id, created_at, updated_at";

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(dateStr: string) {
  const day = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(day.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function toNullIfEmpty(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

function toNumberOrNull(value: any) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateISOStringOrNull(value: any) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseBooleanParam(value: string | null): boolean | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return null;
}

function moneyToCents(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Math.round(value * 100);
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function centsToNumber(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function brl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function sanitizeParcelasDetalhadas(raw: any) {
  if (!Array.isArray(raw)) return [];

  return raw.map((parcela, index) => {
    const valor = toNumberOrNull(parcela?.valor);
    const data = toDateISOStringOrNull(parcela?.data);

    if (valor == null || valor <= 0) {
      throw new Error(`Valor inválido na parcela ${index + 1}.`);
    }

    if (!data) {
      throw new Error(`Data inválida na parcela ${index + 1}.`);
    }

    return { valor, data };
  });
}

function sanitizeTransacaoPayload(body: any, { strict }: { strict: boolean }) {
  const output: Record<string, any> = {};

  for (const key of Object.keys(body ?? {})) {
    if (!WRITABLE_FIELDS.has(key)) continue;

    switch (key) {
      case "valor":
      case "valorLiquido":
      case "banco_id": {
        output[key] = toNumberOrNull(body[key]);
        break;
      }
      case "cliente_id":
      case "fornecedor_id":
      case "ordemservicoid":
      case "vendaid":
      case "categoria_id":
      case "plano_de_conta_id":
      case "centro_custo_id":
      case "evento_financeiro_id": {
        const parsed = toNumberOrNull(body[key]);
        output[key] = parsed == null ? null : Math.trunc(parsed);
        break;
      }
      case "data":
      case "competencia_em": {
        output[key] = toDateISOStringOrNull(body[key]);
        break;
      }
      case "pendente": {
        const parsed = parseBooleanParam(String(body[key]));
        output[key] = parsed ?? body[key];
        break;
      }
      default: {
        output[key] = toNullIfEmpty(body[key]);
      }
    }
  }

  // Fora do laço porque os campos de documento não estão em WRITABLE_FIELDS: a
  // coerção deles é própria (dia sem fuso, valor não negativo, texto com teto) e
  // vive compartilhada com a rota de pagamento de OS.
  aplicarCamposDocumento(body, output);

  // Mesma razao: os campos de bandeira tem coercao propria e o percentual nem
  // vem do cliente — ele e derivado da tabela da bandeira em `resolverBandeira`.
  aplicarCamposBandeira(body, output);

  if (strict) {
    const required = ["descricao", "valor", "data", "tipo"];
    const missing = required.filter((key) => output[key] == null);

    if (missing.length) {
      throw new Error(`Campos obrigatórios ausentes: ${missing.join(", ")}`);
    }
  }

  const nowIso = new Date().toISOString();
  if (strict) output.created_at = nowIso;
  if (output.pendente == null) output.pendente = false;
  output.updated_at = nowIso;

  return output;
}

export async function GET(req: Request) {
  const diagnosticStartedAt = Date.now();
  let diagnosticStage: "QUERY_TRANSACTIONS" | undefined;
  try {
    await requireFinanceirosAccess();
    const { searchParams } = new URL(req.url);
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limitRaw = searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20";
    const limit = Math.min(Math.max(Number(limitRaw), 1), 1000);
    const search = (searchParams.get("search") ?? searchParams.get("q") ?? "").trim().slice(0, 200);

    const tipo = (searchParams.get("tipo") ?? "").trim();
    /*
     * `tipos` (lista) existe porque "a receber" e "a pagar" não são um tipo só.
     *
     * Entrada de dinheiro é RECEITA *ou* DEPOSITO; saída é DESPESA *ou* SAQUE —
     * é assim que os KPIs desta mesma tela já somam. Enquanto as abas filtravam
     * por um tipo só, um DEPOSITO ou SAQUE ainda pendente não cabia em aba
     * nenhuma: Fluxo e Liquidadas exigem `pendente = false`, e as outras duas
     * forçavam RECEITA ou DESPESA. A transação existia e não tinha como ser
     * aberta, editada ou excluída pela tela.
     */
    const tipos = TIPOS_VALIDOS(searchParams.get("tipos"));
    const categoria = (searchParams.get("categoria") ?? "").trim();
    const categoriaId = toNumberOrNull(searchParams.get("categoriaId"));
    const ordemservicoid = searchParams.get("ordemservicoid");
    const vendaid = searchParams.get("vendaid");
    const metodo = (searchParams.get("metodo") ?? searchParams.get("metodopagamento") ?? "").trim();
    const bancoId = toNumberOrNull(searchParams.get("bancoId"));
    /*
     * `comBanco=true` restringe ao que de fato passou por uma conta.
     *
     * Não basta filtrar por liquidadas: título quitado por antecipação fica
     * pendente=false e banco_id nulo de propósito — o dinheiro entrou pela
     * antecipação, não por ele. Sem esta separação, o extrato mistura os títulos
     * com o lançamento que os pagou e soma o mesmo dinheiro duas vezes.
     */
    const comBanco = parseBooleanParam(searchParams.get("comBanco"));
    const planoContaId = toNumberOrNull(searchParams.get("planoContaId"));
    const centroCustoId = toNumberOrNull(searchParams.get("centroCustoId"));
    const clienteId = toNumberOrNull(searchParams.get("clienteId"));
    const pendenteBool = parseBooleanParam(searchParams.get("pendente"));
    const excluirEventosFinanceiros = parseBooleanParam(searchParams.get("excluirEventosFinanceiros"));
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const nomePagador = (searchParams.get("nomePagador") ?? "").trim().slice(0, 120);
    const documentoPagador = (searchParams.get("documentoPagador") ?? "").trim().slice(0, 40);
    /*
     * Faixa de valor, sobre o BRUTO — e é de propósito.
     *
     * O número que a conciliação bancária compara não é `valor`: é o líquido
     * efetivo na linha já liquidada (venda no cartão entra na conta menos a taxa)
     * e o saldo em aberto no título pago em partes. Nenhum dos dois é coluna —
     * são um CASE sobre `valor`, `valorLiquido`, `valor_descontos` e
     * `valor_baixado` —, e o PostgREST não filtra por expressão.
     *
     * Mas taxa e baixa parcial só descem: vale sempre `valor >= líquido >= saldo`.
     * Então `valorMin` no bruto NUNCA descarta um candidato válido, e corta todo
     * o resto. No caso comum — sem taxa, sem baixa parcial — `valor` é o próprio
     * alvo, e `valorMin = valorMax` acha na primeira página.
     *
     * Quem for "corrigir" isto para `valorLiquido` some com as vendas no cartão
     * da busca, que são exatamente as que mais precisam ser encontradas.
     */
    const valorMin = toNumberOrNull(searchParams.get("valorMin"));
    const valorMax = toNumberOrNull(searchParams.get("valorMax"));
    const vinculoRaw = (searchParams.get("vinculo") ?? "").trim().toUpperCase();
    const vinculo = VINCULOS.has(vinculoRaw) ? vinculoRaw : "";
    /*
     * `incluirBaixas=true` traz de volta as baixas parciais sem exigir `comBanco`.
     *
     * A regra logo abaixo esconde a baixa parcial de qualquer visão que não seja
     * o extrato, para o mesmo dinheiro não aparecer duas vezes. Na busca da
     * conciliação isso tornava inalcançável uma linha que existe de verdade e
     * pode ser a correspondência procurada — quem busca uma transação específica
     * quer achá-la, não somar coluna nenhuma.
     */
    const incluirBaixas = parseBooleanParam(searchParams.get("incluirBaixas"));
    /*
     * Quem nao tem `financeiro:ver_todas_transacoes` so ve o que criou — e o
     * que nao tem dono, que e quase todo o historico. O parametro nao decide
     * nada nesse caso: quem nao pode ver tudo nao ganha uma chave para desligar
     * o proprio limite. Para quem tem a permissao, ele e o recorte opcional.
     */
    const apenasMinhas = leApenasMinhas(searchParams.get("apenasMinhas"));
    /*
     * A lista de UMA OS ou de UMA venda nao sofre o recorte: e o que as telas de
     * Pagamento de Ordens e de Vendas pedem, e ali todo pagamento do documento
     * aparece, de quem quer que seja — o mesmo que a aba Financeiro da OS
     * mostra. Alterar continua preso ao dono (`pode_alterar` em cada linha).
     */
    const listaDeUmDocumento =
      !apenasMinhas &&
      ((Boolean(ordemservicoid) && (await hasOSAccess())) ||
        (Boolean(vendaid) && (await hasVendasAccess())));
    const recorte = listaDeUmDocumento
      ? { restrito: false, usuarioId: null }
      : await recorteDeAutoria(apenasMinhas);

    // Padrão: mais novo primeiro (extrato). "asc" serve às visões de contas a
    // pagar/receber, onde o que vence antes precisa aparecer antes.
    const ascending = (searchParams.get("ordem") ?? "desc").trim().toLowerCase() === "asc";
    // Allowlist: o nome vai direto para o ORDER BY, então nada de valor cru.
    const ordenarPorRaw = (searchParams.get("ordenarPor") ?? "data").trim();
    const ordenarPor = ORDENAVEIS.has(ordenarPorRaw) ? ordenarPorRaw : "data";
    /*
     * Ordenar por "data" é ordenar pelo DIA do movimento, não pelo instante.
     *
     * `data` é timestamptz, e cada caminho de escrita grava uma hora diferente
     * para o mesmo dia: o lançamento avulso cai na meia-noite local, a baixa e a
     * transferência no meio-dia, a entrada à vista no instante real. Ordenando
     * pela coluna crua, um lançamento feito às 18h afundava para baixo de todas
     * as baixas daquele dia. `data_dia` achata as três no mesmo dia e deixa a
     * ordem de dentro do dia para o desempate, que é o registro.
     */
    const colunaDeOrdem = ordenarPor === "data" ? "data_dia" : ordenarPor;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from("transacao")
      .select(
        `
        ${TRANSACAO_FIELDS},
        banco:bancoconta!transacao_banco_id_fkey ( ${BANCO_FIELDS} ),
        categoria_dados:categoriatransacao!transacao_categoria_id_fkey ( id, nome, icone ),
        plano_de_conta_dados:planosdeconta!transacao_plano_de_conta_id_fkey ( id, codigo, nome ),
        centro_custo_dados:centrosdecusto!transacao_centro_custo_id_fkey ( id, nome, descricao, ativo ),
        bandeira_dados:bandeira_cartao!transacao_bandeira_id_fkey ( id, nome, metodopagamento ),
        fornecedor:fornecedor!transacao_fornecedor_id_fkey ( id, nomerazaosocial, nomefantasia, cpfcnpj ),
        pagamento_multiplo:pagamento_multiplo_id ( id, descricao, modo, valor_total, data ),
        criador:usuario!transacao_created_by_fkey ( id, nome )
        `,
        { count: "exact" }
      )
      .eq("is_deleted", false)
      // nullsFirst: false mantém linha sem competência sempre no fim, nos dois
      // sentidos — o padrão do Postgres inverte junto com a direção.
      .order(colunaDeOrdem, { ascending, nullsFirst: false })
      /*
       * Dentro do dia, a ordem é a de realização: o que foi registrado por
       * último aparece por primeiro.
       *
       * O desempate por `id` sozinho não dizia isso. Numa baixa, `id` é o do
       * TÍTULO, criado quando a venda ou a OS nasceu — dar baixa hoje num título
       * do mês passado jogava a linha para o fim do dia de hoje.
       */
      .order("movimento_registrado_em", { ascending })
      // Desempate estável: sem ele, duas linhas do mesmo dia podem trocar de
      // lugar entre páginas e sumir/repetir na paginação.
      .order("id", { ascending })
      .range(from, to);

    const buscaEm = filtroDeBusca(search);
    if (buscaEm) query = query.or(buscaEm);
    if (ordemservicoid) query = query.eq("ordemservicoid", ordemservicoid);
    if (excluirEventosFinanceiros === true) query = query.is("evento_financeiro_id", null);
    if (vendaid) query = query.eq("vendaid", vendaid);
    // `tipos` tem precedência: quem manda a lista está na aba que agrupa dois
    // tipos, e o dropdown de tipo único fica desabilitado nessas abas.
    if (tipos.length > 0) query = query.in("tipo", tipos);
    else if (tipo) query = query.eq("tipo", tipo);
    if (categoria) query = query.eq("categoria", categoria);
    if (categoriaId != null) query = query.eq("categoria_id", categoriaId);
    if (metodo) query = query.eq("metodopagamento", metodo);
    if (bancoId != null) query = query.eq("banco_id", bancoId);
    if (comBanco === true) query = query.not("banco_id", "is", null);
    if (comBanco === false) query = query.is("banco_id", null);
    /*
     * As baixas parciais são movimento, não título.
     *
     * Elas pertencem ao extrato — e lá o filtro de banco já as inclui, deixando
     * de fora o título que elas pagaram. Nas demais visões o que interessa é a
     * obrigação: mostrar as duas coisas lado a lado repetiria o mesmo dinheiro
     * na tela e no total. Quem quiser ver os pagamentos de um título abre o
     * título.
     */
    if (comBanco !== true && incluirBaixas !== true) {
      query = query.is("baixa_de_transacao_id", null);
    }
    if (planoContaId != null) query = query.eq("plano_de_conta_id", planoContaId);
    if (centroCustoId != null) query = query.eq("centro_custo_id", centroCustoId);
    if (clienteId != null) query = query.eq("cliente_id", clienteId);
    if (pendenteBool !== null) query = query.eq("pendente", pendenteBool);
    if (dateFrom) query = query.gte("data", localDayStartToUtcIso(dateFrom));
    if (dateTo) query = query.lt("data", localNextDayStartToUtcIso(dateTo));
    if (nomePagador) query = query.ilike("nomepagador", `%${nomePagador}%`);
    if (documentoPagador) query = query.ilike("cpfcnpjpagador", `%${documentoPagador}%`);
    if (valorMin != null && valorMin >= 0) query = query.gte("valor", valorMin);
    if (valorMax != null && valorMax >= 0) query = query.lte("valor", valorMax);
    if (vinculo === "OS") query = query.not("ordemservicoid", "is", null);
    if (vinculo === "VENDA") query = query.not("vendaid", "is", null);
    if (vinculo === "EVENTO") query = query.not("evento_financeiro_id", "is", null);
    if (vinculo === "AVULSO") {
      query = query.is("ordemservicoid", null).is("vendaid", null).is("evento_financeiro_id", null);
    }
    // Depois da busca: as duas viram `or=` separados, e filtros de topo se
    // somam em AND — um nao anula o outro.
    query = aplicarRecorteDeAutoria(query, recorte);

    diagnosticStage = "QUERY_TRANSACTIONS";
    const { data, error, count } = await query;
    if (error) throw error;
    diagnosticStage = undefined;

    // A tela usa isto para abrir so para leitura a transacao de outra pessoa,
    // em vez de oferecer botoes que a rota recusa com 403.
    const podeAlterar = await criterioDeAlteracao();
    const items = (data ?? []).map((linha: any) => ({
      ...linha,
      pode_alterar: podeAlterar(linha.created_by ?? null),
    }));
    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json({
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        pageCount: items.length,
        hasPrevPage: page > 1,
        hasNextPage: page * limit < total,
      },
      filters: {
        search,
        tipo: tipo || null,
        tipos: tipos.length > 0 ? tipos : null,
        categoria: categoria || null,
        categoriaId: categoriaId ?? null,
        metodopagamento: metodo || null,
        bancoId: bancoId ?? null,
        planoContaId: planoContaId ?? null,
        centroCustoId: centroCustoId ?? null,
        clienteId: clienteId ?? null,
        pendente: pendenteBool,
        dateFrom: dateFrom ?? null,
        dateTo: dateTo ?? null,
        nomePagador: nomePagador || null,
        documentoPagador: documentoPagador || null,
        valorMin: valorMin ?? null,
        valorMax: valorMax ?? null,
        vinculo: vinculo || null,
        incluirBaixas,
        apenasMinhas: recorte.restrito,
        ordem: ascending ? "asc" : "desc",
        ordenarPor,
      },
    });
  } catch (error: any) {
    reportErpDiagnostic("/api/transaction", "LIST_TRANSACTIONS", diagnosticStartedAt, error, diagnosticStage);
    return NextResponse.json({ error: error?.message || "Erro ao listar transações" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireFinanceiroCreate();
    const session = await auth();
    // Quem registra um pagamento ja realizado e quem executou a baixa.
    // Nunca vem do corpo da requisicao: so a sessao autenticada define o autor.
    const baixadoPor = ((session?.user as any)?.id as string | undefined) ?? null;
    const body = (await req.json()) as any;
    const json = body?.newTransaction && typeof body.newTransaction === "object" ? body.newTransaction : body;

    if (!json || typeof json !== "object") {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
    }

    const payload = sanitizeTransacaoPayload(json, { strict: true });
    if (payload.evento_financeiro_id != null) {
      const { data: evento, error: eventoError } = await supabaseAdmin.from("eventos_financeiros")
        .select("source_type").eq("id", payload.evento_financeiro_id).maybeSingle();
      if (eventoError) throw eventoError;
      if (!evento) return NextResponse.json({ error: "Evento financeiro não encontrado." }, { status: 404 });
      if (evento.source_type === "VENDA") {
        await requireVendasAccess();
        await requireFinanceirosAccess();
      }
    }

    const problemaNoBanco = erroDeBancoNoLancamento(payload);
    if (problemaNoBanco) {
      return NextResponse.json({ error: problemaNoBanco }, { status: 400 });
    }

    const problemaNoDocumento = erroDeDocumento(payload);
    if (problemaNoDocumento) {
      return NextResponse.json({ error: problemaNoDocumento }, { status: 400 });
    }

    const problemaNaBandeira = erroDeBandeira(payload);
    if (problemaNaBandeira) {
      return NextResponse.json({ error: problemaNaBandeira }, { status: 400 });
    }

    /*
     * Competência de lançamento gerado por documento pertence ao documento.
     *
     * Uma receita de OS compete ao mês em que a ordem foi entregue, e a baixa de
     * um evento compete ao mês do evento; aceitar um mês digitado aqui faria a
     * DRE divergir do que o próprio documento diz sobre si. É a mesma regra que
     * `validarEdicaoDeTransacao` aplica na edição — repetida no cadastro porque
     * são caminhos independentes.
     */
    if (
      payload.competencia_em != null &&
      (payload.ordemservicoid != null ||
        payload.vendaid != null ||
        payload.evento_financeiro_id != null)
    ) {
      return NextResponse.json(
        {
          error:
            "Esta transação é gerada por um documento; a competência acompanha o documento e não pode ser informada aqui.",
        },
        { status: 400 },
      );
    }

    if (payload.vendaid != null) {
      const { data: categoriaSistema, error: categoriaError } = await supabaseAdmin
        .from("categoriatransacao")
        .select("id, nome")
        .eq("codigo_sistema", "VENDA")
        .eq("ativo", true)
        .maybeSingle();

      if (categoriaError) throw categoriaError;
      if (!categoriaSistema) {
        return NextResponse.json(
          { error: "A categoria de sistema para vendas não está configurada." },
          { status: 409 }
        );
      }

      payload.categoria_id = categoriaSistema.id;
      payload.categoria = categoriaSistema.nome;
    }
    const parcelasDetalhadas = sanitizeParcelasDetalhadas(body?.parcelasDetalhadas);
    if (payload.evento_financeiro_id != null && parcelasDetalhadas.length > 1) {
      return NextResponse.json({ error: "Um evento financeiro deve gerar uma única transação." }, { status: 400 });
    }
    const hasParcelamento = parcelasDetalhadas.length > 1;
    const totalParcelas = hasParcelamento ? parcelasDetalhadas.length : 1;
    const isReceita = typeof payload.tipo === "string" && payload.tipo.toUpperCase() === "RECEITA";

    let vendaId: number | null = null;
    let vendaTotalCents: number | null = null;
    let preSumCents: number | null = null;

    const valorTotalCents = moneyToCents(payload.valor as any);
    if (valorTotalCents == null || valorTotalCents <= 0) {
      return NextResponse.json({ error: "O valor da transação deve ser maior que zero." }, { status: 400 });
    }

    /*
     * A bandeira refaz a conta da taxa antes de o líquido ser lido.
     *
     * Precisa ser aqui, e não depois: `valorLiquidoTotalCents` é o número contra
     * o qual a soma das parcelas é conferida. Resolver a bandeira depois disso
     * deixaria a validação medindo o líquido que a tela mandou enquanto o banco
     * gravaria outro.
     */
    const bandeira = await resolverBandeira(payload, centsToNumber(valorTotalCents));
    if (!bandeira.ok) {
      return NextResponse.json({ error: bandeira.erro }, { status: bandeira.status });
    }
    if (bandeira.liquido != null) {
      payload.valorLiquido = bandeira.liquido;
    }

    const valorLiquidoTotalCents = moneyToCents(payload.valorLiquido as any) ?? valorTotalCents;
    const parcelasNetCents = hasParcelamento
      ? parcelasDetalhadas.map((parcela) => moneyToCents(parcela.valor as any) ?? 0)
      : [valorLiquidoTotalCents];
    const totalParcelasNetCents = parcelasNetCents.reduce((acc, value) => acc + value, 0);

    if (hasParcelamento && totalParcelasNetCents !== valorLiquidoTotalCents) {
      return NextResponse.json(
        {
          error:
            valorLiquidoTotalCents !== valorTotalCents
              ? "A soma das parcelas deve ser igual ao valor líquido informado."
              : "A soma das parcelas deve ser igual ao valor total informado.",
        },
        { status: 400 }
      );
    }

    const parcelasGrossCents = hasParcelamento
      ? distribuirPorPesos(parcelasNetCents, valorTotalCents)
      : [valorTotalCents];
    const totalNovoValorCents = parcelasGrossCents.reduce((acc, value) => acc + value, 0);

    if (payload.vendaid != null && isReceita) {
      vendaId = Number(payload.vendaid);

      const { data: venda, error: vendaErr } = await supabaseAdmin
        .from("venda")
        .select("id, valortotal, status, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
        .eq("id", vendaId)
        .maybeSingle();

      if (vendaErr) {
        return NextResponse.json({ error: "Erro ao buscar a venda vinculada." }, { status: 500 });
      }

      if (!venda) {
        return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
      }

      vendaTotalCents = moneyToCents(
        calculateFinancialTotal(
          venda.valortotal,
          venda.acrescimo_financeiro_tipo,
          venda.acrescimo_financeiro_valor,
        ),
      );
      if (vendaTotalCents == null || vendaTotalCents <= 0) {
        return NextResponse.json({ error: "A venda não possui valor válido para validação." }, { status: 409 });
      }

      if (totalNovoValorCents > vendaTotalCents) {
        return NextResponse.json(
          {
            error: `Pagamento único (${brl(totalNovoValorCents)}) ultrapassa o valor da venda (${brl(vendaTotalCents)}).`,
          },
          { status: 409 }
        );
      }

      const { data: transacoes, error: txErr } = await supabaseAdmin
        .from("transacao")
        .select("valor, valor_acrescimos")
        .eq("vendaid", vendaId)
        .eq("tipo", "RECEITA")
        // Mesmo recorte do caminho de OS e da view `recebimento_por_documento`:
        // juros e multa lançados como evento têm total próprio e não abatem a venda.
        .is("evento_financeiro_id", null)
        .eq("is_deleted", false);

      if (txErr) {
        return NextResponse.json({ error: "Erro ao somar pagamentos existentes da venda." }, { status: 500 });
      }

      preSumCents = somarRecebimentosDeFace(transacoes);

      const novoTotal = preSumCents + totalNovoValorCents;
      if (novoTotal > vendaTotalCents) {
        const restante = vendaTotalCents - preSumCents;
        return NextResponse.json(
          {
            error: `A soma dos pagamentos ultrapassa o valor da venda. Restante permitido: ${brl(Math.max(restante, 0))}.`,
          },
          { status: 409 }
        );
      }
    }

    const baseDescricao = String(payload.descricao ?? "").trim();

    /*
     * Parcelamento avulso nasce com grupo formal.
     *
     * Sem ele as parcelas só se reconhecem pela descrição e pela `created_at`, e
     * em cima dessa heurística não dá para escrever: basta alguém editar uma
     * descrição para o grupo vir pela metade. Com documento de origem o grupo já
     * é a OS ou a venda, e quem redistribui valores ali é o rateio.
     */
    let parcelamentoId: number | null = null;

    if (
      hasParcelamento &&
      payload.ordemservicoid == null &&
      payload.vendaid == null &&
      payload.evento_financeiro_id == null
    ) {
      const { data: grupo, error: grupoError } = await supabaseAdmin
        .from("transacao_parcelamento")
        .insert({ descricao: baseDescricao, created_by: baixadoPor })
        .select("id")
        .single();

      if (grupoError) throw grupoError;
      parcelamentoId = Number(grupo.id);
    }

    // O documento vem no spread do payload e por isso se repete em toda parcela.
    // É o que se quer: uma nota paga em três vezes continua sendo uma nota só, e
    // cada parcela precisa apontar para ela.
    const rowsToInsert = (hasParcelamento ? parcelasDetalhadas : [{ valor: payload.valor, data: payload.data }]).map(
      (_, index) => {
        const pendenteLinha = hasParcelamento ? Boolean(payload.pendente) : payload.pendente;

        return {
          ...payload,
          ...(parcelamentoId != null ? { parcelamento_id: parcelamentoId } : {}),
          descricao:
            totalParcelas > 1
              ? `${baseDescricao} - Parcela ${index + 1}/${totalParcelas}`
              : baseDescricao,
          valor: centsToNumber(parcelasGrossCents[index] ?? 0),
          valorLiquido: centsToNumber(parcelasNetCents[index] ?? parcelasGrossCents[index] ?? 0),
          data: hasParcelamento ? parcelasDetalhadas[index]?.data : payload.data,
          pendente: pendenteLinha,
          // Quem criou a linha, sempre — inclusive na parcela que nasce
          // pendente e ainda nem tem baixa. E o que a listagem usa para saber
          // de quem e cada transacao, e o que a aba Historico mostra em
          // "Criada por", ate aqui vazia para todo lancamento avulso.
          // Fora de WRITABLE_FIELDS de proposito: autor nao vem do corpo.
          created_by: baixadoPor,
          // Parcela pendente ainda sera baixada depois, por baixar_transacao_pendente.
          baixado_por: pendenteLinha ? null : baixadoPor,
        };
      }
    );

    const { data, error } = await supabaseAdmin
      .from("transacao")
      .insert(rowsToInsert)
      .select(
        `
        ${TRANSACAO_FIELDS},
        banco:bancoconta!transacao_banco_id_fkey ( ${BANCO_FIELDS} ),
        categoria_dados:categoriatransacao!transacao_categoria_id_fkey ( id, nome, icone ),
        plano_de_conta_dados:planosdeconta!transacao_plano_de_conta_id_fkey ( id, codigo, nome ),
        centro_custo_dados:centrosdecusto!transacao_centro_custo_id_fkey ( id, nome, descricao, ativo ),
        bandeira_dados:bandeira_cartao!transacao_bandeira_id_fkey ( id, nome, metodopagamento ),
        fornecedor:fornecedor!transacao_fornecedor_id_fkey ( id, nomerazaosocial, nomefantasia, cpfcnpj )
        `
      );

    // A taxa de recebimento deixou de ser a diferenca implicita entre bruto e
    // liquido e passou a ser uma linha com nome. O switch da tela continua
    // pedindo o liquido; a linha nasce aqui, para o lancamento ja aparecer
    // classificado na aba de acrescimos e descontos.
    //
    // Falha aqui nao derruba a criacao: a transacao ja existe e esta correta nos
    // valores — o gatilho mantem bruto e liquido coerentes de qualquer forma.
    // Perder a linha e perder o rotulo, nao o dinheiro.
    if (!error && Array.isArray(data) && data.length) {
      try {
        const { data: tipoTaxa } = await supabaseAdmin
          .from("tipos_ajuste_transacao")
          .select("id")
          .eq("codigo_sistema", "TAXA_RECEBIMENTO")
          .maybeSingle();

        if (tipoTaxa) {
          const linhas = data
            .map((linha: any) => {
              const bruto = Math.round(Number(linha.valor ?? 0) * 100);
              const liquido = Math.round(Number(linha.valorLiquido ?? 0) * 100);
              const taxa = bruto - liquido;
              if (liquido <= 0 || taxa <= 0) return null;
              return {
                transacao_id: linha.id,
                tipo_id: tipoTaxa.id,
                natureza: "DESCONTO",
                modo: "FIXO",
                valor_informado: taxa / 100,
                valor_calculado: taxa / 100,
              };
            })
            .filter(Boolean);

          if (linhas.length) {
            await supabaseAdmin.from("transacao_ajuste").insert(linhas as any[]);
          }
        }
      } catch {
        // Silencio proposital: ver comentario acima.
      }
    }

    if (error) {
      // As parcelas não entraram: o grupo criado logo acima ficaria sem nenhuma
      // linha apontando para ele. Ninguém o veria, mas é lixo com id reservado.
      if (parcelamentoId != null) {
        await supabaseAdmin.from("transacao_parcelamento").delete().eq("id", parcelamentoId);
      }

      if ((error as any).code === "23503") {
        const msg = (error as any).message ?? "Violação de chave estrangeira. Verifique banco_id e cliente_id.";
        const detail = (error as any).details || (error as any).hint || "";
        const isBanco = /banco/i.test(msg + " " + detail);
        const isCliente = /cliente/i.test(msg + " " + detail);
        const isDocumento = /documento/i.test(msg + " " + detail);

        return NextResponse.json(
          {
            error: isBanco
              ? "Conta bancária (banco_id) inexistente."
              : isCliente
                ? "Cliente (cliente_id) inexistente."
                : isDocumento
                  ? "Tipo de documento inexistente."
                  : "Referência inválida: banco_id/cliente_id.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: (error as any).message ?? "Erro ao criar transação." }, { status: 500 });
    }

    const createdRows = data ?? [];
    const createdPayload = createdRows.length === 1 ? createdRows[0] : createdRows;

    if (vendaId != null && preSumCents != null && vendaTotalCents != null) {
      const novoTotal = preSumCents + totalNovoValorCents;
      if (novoTotal === vendaTotalCents) {
        const { error: updateErr } = await supabaseAdmin
          .from("venda")
          .update({
            status: "FINALIZADA",
            updatedat: new Date().toISOString(),
          })
          .eq("id", vendaId);

        if (updateErr) {
          console.error("Falha ao atualizar status da venda:", updateErr);
        }
      }
    }

    return NextResponse.json(
      { data: createdPayload, id: createdRows[0]?.id, count: createdRows.length },
      { status: 201 }
    );
  } catch (error: any) {
    const message = error?.message ?? "Erro ao criar transação. Verifique os campos obrigatórios e os tipos.";
    const isBadRequest =
      message.includes("Campos obrigatórios ausentes") ||
      message.toLowerCase().includes("obrigatório") ||
      message.toLowerCase().includes("inválido");

    return NextResponse.json({ error: message }, { status: isBadRequest ? 400 : 500 });
  }
}
