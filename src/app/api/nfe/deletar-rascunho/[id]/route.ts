import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { liberarNumeroNfe } from '@/services/fiscal/nfeNumeracaoService';

export const runtime = 'nodejs';

type NfeRow = {
  id: number;
  status: string;
  empresaid: number | null;
};

/**
 * Nota que a SEFAZ nunca registrou pode ser apagada. Rejeitada entra junto:
 * ela não existe lá, e o usuário precisa poder descartá-la em vez de deixar a
 * numeração presa a um documento que não vai ser emitido.
 */
const STATUS_EXCLUIVEIS = ['RASCUNHO', 'REJEITADA'];

async function deletarRascunhoHandler(_req: Request, nfeIdParam: string) {
  try {
    const nfeId = Number(nfeIdParam);

    if (Number.isNaN(nfeId)) {
      return NextResponse.json(
        { ok: false, mensagem: 'ID de NF-e inválido.' },
        { status: 400 },
      );
    }

    // 1) Buscar NF-e no banco
    const { data: nfe, error: nfeError } = await supabaseAdmin
      .from('nfe')
      .select('*')
      .eq('id', nfeId)
      .maybeSingle<NfeRow>();

    if (nfeError) {
      console.error('[nfe/deletar-rascunho] erro ao buscar NF-e:', nfeError);
      return NextResponse.json(
        {
          ok: false,
          mensagem: 'Erro ao buscar NF-e no banco.',
          detalhe: nfeError.message,
        },
        { status: 500 },
      );
    }

    if (!nfe) {
      return NextResponse.json(
        { ok: false, mensagem: 'NF-e não encontrada.' },
        { status: 404 },
      );
    }

    // 2) Só permite excluir o que nunca virou documento na SEFAZ
    if (!STATUS_EXCLUIVEIS.includes((nfe.status || '').toUpperCase())) {
      return NextResponse.json(
        {
          ok: false,
          mensagem:
            'Somente NF-e em rascunho ou rejeitada pode ser excluída do banco.',
          statusAtual: nfe.status,
        },
        { status: 400 },
      );
    }

    // 3) Devolver o número para a fila antes de perder a linha
    await liberarNumeroNfe(nfeId, 'Nota excluida');

    // 4) Excluir de fato
    const { error: deleteError } = await supabaseAdmin
      .from('nfe')
      .delete()
      .eq('id', nfeId);

    if (deleteError) {
      console.error(
        '[nfe/deletar-rascunho] erro ao excluir NF-e:',
        deleteError,
      );
      return NextResponse.json(
        {
          ok: false,
          mensagem: 'Erro ao excluir NF-e em rascunho.',
          detalhe: deleteError.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      nfeId,
      mensagem: 'NF-e em rascunho excluída com sucesso.',
    });
  } catch (e: any) {
    console.error('Erro em /api/nfe/deletar-rascunho/[id]:', e);
    return NextResponse.json(
      {
        ok: false,
        mensagem: 'Erro interno ao excluir NF-e em rascunho.',
        detalhe: String(e?.message ?? e),
        stack: e?.stack ?? null,
      },
      { status: 500 },
    );
  }
}

// Next 15: params é Promise
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return deletarRascunhoHandler(req, id);
}
