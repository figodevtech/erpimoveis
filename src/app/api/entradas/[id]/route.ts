import { NextResponse } from "next/server";
import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { anexarAutor } from "@/lib/movement-authors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { carregarPersonalizacaoFiscal } from "@/services/estoque/entradaFiscalPersonalizadaAuditService";

type Params = { params: Promise<{ id: string }> };

const SELECT_ENTRADA = `
  id, created_at, fornecedorid, fiscal, notachave, tipo, status, origem, observacao,
  numero_nota, serie_nota, data_emissao, valor_total, cancelada_at, created_by,
  cancelada_by, motivo_cancelamento,
  fornecedor:fornecedorid(id, cpfcnpj, nomerazaosocial, nomefantasia),
  itens:entradaitens(
    id, produto_id, unidade, quantidade, precovenda, valor_unitario_compra,
    valor_desconto, valor_frete, outras_despesas, valor_total,
    ncm, cest, csosn, referencia, titulo, "cClassTrib", "cstIbs", "cstCbs",
    cst, aliquotaicms, cfop, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins,
    created_at, updated_at,
    produto:produto_id(id, titulo, referencia, codigobarras, ncm, unidade, precovenda, ultimovalordecompra)
  ),
  transacoes:transacao(id, descricao, valor, data, pendente, is_deleted, estorno_transacao_id)
`;

function validId(value: string) {
  return /^\d+$/.test(value) && Number(value) > 0;
}

export async function GET(_req: Request, { params }: Params) {
  try {
    await requireEstoqueAccess();
    const { id } = await params;
    if (!validId(id)) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("entrada").select(SELECT_ENTRADA).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Entrada não encontrada." }, { status: 404 });
    const [entrada, personalizacaoFiscal] = await Promise.all([
      anexarAutor({
        ...data,
        itens: Array.isArray(data.itens) ? [...data.itens].sort((a, b) => Number(a.id) - Number(b.id)) : [],
      }),
      carregarPersonalizacaoFiscal("produto", Number(id)),
    ]);
    return NextResponse.json({
      entrada: { ...entrada, personalizacaoFiscal },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao consultar entrada." },
      { status: error?.statusCode ?? 500 },
    );
  }
}

export async function PATCH(_req: Request, { params }: Params) {
  try {
    await requireEstoqueEdit();
    const { id } = await params;
    if (!validId(id)) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
    return NextResponse.json(
      {
        error: "Entradas são confirmadas no momento do lançamento e não podem ser editadas. Cancele esta entrada e registre uma nova.",
      },
      { status: 409 },
    );
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: error?.statusCode ?? 500 });
  }
}
