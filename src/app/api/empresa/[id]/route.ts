// app/api/empresa/[id]/route.ts
import { NextResponse } from 'next/server';
import { parsePostgresIntegerId } from '@/lib/postgres-id';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const CAMPOS_EMPRESA = [
  'cnpj',
  'razaosocial',
  'nomefantasia',
  'inscricaoestadual',
  'inscricaomunicipal',
  'endereco',
  'codigomunicipio',
  'regimetributario',
  'certificadocaminho',
  'cschomologacao',
  'cscproducao',
  'ambiente',
  'bairro',
  'numero',
  'complemento',
  'cep',
  'uf',
  'codigopais',
  'nomepais',
  'telefone',
  'cnae',
  'inscricaoestadualst',
  'certificadosenha',
  // se você realmente quer permitir update via whitelist:
  // 'updatedat',
] as const;

type CampoEmpresa = (typeof CAMPOS_EMPRESA)[number];

function regimeTributarioValido(valor: unknown): boolean {
  return ['1', '2', '3', '4'].includes(String(valor || '').trim());
}

function filtrarCampos(body: any): Partial<Record<CampoEmpresa, any>> {
  const dados: Partial<Record<CampoEmpresa, any>> = {};
  for (const campo of CAMPOS_EMPRESA) {
    if (body[campo] !== undefined) {
      dados[campo] = body[campo];
    }
  }
  return dados;
}

type Contexto = { params: Promise<{ id: string }> };

// GET /api/empresa/[id]
export async function GET(_req: Request, { params }: Contexto) {
  try {
    const { id } = await params;
    const idNumber = parsePostgresIntegerId(id);

    if (idNumber === null) {
      return NextResponse.json(
        { ok: false, mensagem: 'ID inválido' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('empresa')
      .select('*')
      .eq('id', idNumber)
      .single();

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

    return NextResponse.json({ ok: true, empresa: data });
  } catch (e: any) {
    console.error('Erro inesperado em GET /api/empresa/[id]:', e);
    return NextResponse.json(
      { ok: false, mensagem: 'Erro interno ao buscar empresa' },
      { status: 500 }
    );
  }
}

// PUT /api/empresa/[id]
export async function PUT(req: Request, { params }: Contexto) {
  try {
    const { id } = await params;
    const idNumber = parsePostgresIntegerId(id);

    if (idNumber === null) {
      return NextResponse.json(
        { ok: false, mensagem: 'ID inválido' },
        { status: 400 }
      );
    }

    const body = await req.json();

    if (body.regimetributario !== undefined && !regimeTributarioValido(body.regimetributario)) {
      return NextResponse.json(
        { ok: false, mensagem: 'Regime tributário (CRT) deve ser 1, 2, 3 ou 4.' },
        { status: 400 }
      );
    }

    const dados = filtrarCampos(body);

    if (Object.keys(dados).length === 0) {
      return NextResponse.json(
        { ok: false, mensagem: 'Nenhum campo para atualizar' },
        { status: 400 }
      );
    }

    // Melhor do que forçar CampoEmpresa:
    (dados as any).updatedat = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('empresa')
      .update(dados)
      .eq('id', idNumber)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar empresa:', error);
      return NextResponse.json(
        { ok: false, mensagem: 'Erro ao atualizar empresa', detalhe: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, empresa: data });
  } catch (e: any) {
    console.error('Erro inesperado em PUT /api/empresa/[id]:', e);
    return NextResponse.json(
      { ok: false, mensagem: 'Erro interno ao atualizar empresa' },
      { status: 500 }
    );
  }
}

// DELETE /api/empresa/[id]
export async function DELETE(_req: Request, { params }: Contexto) {
  try {
    const { id } = await params;
    const idNumber = parsePostgresIntegerId(id);

    if (idNumber === null) {
      return NextResponse.json(
        { ok: false, mensagem: 'ID inválido' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from('empresa')
      .delete()
      .eq('id', idNumber);

    if (error) {
      console.error('Erro ao excluir empresa:', error);
      return NextResponse.json(
        { ok: false, mensagem: 'Erro ao excluir empresa', detalhe: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, mensagem: 'Empresa excluída com sucesso' });
  } catch (e: any) {
    console.error('Erro inesperado em DELETE /api/empresa/[id]:', e);
    return NextResponse.json(
      { ok: false, mensagem: 'Erro interno ao excluir empresa' },
      { status: 500 }
    );
  }
}
