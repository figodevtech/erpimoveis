// app/api/empresa/route.ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isValidCnpj, normalizeCnpj } from '@/lib/fiscal-identifiers';

export const runtime = 'nodejs';

const CAMPOS_RETORNO =
  'id, cnpj, razaosocial, nomefantasia, inscricaoestadual, inscricaomunicipal, endereco, codigomunicipio, regimetributario, ambiente, bairro, numero, complemento, cep, uf, codigopais, nomepais, telefone, cnae, inscricaoestadualst';

// Campos permitidos para insert/update
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

// GET /api/empresa
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cnpjParam = searchParams.get('cnpj');
    const cnpj = cnpjParam ? normalizeCnpj(cnpjParam) : null;

    if (cnpj && !isValidCnpj(cnpj)) {
      return NextResponse.json(
        { ok: false, mensagem: 'CNPJ numérico ou alfanumérico inválido.' },
        { status: 400 },
      );
    }

    let query = supabaseAdmin.from('empresa').select(CAMPOS_RETORNO);

    if (cnpj) {
      query = query.eq('cnpj', cnpj);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar empresas:', error);
      return NextResponse.json(
        { ok: false, mensagem: 'Erro ao listar empresas', detalhe: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, empresas: data ?? [] });
  } catch (e: any) {
    console.error('Erro inesperado em GET /api/empresa:', e);
    return NextResponse.json(
      { ok: false, mensagem: 'Erro interno ao listar empresas' },
      { status: 500 }
    );
  }
}

// POST /api/empresa
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Valida mínimos obrigatórios
    const obrigatorios: CampoEmpresa[] = [
      'cnpj',
      'razaosocial',
      'endereco',
      'codigomunicipio',
      'regimetributario',
    ];

    for (const campo of obrigatorios) {
      if (!body[campo]) {
        return NextResponse.json(
          {
            ok: false,
            mensagem: `Campo obrigatório ausente: ${campo}`,
          },
          { status: 400 }
        );
      }
    }

    if (!regimeTributarioValido(body.regimetributario)) {
      return NextResponse.json(
        { ok: false, mensagem: 'Regime tributário (CRT) deve ser 1, 2, 3 ou 4.' },
        { status: 400 }
      );
    }

    const cnpj = normalizeCnpj(body.cnpj);
    if (!isValidCnpj(cnpj)) {
      return NextResponse.json(
        { ok: false, mensagem: 'CNPJ numérico ou alfanumérico inválido.' },
        { status: 400 },
      );
    }

    const dados = { ...filtrarCampos(body), cnpj };

    const { data, error } = await supabaseAdmin
      .from('empresa')
      .insert([{ ...dados }])
      .select('id')
      .single();

    if (error) {
      console.error('Erro ao criar empresa:', error);
      return NextResponse.json(
        { ok: false, mensagem: 'Erro ao criar empresa', detalhe: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, empresa: data }, { status: 201 });
  } catch (e: any) {
    console.error('Erro inesperado em POST /api/empresa:', e);
    return NextResponse.json(
      { ok: false, mensagem: 'Erro interno ao criar empresa' },
      { status: 500 }
    );
  }
}
