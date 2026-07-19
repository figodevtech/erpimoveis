import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { EmpresaRow } from '@/lib/nfe/types';
import { validarEmitenteEmpresa } from '@/lib/nfe/validarEmitente';
import { buildNFePreviewXml } from '@/lib/nfe/buildNFe';
import { resolverNomeMunicipioIbge } from '@/lib/ibge/municipio';

export const runtime = 'nodejs';

type Contexto = { params: Promise<{ id: string }> };

export async function GET(
  req: NextRequest,
  { params }: Contexto
) {
  try {
    const { id } = await params;
    const idNumber = Number(id);

    if (Number.isNaN(idNumber)) {
      return NextResponse.json(
        { ok: false, mensagem: 'ID inválido' },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const numeroParam = url.searchParams.get('numero') ?? '1';
    const serieParam = url.searchParams.get('serie') ?? '1';

    const numeroNota = Number(numeroParam);
    const serie = Number(serieParam);

    if (Number.isNaN(numeroNota) || Number.isNaN(serie)) {
      return NextResponse.json(
        { ok: false, mensagem: 'Parâmetros numero e serie devem ser numéricos.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('empresa')
      .select('*')
      .eq('id', idNumber)
      .single<EmpresaRow>();

    if (error) {
      console.error('Erro ao buscar empresa:', error);
      return NextResponse.json(
        { ok: false, mensagem: 'Erro ao buscar empresa', detalhe: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, mensagem: 'Empresa não encontrada' },
        { status: 404 }
      );
    }

    const errosEmitente = validarEmitenteEmpresa(data);
    if (errosEmitente.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          tipo: 'VALIDACAO_EMITENTE',
          mensagem: 'Emitente com dados incompletos para emitir NF-e.',
          erros: errosEmitente,
        },
        { status: 400 }
      );
    }

    const nomeMunicipioEmitente = await resolverNomeMunicipioIbge(data.codigomunicipio, data.uf);
    const { xml, chave, id: idNFe } = buildNFePreviewXml(
      data,
      numeroNota,
      serie,
      undefined,
      undefined,
      { nomeMunicipioEmitente }
    );

    return NextResponse.json({
      ok: true,
      chave,
      idNFe,
      xml,
    });
  } catch (e: any) {
    console.error('Erro em GET /api/nfe/preview/[id]:', e);
    return NextResponse.json(
      {
        ok: false,
        mensagem: 'Erro interno ao montar NF-e de preview',
        detalhe: String(e?.message ?? e),
        stack: e?.stack ?? null,
      },
      { status: 500 }
    );
  }
}
