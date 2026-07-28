// src/app/api/pdv/products/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireVendasAccess } from '@/app/api/_authz/perms';
import { getProductSearchTokens, matchesProductSearch } from '@/lib/product-search';

/** Status de estoque (para filtros do GET) */
type Status = 'OK' | 'CRITICO' | 'BAIXO' | 'SEM_ESTOQUE';
const STATUS_SET = new Set<Status>(['OK', 'CRITICO', 'BAIXO', 'SEM_ESTOQUE']);

  // Uma pesquisa formada somente por conectivos (por exemplo, "de") ainda
  // deve funcionar literalmente em vez de retornar todo o catálogo.
const toPdvProduct = (product: any) => ({
  id: product.id,
  titulo: product.titulo,
  descricao: product.descricao,
  precovenda: product.precovenda,
  estoque: product.estoque,
  estoqueminimo: product.estoqueminimo,
  unidade: product.unidade,
  referencia: product.referencia,
  codigobarras: product.codigobarras,
  ncm: product.ncm,
  cfop: product.cfop,
  fabricante: product.fabricante,
  grupo_produto_id: product.grupo_produto_id,
  grupo: product.grupo,
  status_estoque: product.status_estoque,
  exibirPdv: product.exibirPdv,
  tituloMarketplace: product.tituloMarketplace,
  descricaoMarketplace: product.descricaoMarketplace,
  imgUrl: product.imgUrl,
});

/** Campos graváveis em produto */

/* ========================= GET (lista completa, sem paginação) ========================= */

export async function GET(req: Request) {
  try {
    await requireVendasAccess();
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get('search') ?? searchParams.get('q') ?? '').trim();
    const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 48) || 48));
    const groupId = Number(searchParams.get('groupId'));

    const statusParam = (searchParams.get('status') ?? 'TODOS').toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status)
      ? (statusParam as Status)
      : null;

    // O Postgres `ilike` diferencia acentos. Durante uma busca, percorremos os
    // produtos habilitados em blocos, normalizamos todos os campos escalares e
    // só então paginamos. Assim `oleo` encontra `óleo` sem perder a contagem.
    if (q) {
      const searchTokens = getProductSearchTokens(q);
      const batchSize = 1000;
      const searchableProducts: any[] = [];

      for (let from = 0; ; from += batchSize) {
        let searchQuery = supabaseAdmin
          .from('produto')
          .select('*, grupo:produtogrupo(id, nome, descricao, ativo)')
          .eq('exibirPdv', true)
          .order('id', { ascending: false })
          .range(from, from + batchSize - 1);

        if (Number.isInteger(groupId) && groupId > 0) {
          searchQuery = searchQuery.eq('grupo_produto_id', groupId);
        }
        if (statusFilter) {
          searchQuery = searchQuery.eq('status_estoque', statusFilter);
        }

        const { data: batch, error: batchError } = await searchQuery;
        if (batchError) throw batchError;
        searchableProducts.push(...(batch ?? []));
        if ((batch?.length ?? 0) < batchSize) break;
      }

      const matchedProducts = searchableProducts.filter((product) =>
        matchesProductSearch(product, searchTokens),
      );
      const total = matchedProducts.length;
      const pageFrom = (page - 1) * limit;
      const items = matchedProducts
        .slice(pageFrom, pageFrom + limit)
        .map(toPdvProduct);

      return NextResponse.json({
        data: items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          hasNextPage: pageFrom + items.length < total,
        },
        filters: { search: q, groupId: Number.isInteger(groupId) ? groupId : null },
      });
    }

    let query = supabaseAdmin
      .from('produto')
      .select(
        `
        id, titulo, descricao, precovenda, estoque, estoqueminimo, unidade, referencia, codigobarras, ncm, cfop, fabricante, grupo_produto_id, grupo: produtogrupo(id, nome, descricao, ativo), status_estoque, exibirPdv, tituloMarketplace, descricaoMarketplace, imgUrl
        `,
        { count: 'exact' }
      )
      .order('id', { ascending: false });

    if (q) {
      const safeQ = q.replace(/[,%()]/g, ' ').trim();
      const textColumns = [
        'titulo', 'descricao', 'referencia', 'fabricante', 'codigobarras',
        'ncm', 'cfop', 'origem_mercadoria', 'cst', 'cest', 'csosn',
        'cst_pis', 'cst_cofins', 'cst_ibscbs', 'cclass_trib', 'etiqueta',
        'local', 'tituloMarketplace', 'descricaoMarketplace',
      ];
      const filters = textColumns.map((column) => `${column}.ilike.%${safeQ}%`);
      const numericSearch = Number(q.replace(',', '.'));

      if (Number.isFinite(numericSearch)) {
        filters.push(
          `precovenda.eq.${numericSearch}`,
          `precocompra.eq.${numericSearch}`,
          `ultimovalordecompra.eq.${numericSearch}`,
          `aliquotaicms.eq.${numericSearch}`,
          `aliquota_pis.eq.${numericSearch}`,
          `aliquota_por_unidade_pis.eq.${numericSearch}`,
          `aliquota_cofins.eq.${numericSearch}`,
          `aliquota_por_unidade_cofins.eq.${numericSearch}`,
          `aliquota_ibs_uf.eq.${numericSearch}`,
          `aliquota_ibs_municipio.eq.${numericSearch}`,
          `aliquota_cbs.eq.${numericSearch}`,
        );
        if (Number.isInteger(numericSearch)) {
          filters.push(
            `id.eq.${numericSearch}`,
            `estoque.eq.${numericSearch}`,
            `estoqueminimo.eq.${numericSearch}`,
          );
        }
      }

      const normalizedEnum = safeQ.toUpperCase().replace(/\s+/g, '_');
      if (STATUS_SET.has(normalizedEnum as Status)) filters.push(`status_estoque.eq.${normalizedEnum}`);
      if (['UN', 'JGO', 'KIT', 'PAR', 'CX', 'PCT'].includes(normalizedEnum)) filters.push(`unidade.eq.${normalizedEnum}`);
      if (['NOVO', 'USADO', 'RECONDICIONADO'].includes(normalizedEnum)) filters.push(`conservacao.eq.${normalizedEnum}`);
      if (['PERCENTUAL', 'QUANTIDADE', 'NAO_TRIBUTADO'].includes(normalizedEnum)) {
        filters.push(`modo_pis.eq.${normalizedEnum}`, `modo_cofins.eq.${normalizedEnum}`);
      }
      if (['TRUE', 'FALSE'].includes(normalizedEnum)) {
        const booleanValue = normalizedEnum.toLowerCase();
        filters.push(`exibirPdv.eq.${booleanValue}`, `rtc_habilitado.eq.${booleanValue}`);
      }

      const { data: matchingGroups, error: groupsError } = await supabaseAdmin
        .from('produtogrupo')
        .select('id')
        .or(`nome.ilike.%${safeQ}%,descricao.ilike.%${safeQ}%`);
      if (groupsError) throw groupsError;
      const matchingGroupIds = (matchingGroups ?? []).map((group) => Number(group.id)).filter(Number.isFinite);
      if (matchingGroupIds.length > 0) {
        filters.push(`grupo_produto_id.in.(${matchingGroupIds.join(',')})`);
      }

      query = query.or(filters.join(','));
    }

    query = query.eq('exibirPdv', true);

    if (Number.isInteger(groupId) && groupId > 0) {
      query = query.eq('grupo_produto_id', groupId);
    }

    if (statusFilter) {
      query = query.eq('status_estoque', statusFilter);
    }

    const from = (page - 1) * limit;
    const { data, error, count } = await query.range(from, from + limit - 1);
    if (error) throw error;

    const items = data ?? [];

    return NextResponse.json({
      data: items,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
        hasNextPage: from + items.length < (count ?? 0),
      },
      filters: { search: q, groupId: Number.isInteger(groupId) ? groupId : null },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Erro ao listar produtos' },
      { status: e?.statusCode ?? 500 }
    );
  }
}

