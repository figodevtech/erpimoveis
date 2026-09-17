import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  montarVendaParaAprovacaoPublica,
  obterEstadoTokenAprovacao,
} from "@/lib/vendas/aprovacao-publica";
import { normalizeCpfOrCnpj } from "@/lib/fiscal-identifiers";

export const runtime = "nodejs";
export const revalidate = 0;

type Context = { params: Promise<{ token: string }> };
type Acao = "consultar" | "aprovar" | "reprovar";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function carregarToken(token: string) {
  const resposta = await supabaseAdmin
    .from("vendaaprovacao")
    .select("id, vendaid, expira_em, usado_em, invalidado_em, resultado")
    .eq("token", token)
    .maybeSingle();
  if (resposta.error) throw resposta.error;
  return resposta.data;
}

export async function GET(_request: Request, context: Context) {
  try {
    const token = String((await context.params).token ?? "");
    if (!UUID_RE.test(token)) {
      return NextResponse.json({ statusToken: "INVALIDO", acessoLiberado: false }, { status: 404 });
    }

    const tokenRow = await carregarToken(token);
    if (!tokenRow) {
      return NextResponse.json({ statusToken: "INVALIDO", acessoLiberado: false }, { status: 404 });
    }

    const { data: venda, error } = await supabaseAdmin
      .from("venda")
      .select("status, statusaprovacao")
      .eq("id", tokenRow.vendaid)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      statusToken: obterEstadoTokenAprovacao(tokenRow, venda),
      acessoLiberado: false,
      respondido: Boolean(tokenRow.usado_em),
      resultado: tokenRow.usado_em ? tokenRow.resultado : null,
    });
  } catch (error) {
    console.error("GET /api/venda/aprovacao/[token]", error);
    return NextResponse.json({ error: "Falha ao consultar o link." }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const token = String((await context.params).token ?? "");
    if (!UUID_RE.test(token)) {
      return NextResponse.json({ error: "Link de aprovação inválido." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { acao?: Acao; documento?: string }
      | null;
    const acao = String(body?.acao ?? "").toLowerCase() as Acao;
    const documento = normalizeCpfOrCnpj(body?.documento);
    if (!(["consultar", "aprovar", "reprovar"] as string[]).includes(acao) || !documento) {
      return NextResponse.json(
        { error: "Ação e CPF/CNPJ são obrigatórios." },
        { status: 400 },
      );
    }

    const tokenRow = await carregarToken(token);
    if (!tokenRow) {
      return NextResponse.json({ error: "Link de aprovação inválido." }, { status: 404 });
    }

    const { data: venda, error: vendaError } = await supabaseAdmin
      .from("venda")
      .select(`
        id,
        status,
        statusaprovacao,
        descricao,
        sub_total,
        desconto_tipo,
        desconto_valor,
        valor_frete,
        valortotal,
        cliente:clienteid ( nomerazaosocial, cpfcnpj ),
        itens:vendaproduto (
          id,
          quantidade,
          sub_total,
          valor_total,
          tipo_desconto,
          valor_desconto,
          valor_frete,
          produto:produtoid ( id, titulo )
        )
      `)
      .eq("id", tokenRow.vendaid)
      .maybeSingle();
    if (vendaError) throw vendaError;

    if (!venda || obterEstadoTokenAprovacao(tokenRow, venda) !== "VALIDO") {
      return NextResponse.json(
        { error: "Este link não está mais disponível para resposta." },
        { status: 410 },
      );
    }

    const cliente = Array.isArray(venda.cliente) ? venda.cliente[0] : venda.cliente;
    if (!cliente || normalizeCpfOrCnpj(cliente.cpfcnpj) !== documento) {
      return NextResponse.json(
        { error: "CPF/CNPJ não confere para este orçamento." },
        { status: 400 },
      );
    }

    if (acao === "consultar") {
      return NextResponse.json({
        acessoLiberado: true,
        statusToken: "VALIDO",
        venda: montarVendaParaAprovacaoPublica(venda),
      });
    }

    const { data, error } = await supabaseAdmin.rpc("responder_aprovacao_venda", {
      p_token: token,
      p_documento: documento,
      p_acao: acao,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, data });
  } catch (error: any) {
    console.error("POST /api/venda/aprovacao/[token]", error);
    const message = String(error?.message ?? "Falha ao registrar a resposta.");
    const status = /estoque|saldo/i.test(message)
      ? 409
      : String(error?.code) === "P0002"
        ? 404
        : ["22023", "23514"].includes(String(error?.code))
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
