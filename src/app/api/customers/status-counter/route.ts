// app/api/customers/status-counter/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const countStatus = (status: 'ATIVO' | 'INATIVO' | 'PENDENTE') =>
      supabaseAdmin
        .from('cliente')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .eq('status', status);

    const [ativo, inativo, pendente, semStatus, total] = await Promise.all([
      countStatus('ATIVO'),
      countStatus('INATIVO'),
      countStatus('PENDENTE'),
      supabaseAdmin.from('cliente').select('*', { count: 'exact', head: true }).eq('is_deleted', false).is('status', null),
      supabaseAdmin.from('cliente').select('*', { count: 'exact', head: true }).eq('is_deleted', false),
    ]);

    const firstError = [ativo.error, inativo.error, pendente.error, semStatus.error, total.error].find(Boolean);
    if (firstError) throw firstError;

    const countsByStatus = {
      ATIVO: ativo.count ?? 0,
      INATIVO: inativo.count ?? 0,
      PENDENTE: pendente.count ?? 0,
      NULL: semStatus.count ?? 0,
    };

    return NextResponse.json(
      {
        countsByStatus,
        totalClients: total.count ?? 0,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Erro ao contar clientes por status' },
      { status: 500 }
    );
  }
}
