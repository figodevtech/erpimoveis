// app/api/customers/status-counter/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type ProductRow = { status_estoque: 'OK' | 'BAIXO' | 'CRITICO' | null };

export async function GET() {
  try {
    const listPromise = supabaseAdmin
      .from('produto')
      .select('status_estoque')
      .eq('is_deleted', false)
      .returns<ProductRow[]>();

    const totalPromise = supabaseAdmin
      .from('produto')
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', false);

    const [{ data, error }, { count, error: countError }] = await Promise.all([
      listPromise,
      totalPromise,
    ]);

    if (error) throw error;
    if (countError) throw countError;

    const countsByStatus = (data ?? []).reduce<Record<string, number>>(
      (acc, row) => {
        const key = String(row.status_estoque ?? 'NULL');
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      { OK: 0, BAIXO: 0, CRITICO: 0 }
    );

    return NextResponse.json(
      {
        countsByStatus,
        totalProducts: count ?? 0,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Erro ao contar produtos por status' },
      { status: 500 }
    );
  }
}
