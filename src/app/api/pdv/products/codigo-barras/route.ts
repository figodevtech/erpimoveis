export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireVendasAccess } from '@/app/api/_authz/perms';
import { variantesGtin } from '@/lib/gtin';
import { classificarProdutosLidos } from '@/lib/leitor-codigo-barras';

// Os mesmos campos que o catalogo do PDV devolve, para o item lido entrar no
// carrinho exatamente como entraria pelo botao "Adicionar".
const CAMPOS = `
  id, titulo, descricao, precovenda, estoque, estoqueminimo, unidade, referencia, codigobarras,
  ncm, cfop, fabricante, grupo_produto_id, status_estoque, exibirPdv, tituloMarketplace,
  descricaoMarketplace, imgUrl, grupo:produtogrupo(id, nome, descricao, ativo, exibirPdv)
`;

/**
 * GET /api/pdv/products/codigo-barras?codigo=7891234567895
 * Busca exata pelo codigo de barras lido no PDV (leitor ou camera). A checagem
 * de estoque fica no cliente, que sabe quanto do item ja esta no carrinho.
 */
export async function GET(req: Request) {
  try {
    await requireVendasAccess();
    const codigo = (new URL(req.url).searchParams.get('codigo') ?? '').replace(/\D/g, '');

    if (codigo.length < 8 || codigo.length > 14) {
      return NextResponse.json({ error: 'Código de barras inválido.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('produto')
      .select(CAMPOS)
      .eq('is_deleted', false)
      .in('codigobarras', variantesGtin(codigo))
      .order('id', { ascending: true })
      .limit(10);
    if (error) throw error;

    return NextResponse.json(classificarProdutosLidos((data ?? []) as any[]), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Erro ao buscar o código de barras' },
      { status: e?.statusCode ?? 500 },
    );
  }
}
