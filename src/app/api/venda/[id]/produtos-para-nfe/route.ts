import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireVendasAccess } from "@/app/api/_authz/perms";

export const runtime = "nodejs";

// Produto como vem do join
type ProdutoDb = {
  id: number;
  titulo: string;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  codigobarras: string | null;
  referencia: string | null;
  unidade: string | null;
  origem_mercadoria: string | null;

  csosn: string | null;
  cst: string | null;
  cest: string | null;
  aliquotaicms: number | string | null;
  cst_pis: string | null;
  aliquota_pis: number | string | null;
  modo_pis: string | null;
  aliquota_por_unidade_pis: number | string | null;
  cst_cofins: string | null;
  aliquota_cofins: number | string | null;
  modo_cofins: string | null;
  aliquota_por_unidade_cofins: number | string | null;
  rtc_habilitado: boolean | null;
  cst_ibscbs: string | null;
  cclass_trib: string | null;
  aliquota_ibs_uf: number | string | null;
  aliquota_ibs_municipio: number | string | null;
  aliquota_cbs: number | string | null;
};

type VendaProdutoDbRow = {
  id: number; // vendaproduto.id
  venda_id: number;
  produtoid: number;
  quantidade: number | string;
  sub_total: number | string;
  valor_total: number | string;
  valor_desconto: number | string | null;
  produto: ProdutoDb | ProdutoDb[] | null;
};

type ProdutoParaNfeDTO = {
  osProdutoId: string; // para reaproveitar o mesmo componente do front
  sourceItemId: string;
  produtoId: number;

  titulo: string;
  descricao: string;

  quantidade: number;
  precoUnitario: number;
  subtotal: number;

  ncm: string | null;
  cfop: string | null;
  csosn: string | null;
  cst: string | null;
  cest: string | null;
  aliquotaicms: number | null;

  cst_pis: string | null;
  aliquota_pis: number | null;
  modo_pis: string | null;
  aliquota_por_unidade_pis: number | null;
  cst_cofins: string | null;
  aliquota_cofins: number | null;
  modo_cofins: string | null;
  aliquota_por_unidade_cofins: number | null;
  rtc_habilitado: boolean;
  cst_ibscbs: string | null;
  cclass_trib: string | null;
  aliquota_ibs_uf: number | null;
  aliquota_ibs_municipio: number | null;
  aliquota_cbs: number | null;

  codigobarras: string | null;
  referencia: string | null;
  unidade: string | null;
  origem_mercadoria: string | null;
};

function normalizarProduto(campo: VendaProdutoDbRow["produto"]): ProdutoDb | null {
  if (!campo) return null;
  return Array.isArray(campo) ? campo[0] ?? null : campo;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const vendaId = Number(id);

  if (!Number.isFinite(vendaId) || vendaId <= 0) {
    return NextResponse.json(
      { ok: false, message: "ID da venda inválido." },
      { status: 400 }
    );
  }

  try {
    await requireVendasAccess();
    // 1) garantir que venda existe
    const { data: venda, error: vendaError } = await supabaseAdmin
      .from("venda")
      .select("id, clienteid, observacoes_fiscais")
      .eq("id", vendaId)
      .maybeSingle();

    if (vendaError) {
      console.error("Erro ao buscar venda:", vendaError);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar venda no banco." },
        { status: 500 }
      );
    }

    if (!venda) {
      return NextResponse.json(
        { ok: false, message: "Venda não encontrada." },
        { status: 404 }
      );
    }

    // 2) buscar itens da venda + dados do produto
    const { data: itens, error: itensError } = await supabaseAdmin
      .from("vendaproduto")
      .select(
        `
          id,
          venda_id,
          produtoid,
          quantidade,
          sub_total,
          valor_total,
          valor_desconto,
          produto:produto (
            id,
            titulo,
            descricao,
            ncm,
            cfop,
            codigobarras,
            referencia,
            unidade,
            origem_mercadoria,
            csosn,
            cst,
            cest,
            aliquotaicms,
            cst_pis,
            aliquota_pis,
            modo_pis,
            aliquota_por_unidade_pis,
            cst_cofins,
            aliquota_cofins,
            modo_cofins,
            aliquota_por_unidade_cofins,
            rtc_habilitado,
            cst_ibscbs,
            cclass_trib,
            aliquota_ibs_uf,
            aliquota_ibs_municipio,
            aliquota_cbs
          )
        `
      )
      .eq("venda_id", vendaId)
      .returns<VendaProdutoDbRow[]>();

    if (itensError) {
      console.error("Erro ao buscar produtos da venda:", itensError);
      return NextResponse.json(
        { ok: false, message: "Erro ao buscar produtos vinculados à venda." },
        { status: 500 }
      );
    }

    const resposta: ProdutoParaNfeDTO[] = (itens ?? []).map((row) => {
      const p = normalizarProduto(row.produto);

      const titulo = p?.titulo || `Produto #${row.produtoid}`;
      const descricao = p?.descricao || titulo;

      const quantidade = toNumber(row.quantidade);
      const valorTotal = toNumber(row.valor_total);
      const precoUnitario = quantidade > 0 ? valorTotal / quantidade : valorTotal;

      return {
        osProdutoId: `${vendaId}-${row.produtoid}`, // reaproveita o mesmo campo do front
        sourceItemId: `venda:${vendaId}:${row.id}`,
        produtoId: row.produtoid,

        titulo,
        descricao,

        quantidade,
        precoUnitario,
        subtotal: toNumber(row.sub_total || row.valor_total),

        ncm: p?.ncm ?? null,
        cfop: p?.cfop ?? null,
        csosn: p?.csosn ?? null,
        cst: p?.cst ?? null,
        cest: p?.cest ?? null,
        aliquotaicms: p?.aliquotaicms != null ? Number(p.aliquotaicms) : null,

        cst_pis: p?.cst_pis ?? null,
        aliquota_pis: p?.aliquota_pis != null ? Number(p.aliquota_pis) : null,
        modo_pis: p?.modo_pis ?? null,
        aliquota_por_unidade_pis:
          p?.aliquota_por_unidade_pis != null ? Number(p.aliquota_por_unidade_pis) : null,
        cst_cofins: p?.cst_cofins ?? null,
        aliquota_cofins:
          p?.aliquota_cofins != null ? Number(p.aliquota_cofins) : null,
        modo_cofins: p?.modo_cofins ?? null,
        aliquota_por_unidade_cofins:
          p?.aliquota_por_unidade_cofins != null ? Number(p.aliquota_por_unidade_cofins) : null,
        rtc_habilitado: Boolean(p?.rtc_habilitado),
        cst_ibscbs: p?.cst_ibscbs ?? null,
        cclass_trib: p?.cclass_trib ?? null,
        aliquota_ibs_uf: p?.aliquota_ibs_uf != null ? Number(p.aliquota_ibs_uf) : null,
        aliquota_ibs_municipio:
          p?.aliquota_ibs_municipio != null ? Number(p.aliquota_ibs_municipio) : null,
        aliquota_cbs: p?.aliquota_cbs != null ? Number(p.aliquota_cbs) : null,

        codigobarras: p?.codigobarras ?? null,
        referencia: p?.referencia ?? null,
        unidade: p?.unidade ?? "UN",
        origem_mercadoria: p?.origem_mercadoria ?? null,
      };
    });

    const { data: cliente } = venda.clienteid
      ? await supabaseAdmin
          .from("cliente")
          .select("id, tipopessoa, cpfcnpj, nomerazaosocial, email, telefone, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep, inscricaoestadual, inscricaomunicipal, codigomunicipio")
          .eq("id", venda.clienteid)
          .maybeSingle()
      : { data: null };

    return NextResponse.json({
      ok: true,
      vendaId,
      observacoes_fiscais: venda.observacoes_fiscais ?? null,
      cliente: cliente
        ? {
            ...cliente,
            nome: cliente.nomerazaosocial,
            uf: cliente.estado,
          }
        : null,
      itens: resposta,
    });
  } catch (e: any) {
    console.error("Erro em GET /api/venda/[id]/produtos-para-nfe:", e);
    const status = e?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para acessar esta venda."
            : "Erro interno ao buscar produtos da venda.",
        detalhe: String(e?.message ?? e),
      },
      { status }
    );
  }
}
