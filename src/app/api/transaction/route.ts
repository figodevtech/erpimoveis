export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { requireFinanceiroCreate, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";

const WRITABLE_FIELDS = new Set([
  "ordemservicoid",
  "vendaid",
  "descricao",
  "descricao_pagamento",
  "valor",
  "valorLiquido",
  "data",
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

const FORTALEZA_OFFSET = "-03:00";

const TRANSACAO_FIELDS =
  "id, descricao, descricao_pagamento, valor, valorLiquido, valor_base, valor_acrescimos, valor_descontos, adiantamento_id, eh_adiantamento, nomepagador, cpfcnpjpagador, pendente, data, competencia_em, ordemservicoid, vendaid, evento_financeiro_id, metodopagamento, categoria, categoria_id, plano_de_conta, plano_de_conta_id, centro_custo, centro_custo_id, tipo, cliente_id, fornecedor_id, banco_id, created_at, updated_at";

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

function distributeTotalByWeights(weights: number[], totalCents: number) {
  const weightTotal = weights.reduce((acc, value) => acc + value, 0);
  if (weightTotal <= 0) return weights.map(() => 0);

  let allocated = 0;

  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return totalCents - allocated;
    }

    const proportional = Math.floor((weight * totalCents) / weightTotal);
    allocated += proportional;
    return proportional;
  });
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
      case "data": {
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
  try {
    await requireFinanceirosAccess();
    const { searchParams } = new URL(req.url);
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limitRaw = searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20";
    const limit = Math.min(Math.max(Number(limitRaw), 1), 1000);
    const search = (searchParams.get("search") ?? searchParams.get("q") ?? "").trim().slice(0, 200);

    const tipo = (searchParams.get("tipo") ?? "").trim();
    const categoria = (searchParams.get("categoria") ?? "").trim();
    const categoriaId = toNumberOrNull(searchParams.get("categoriaId"));
    const ordemservicoid = searchParams.get("ordemservicoid");
    const vendaid = searchParams.get("vendaid");
    const metodo = (searchParams.get("metodo") ?? searchParams.get("metodopagamento") ?? "").trim();
    const bancoId = toNumberOrNull(searchParams.get("bancoId"));
    const planoContaId = toNumberOrNull(searchParams.get("planoContaId"));
    const centroCustoId = toNumberOrNull(searchParams.get("centroCustoId"));
    const clienteId = toNumberOrNull(searchParams.get("clienteId"));
    const pendenteBool = parseBooleanParam(searchParams.get("pendente"));
    const excluirEventosFinanceiros = parseBooleanParam(searchParams.get("excluirEventosFinanceiros"));
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Padrão: mais novo primeiro (extrato). "asc" serve às visões de contas a
    // pagar/receber, onde o que vence antes precisa aparecer antes.
    const ascending = (searchParams.get("ordem") ?? "desc").trim().toLowerCase() === "asc";
    // Allowlist: o nome vai direto para o ORDER BY, então nada de valor cru.
    const ordenarPorRaw = (searchParams.get("ordenarPor") ?? "data").trim();
    const ordenarPor = ORDENAVEIS.has(ordenarPorRaw) ? ordenarPorRaw : "data";

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
        fornecedor:fornecedor!transacao_fornecedor_id_fkey ( id, nomerazaosocial, nomefantasia, cpfcnpj )
        `,
        { count: "exact" }
      )
      .eq("is_deleted", false)
      // nullsFirst: false mantém linha sem competência sempre no fim, nos dois
      // sentidos — o padrão do Postgres inverte junto com a direção.
      .order(ordenarPor, { ascending, nullsFirst: false })
      // Desempate estável: sem ele, duas linhas do mesmo dia podem trocar de
      // lugar entre páginas e sumir/repetir na paginação.
      .order("id", { ascending })
      .range(from, to);

    if (search) query = query.ilike("descricao", `%${search}%`);
    if (ordemservicoid) query = query.eq("ordemservicoid", ordemservicoid);
    if (excluirEventosFinanceiros === true) query = query.is("evento_financeiro_id", null);
    if (vendaid) query = query.eq("vendaid", vendaid);
    if (tipo) query = query.eq("tipo", tipo);
    if (categoria) query = query.eq("categoria", categoria);
    if (categoriaId != null) query = query.eq("categoria_id", categoriaId);
    if (metodo) query = query.eq("metodopagamento", metodo);
    if (bancoId != null) query = query.eq("banco_id", bancoId);
    if (planoContaId != null) query = query.eq("plano_de_conta_id", planoContaId);
    if (centroCustoId != null) query = query.eq("centro_custo_id", centroCustoId);
    if (clienteId != null) query = query.eq("cliente_id", clienteId);
    if (pendenteBool !== null) query = query.eq("pendente", pendenteBool);
    if (dateFrom) query = query.gte("data", localDayStartToUtcIso(dateFrom));
    if (dateTo) query = query.lt("data", localNextDayStartToUtcIso(dateTo));

    const { data, error, count } = await query;
    if (error) throw error;

    const items = data ?? [];
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
        ordem: ascending ? "asc" : "desc",
        ordenarPor,
      },
    });
  } catch (error: any) {
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
      ? distributeTotalByWeights(parcelasNetCents, valorTotalCents)
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
        .select("valor")
        .eq("vendaid", vendaId)
        .eq("tipo", "RECEITA")
        .eq("is_deleted", false);

      if (txErr) {
        return NextResponse.json({ error: "Erro ao somar pagamentos existentes da venda." }, { status: 500 });
      }

      preSumCents =
        transacoes?.reduce((acc, transacao) => {
          const cents = moneyToCents(transacao.valor as any) ?? 0;
          return acc + cents;
        }, 0) ?? 0;

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
    const rowsToInsert = (hasParcelamento ? parcelasDetalhadas : [{ valor: payload.valor, data: payload.data }]).map(
      (_, index) => {
        const pendenteLinha = hasParcelamento ? Boolean(payload.pendente) : payload.pendente;

        return {
          ...payload,
          descricao:
            totalParcelas > 1
              ? `${baseDescricao} - Parcela ${index + 1}/${totalParcelas}`
              : baseDescricao,
          valor: centsToNumber(parcelasGrossCents[index] ?? 0),
          valorLiquido: centsToNumber(parcelasNetCents[index] ?? parcelasGrossCents[index] ?? 0),
          data: hasParcelamento ? parcelasDetalhadas[index]?.data : payload.data,
          pendente: pendenteLinha,
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
      if ((error as any).code === "23503") {
        const msg = (error as any).message ?? "Violação de chave estrangeira. Verifique banco_id e cliente_id.";
        const detail = (error as any).details || (error as any).hint || "";
        const isBanco = /banco/i.test(msg + " " + detail);
        const isCliente = /cliente/i.test(msg + " " + detail);

        return NextResponse.json(
          {
            error: isBanco
              ? "Conta bancária (banco_id) inexistente."
              : isCliente
                ? "Cliente (cliente_id) inexistente."
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
