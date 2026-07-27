// src/app/api/products/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireEstoqueAccess, requireEstoqueCreate } from "@/app/api/_authz/perms";
import { getProductSearchTokens, matchesProductSearch } from "@/lib/product-search";
import { registrarEntradaConfirmada } from "@/services/estoque/entradaService";

/** Status de estoque (para filtros do GET) */
type Status = 'OK' | 'CRITICO' | 'BAIXO' | 'SEM_ESTOQUE';
const STATUS_SET = new Set<Status>(['OK', 'CRITICO', 'BAIXO', 'SEM_ESTOQUE']);
const CONSERVACAO_SET = new Set(['NOVO', 'USADO', 'RECONDICIONADO']);

type ProductQueryFilters = {
  grupoId: number | null;
  conservacao: string;
  unidade: string;
  fabricante: string;
  local: string;
  exibirPdv: boolean | null;
  estoqueMin: number | null;
  estoqueMax: number | null;
  precoMin: number | null;
  precoMax: number | null;
};

function finiteNumber(value: string | null) {
  if (value == null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function applyProductFilters(query: any, filters: ProductQueryFilters) {
  if (filters.grupoId) query = query.eq('grupo_produto_id', filters.grupoId);
  if (filters.conservacao) query = query.eq('conservacao', filters.conservacao);
  if (filters.unidade) query = query.eq('unidade', filters.unidade);
  if (filters.fabricante) query = query.ilike('fabricante', `%${filters.fabricante}%`);
  if (filters.local) query = query.ilike('local', `%${filters.local}%`);
  if (filters.exibirPdv != null) query = query.eq('exibirPdv', filters.exibirPdv);
  if (filters.estoqueMin != null) query = query.gte('estoque', filters.estoqueMin);
  if (filters.estoqueMax != null) query = query.lte('estoque', filters.estoqueMax);
  if (filters.precoMin != null) query = query.gte('precovenda', filters.precoMin);
  if (filters.precoMax != null) query = query.lte('precovenda', filters.precoMax);
  return query;
}

/** Campos graváveis em produto */
const WRITABLE_FIELDS = new Set([
  'descricao',
  'precovenda',
  'precocompra',
  'ultimovalordecompra',
  'estoque',
  'estoqueminimo',
  'ncm',
  'cfop',
  'origem_mercadoria',
  'unidade',
  'cest',
  'csosn',
  'cst',
  'cst',
  'aliquotaicms',
  'cst_pis',
  'aliquota_pis',
  'modo_pis',
  'aliquota_por_unidade_pis',
  'cst_cofins',
  'aliquota_cofins',
  'modo_cofins',
  'aliquota_por_unidade_cofins',
  'rtc_habilitado',
  'cst_ibscbs',
  'cclass_trib',
  'aliquota_ibs_uf',
  'aliquota_ibs_municipio',
  'aliquota_cbs',
  'codigobarras',
  'etiqueta',
  'local',
  'referencia',
  'titulo',
  'fabricante',
  'grupo_produto_id',
  'exibirPdv',
  'tituloMarketplace',
  'descricaoMarketplace',
  'conservacao',
]);

/** Campos a retornar ao criar/listar/atualizar se quiser o objeto completo */
const PRODUTO_FIELDS =
  'id, descricao, titulo, referencia, precovenda, precocompra, ultimovalordecompra, estoque, estoqueminimo, unidade, ncm, cfop, origem_mercadoria, csosn, cst, cest, aliquotaicms, cst_pis, aliquota_pis, modo_pis, aliquota_por_unidade_pis, cst_cofins, aliquota_cofins, modo_cofins, aliquota_por_unidade_cofins, rtc_habilitado, cst_ibscbs, cclass_trib, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs, codigobarras, etiqueta, local, imgUrl, status_estoque, fabricante, grupo: produtogrupo(id, nome, descricao, ativo), grupo_produto_id, exibirPdv, tituloMarketplace, descricaoMarketplace, conservacao, createdat, updatedat';

function toNullIfEmpty(v: unknown) {
  return typeof v === 'string' && v.trim() === '' ? null : v;
}

function toNumberOrNull(v: any) {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toPositiveInt(v: unknown) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const PERCENTAGE_FIELDS = new Set([
  'aliquotaicms',
  'aliquota_pis',
  'aliquota_cofins',
  'aliquota_ibs_uf',
  'aliquota_ibs_municipio',
  'aliquota_cbs',
]);

/** Saneia e valida payload de produto */
function sanitizeProdutoPayload(body: any, { strict }: { strict: boolean }) {
  const out: Record<string, any> = {};

  for (const key of Object.keys(body ?? {})) {
    if (!WRITABLE_FIELDS.has(key)) continue;

    switch (key) {
      case 'precovenda':
      case 'precocompra':
      case 'ultimovalordecompra':
      case 'aliquotaicms':
      case 'aliquota_pis':
      case 'aliquota_por_unidade_pis':
      case 'aliquota_cofins':
      case 'aliquota_por_unidade_cofins':
      case 'aliquota_ibs_uf':
      case 'aliquota_ibs_municipio':
      case 'aliquota_cbs': {
        const number = toNumberOrNull(body[key]);
        if (number != null && number < 0) {
          throw new Error(`${key}: o valor não pode ser negativo.`);
        }
        if (number != null && PERCENTAGE_FIELDS.has(key) && number > 100) {
          throw new Error(`${key}: o percentual deve estar entre 0 e 100.`);
        }
        out[key] = number;
        break;
      }
      case 'estoque':
      case 'estoqueminimo': {
        const n = toNumberOrNull(body[key]);
        if (n != null && (!Number.isInteger(n) || n < 0)) {
          throw new Error(`${key}: informe um número inteiro maior ou igual a zero.`);
        }
        out[key] = n;
        break;
      }
      default: {
        out[key] = toNullIfEmpty(body[key]);
      }
    }
  }

  if (strict) {
    const required = ['titulo', 'precovenda', 'estoque', 'estoqueminimo',];
    const missing = required.filter((k) => out[k] == null);
    if (missing.length) {
      throw new Error(`Campos obrigatórios ausentes: ${missing.join(', ')}`);
    }
  }

  const nowIso = new Date().toISOString();
  // createdat só no POST (se já vier do cliente, ignoramos)
  if (strict) out.createdat = nowIso;
  out.updatedat = nowIso;

  return out;
}

/* ========================= GET (lista paginada) ========================= */

export async function GET(req: Request) {
  try {
    await requireEstoqueAccess();
    const { searchParams } = new URL(req.url);

    const page = Math.max(Number(searchParams.get('page') ?? 1), 1);
    const limitRaw =
      searchParams.get('limit') ?? searchParams.get('pageSize') ?? '20';
    const limit = Math.min(Math.max(Number(limitRaw), 1), 100);

    const q = (searchParams.get('search') ?? searchParams.get('q') ?? '').trim();

    const statusParam = (searchParams.get('status') ?? 'TODOS').toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status)
      ? (statusParam as Status)
      : null;
    const grupoId = toPositiveInt(searchParams.get('grupoId'));
    const conservacaoParam = (searchParams.get('conservacao') ?? '').toUpperCase();
    const exibirPdvParam = searchParams.get('exibirPdv');
    const productFilters: ProductQueryFilters = {
      grupoId,
      conservacao: CONSERVACAO_SET.has(conservacaoParam) ? conservacaoParam : '',
      unidade: (searchParams.get('unidade') ?? '').trim(),
      fabricante: (searchParams.get('fabricante') ?? '').trim(),
      local: (searchParams.get('local') ?? '').trim(),
      exibirPdv: exibirPdvParam === 'true' ? true : exibirPdvParam === 'false' ? false : null,
      estoqueMin: finiteNumber(searchParams.get('estoqueMin')),
      estoqueMax: finiteNumber(searchParams.get('estoqueMax')),
      precoMin: finiteNumber(searchParams.get('precoMin')),
      precoMax: finiteNumber(searchParams.get('precoMax')),
    };

    if (q) {
      const searchTokens = getProductSearchTokens(q);
      const batchSize = 1000;
      const searchableProducts: Record<string, unknown>[] = [];

      for (let batchFrom = 0; ; batchFrom += batchSize) {
        let searchQuery = supabaseAdmin
          .from('produto')
          .select(PRODUTO_FIELDS)
          .order('id', { ascending: false })
          .range(batchFrom, batchFrom + batchSize - 1);

        if (statusFilter) {
          searchQuery = searchQuery.eq('status_estoque', statusFilter);
        }
        searchQuery = applyProductFilters(searchQuery, productFilters);

        const { data: batch, error: batchError } = await searchQuery;
        if (batchError) throw batchError;
        searchableProducts.push(...((batch ?? []) as Record<string, unknown>[]));
        if ((batch?.length ?? 0) < batchSize) break;
      }

      const matchedProducts = searchableProducts.filter((product) =>
        matchesProductSearch(product, searchTokens),
      );
      const total = matchedProducts.length;
      const from = (page - 1) * limit;
      const items = matchedProducts.slice(from, from + limit);

      return NextResponse.json({
        data: items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          pageCount: items.length,
          hasPrevPage: page > 1,
          hasNextPage: page * limit < total,
        },
        filters: { search: q },
      });
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from('produto')
      .select(
        `
        id, titulo, precovenda, precocompra, ultimovalordecompra, estoque, estoqueminimo, unidade, referencia, codigobarras, etiqueta, local, imgUrl, status_estoque, fabricante, exibirPdv, conservacao
        `,
        { count: 'exact' }
      )
      .order('id', { ascending: false })
      .range(from, to);

    if (q) {
      query = query.or(
        `referencia.ilike.%${q}%,titulo.ilike.%${q}%,fabricante.ilike.%${q}%,codigobarras.ilike.%${q}%,etiqueta.ilike.%${q}%,local.ilike.%${q}%`
      );
    }

    if (statusFilter) {
      query = query.eq('status_estoque', statusFilter);
    }
    query = applyProductFilters(query, productFilters);

    const { data, error, count } = await query;
    if (error) throw error;

    const items = data ?? [];
    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const pageCount = items.length;
    const hasPrevPage = page > 1;
    const hasNextPage = page * limit < total;

    return NextResponse.json({
      data: items,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        pageCount,
        hasPrevPage,
        hasNextPage,
      },
      filters: { search: q },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Erro ao listar produtos' },
      { status: 500 }
    );
  }
}

/* ========================= POST (criar produto) ========================= */

export async function POST(req: Request) {
  try {
    await requireEstoqueCreate();
    const body = (await req.json()) as any;
    // Produto pode vir em body.newProduct ou direto no body
    const json =
      body?.newProduct && typeof body.newProduct === "object"
        ? body.newProduct
        : body;

    if (!json || typeof json !== "object") {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      );
    }

    // Dados para relação com fornecedorprodutos
    const fornecedorIdRaw =
      body.fornecedorId ??
      body.fornecedorid ??
      json.fornecedorId ??
      json.fornecedorid;

    const codigoFornecedor: string | undefined =
      body.codigoFornecedor ??
      body.codigofornecedor ??
      json.codigoFornecedor ??
      json.codigofornecedor;

    const ultimoValorDeCompraRaw =
      body.ultimoValorDeCompra ??
      body.ultimovalordecompra ??
      json.ultimoValorDeCompra ??
      json.ultimovalordecompra;

    const fornecedorId = fornecedorIdRaw ? Number(fornecedorIdRaw) : undefined;
    const ultimoValorDeCompra = toNumberOrNull(ultimoValorDeCompraRaw);
    const loteIdRaw = body.loteId ?? body.lote_id ?? json.loteId ?? json.lote_id;
    const loteId = loteIdRaw == null || loteIdRaw === "" ? null : toPositiveInt(loteIdRaw);

    if (loteIdRaw != null && loteIdRaw !== "" && !loteId) {
      return NextResponse.json({ error: "Lote inválido." }, { status: 400 });
    }

    const payload = sanitizeProdutoPayload(json, { strict: true });
    const estoqueInicial = Number(payload.estoque ?? 0);
    // O saldo deve nascer de uma entrada auditável, nunca diretamente do INSERT.
    payload.estoque = 0;

    // Deixe validações de ENUMs/constraints a cargo do banco (unidade, grupo, etc.)
    const { data, error } = await supabaseAdmin
      .from("produto")
      .insert(payload)
      .select(PRODUTO_FIELDS)
      .single();

    if (error) {
      // 23505 = unique_violation (ex.: se você criar UNIQUE em codigobarras)
      if ((error as any).code === "23505") {
        return NextResponse.json(
          { error: "Violação de unicidade (já cadastrado)." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: (error as any).message ?? "Erro ao criar produto." },
        { status: 500 }
      );
    }

    const warnings: string[] = [];

    if (estoqueInicial > 0) {
      try {
        await registrarEntradaConfirmada(
          {
            produto_id: data.id,
            quantidade: estoqueInicial,
            valor_unitario_compra:
              ultimoValorDeCompra ?? toNumberOrNull(payload.precocompra) ?? 0,
            fornecedorId: fornecedorId ?? null,
            entradaTipo: "COMPRA_FORNECEDOR",
            fiscal: false,
          },
          "AJUSTE_RAPIDO",
        );
      } catch (entradaError) {
        const { error: rollbackError } = await supabaseAdmin
          .from("produto")
          .delete()
          .eq("id", data.id);
        if (rollbackError) {
          console.error(
            "[POST /products] Falha ao remover produto após erro na entrada inicial:",
            rollbackError,
          );
        }
        throw new Error(
          `Não foi possível registrar o estoque inicial: ${
            entradaError instanceof Error ? entradaError.message : "erro desconhecido"
          }`,
        );
      }
    }

    if (loteId) {
      const { error: loteError } = await supabaseAdmin
        .from("lote_pecas")
        .insert({ lote_id: loteId, produto_id: data.id });

      if (loteError) {
        console.error("[POST /products] Erro ao vincular produto ao lote:", loteError);
        warnings.push("Não foi possível vincular o produto ao lote selecionado.");
      }
    }

    // Se veio fornecedorId + codigoFornecedor, cria vínculo em fornecedorprodutos
    if (fornecedorId && codigoFornecedor) {
      const vinculoPayload = {
        fornecedorid: fornecedorId,
        produtoid: data.id,
        codigofornecedor: String(codigoFornecedor),
        // Sem o último custo informado, usamos apenas o preço médio de compra.
        ultimovalordecompra:
          ultimoValorDeCompra != null
            ? ultimoValorDeCompra
            : toNumberOrNull(payload.precocompra),
      };

      const { error: relError } = await supabaseAdmin
        .from("fornecedorprodutos")
        .insert(vinculoPayload);

      if (relError) {
        console.error(
          "[POST /products] Erro ao criar vínculo fornecedorprodutos:",
          relError
        );
        warnings.push("Não foi possível vincular o produto ao fornecedor.");
      }
    }

    // 201 Created
    return NextResponse.json(
      {
        data: { ...data, estoque: estoqueInicial },
        id: data.id,
        warning: warnings.length > 0 ? `Produto criado, porém ${warnings.join(" ")}` : undefined,
      },
      { status: 201 },
    );
  } catch (e: any) {
    const msg =
      e?.message ??
      "Erro ao criar produto. Verifique os campos obrigatórios e os tipos.";
    const validationError = ["informe", "nao pode", "não pode", "percentual", "estoque inicial"]
      .some((term) => msg.toLowerCase().includes(term));
    const isBadReq = validationError ||
      msg.includes("Campos obrigatórios ausentes") ||
      msg.toLowerCase().includes("obrigatório");
    return NextResponse.json({ error: msg }, { status: isBadReq ? 400 : 500 });
  }
}

