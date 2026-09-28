export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireVendasAccess } from '@/app/api/_authz/perms';
import { getProductSearchTokens } from '@/lib/product-search';

type Status = 'OK' | 'CRITICO' | 'BAIXO' | 'SEM_ESTOQUE';
const STATUS_SET = new Set<Status>(['OK', 'CRITICO', 'BAIXO', 'SEM_ESTOQUE']);

export async function GET(req: Request) {
  try {
    await requireVendasAccess();
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('search') ?? searchParams.get('q') ?? '').trim();
    const page = Math.max(1, Math.trunc(Number(searchParams.get('page') ?? 1)) || 1);
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(searchParams.get('limit') ?? 48)) || 48));
    const groupId = Number(searchParams.get('groupId'));
    const statusParam = (searchParams.get('status') ?? 'TODOS').toUpperCase();
    const statusFilter = STATUS_SET.has(statusParam as Status) ? statusParam as Status : null;

    const { data, error } = await supabaseAdmin.rpc('pdv_search_products', {
      p_tokens: getProductSearchTokens(q),
      p_page: page,
      p_limit: limit,
      p_group_id: Number.isInteger(groupId) && groupId > 0 ? groupId : null,
      p_status: statusFilter,
    });
    if (error) throw error;

    const items = data?.data ?? [];
    const total = Number(data?.total ?? 0);
    const from = (page - 1) * limit;
    return NextResponse.json({
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNextPage: from + items.length < total,
      },
      filters: { search: q, groupId: Number.isInteger(groupId) ? groupId : null },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Erro ao listar produtos' },
      { status: e?.statusCode ?? 500 },
    );
  }
}
