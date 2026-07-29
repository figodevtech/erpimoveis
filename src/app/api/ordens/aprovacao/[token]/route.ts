// src/app/api/ordens/aprovacao/[token]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DBStatusOS =
  | "AGUARDANDO_CHECKLIST"
  | "ORCAMENTO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "SEM_COBRANCA"
  | "CONCLUIDO"
  | "CANCELADO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "ORCAMENTO_RECUSADO";

type DBAprovacao = "PENDENTE" | "APROVADA" | "REPROVADA";

type LinhaProduto = {
  descricao: string;
  quantidade: number;
  precounitario: number;
  subtotal: number;
};

type LinhaServico = {
  descricao: string;
  quantidade: number;
  precounitario: number;
  subtotal: number;
};

type ClienteResumo = {
  id: number;
  nomerazaosocial: string;
  cpfcnpj: string;
};

type Bundle = {
  tokenRow: any;
  ordemservicoid: number;
  cliente: ClienteResumo;
  produtos: LinhaProduto[];
  servicos: LinhaServico[];
  totais: {
    totalProdutos: number;
    totalServicos: number;
    totalGeral: number;
  };
  statusOS: DBStatusOS;
  statusAprovacao: DBAprovacao;
};

function onlyDigits(s: string | null | undefined) {
  return (s || "").replace(/\D+/g, "");
}

async function carregarPorToken(token: string): Promise<Bundle | null> {
  const tok = await supabaseAdmin
    .from("osaprovacao")
    .select(
      "id, ordemservicoid, token, expira_em, usado_em, origem, resultado, aprovador_doc, aprovador_usuario_id, created_at"
    )
    .eq("token", token)
    .maybeSingle();

  if (tok.error) throw tok.error;
  if (!tok.data) return null;

  const osId = tok.data.ordemservicoid as number;

  const os = await supabaseAdmin
    .from("ordemservico")
    .select("id, status, statusaprovacao, clienteid")
    .eq("id", osId)
    .maybeSingle();

  if (os.error) throw os.error;
  if (!os.data) return null;

  const cli = await supabaseAdmin
    .from("cliente")
    .select("id, nomerazaosocial, cpfcnpj")
    .eq("id", os.data.clienteid)
    .maybeSingle();

  if (cli.error) throw cli.error;
  if (!cli.data) return null;

  const prod = await supabaseAdmin
    .from("osproduto")
    .select(
      "produtoid, quantidade, precounitario, subtotal, produto:produtoid ( titulo, descricao )"
    )
    .eq("ordemservicoid", osId);

  if (prod.error) throw prod.error;

  const serv = await supabaseAdmin
    .from("osservico")
    .select(
      "servicoid, quantidade, precounitario, subtotal, servico:servicoid ( descricao )"
    )
    .eq("ordemservicoid", osId);

  if (serv.error) throw serv.error;

  const produtos: LinhaProduto[] = (prod.data ?? []).map((row: any) => ({
    descricao: row.produto?.titulo || row.produto?.descricao || "Produto",
    quantidade: Number(row.quantidade) || 0,
    precounitario: Number(row.precounitario) || 0,
    subtotal: Number(row.subtotal) || 0,
  }));

  const servicos: LinhaServico[] = (serv.data ?? []).map((row: any) => ({
    descricao: row.servico?.descricao ?? "Serviço",
    quantidade: Number(row.quantidade) || 0,
    precounitario: Number(row.precounitario) || 0,
    subtotal: Number(row.subtotal) || 0,
  }));

  const totalProdutos = produtos.reduce((acc, p) => acc + p.subtotal, 0);
  const totalServicos = servicos.reduce((acc, s) => acc + s.subtotal, 0);
  const totalGeral = totalProdutos + totalServicos;

  return {
    tokenRow: tok.data,
    ordemservicoid: osId,
    cliente: {
      id: cli.data.id,
      nomerazaosocial: cli.data.nomerazaosocial,
      cpfcnpj: cli.data.cpfcnpj,
    },
    produtos,
    servicos,
    totais: { totalProdutos, totalServicos, totalGeral },
    statusOS: (os.data.status || "ORCAMENTO") as DBStatusOS,
    statusAprovacao: (os.data.statusaprovacao || "PENDENTE") as DBAprovacao,
  };
}

type ParamsToken = { token: string };

/* ===========================
 * GET /api/ordens/aprovacao/[token]
 * =========================== */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<ParamsToken> }
) {
  try {
    const { token } = await params; // 👈 aqui é o ajuste
    const url = new URL(req.url);
    const docParam = onlyDigits(url.searchParams.get("doc"));

    const bundle = await carregarPorToken(token);
    if (!bundle) {
      return NextResponse.json({ error: "Token inválido" }, { status: 404 });
    }

    const { tokenRow, cliente, produtos, servicos, totais, statusOS, statusAprovacao } = bundle;

    const now = new Date();
    const usado = !!tokenRow.usado_em;
    const expirouPorData = tokenRow.expira_em ? new Date(tokenRow.expira_em) < now : false;

    // 🔴 Regra central: o link só é considerado "ativo"
    // quando a OS está EM APROVAÇÃO DE ORÇAMENTO e ainda está PENDENTE.
    const emAprovacao = statusOS === "APROVACAO_ORCAMENTO" && statusAprovacao === "PENDENTE";

    const ativo = !usado && !expirouPorData && emAprovacao;

    const expirado = !ativo;
    const statusToken: "valido" | "usado" | "expirado" =
      usado ? "usado" : expirado ? "expirado" : "valido";

    const base = {
      ordemservicoid: bundle.ordemservicoid,
      osId: bundle.ordemservicoid,
      cliente: {
        nomerazaosocial: cliente.nomerazaosocial,
        cpfcnpj: cliente.cpfcnpj,
      },
      statusOS,
      statusAprovacao,
      statusToken,
      usado,
      expirado,
    };

    // 👉 Se NÃO está em APROVACAO_ORCAMENTO/PENDENTE, ou já foi usado, vencido etc:
    // devolvemos "expirado" e NÃO mostramos valores.
    if (!ativo) {
      return NextResponse.json(
        {
          ...base,
          acessoLiberado: false,
          jaRespondido: usado,
          produtos: [],
          servicos: [],
          totais: {
            totalProdutos: 0,
            totalServicos: 0,
            totalGeral: 0,
          },
        },
        { status: 200 }
      );
    }

    // Token ativo, mas sem doc → não libera valores ainda
    if (!docParam) {
      return NextResponse.json(
        {
          ...base,
          acessoLiberado: false,
          produtos: [],
          servicos: [],
          totais: {
            totalProdutos: 0,
            totalServicos: 0,
            totalGeral: 0,
          },
        },
        { status: 200 }
      );
    }

    // Confere documento
    const docOk = onlyDigits(cliente.cpfcnpj) === docParam;
    if (!docOk) {
      return NextResponse.json(
        { error: "Documento não confere para este orçamento." },
        { status: 400 }
      );
    }

    // Documento confere → agora sim libera orçamento
    return NextResponse.json(
      {
        ...base,
        acessoLiberado: true,
        produtos,
        servicos,
        totais,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("GET /api/ordens/aprovacao/[token]", err);
    return NextResponse.json(
      { error: "Falha ao carregar dados do orçamento." },
      { status: 500 }
    );
  }
}

/* ===========================
 * POST /api/ordens/aprovacao/[token]
 * body: { acao: "aprovar" | "reprovar", doc: string }
 * =========================== */

type PostBody = {
  acao: "aprovar" | "reprovar";
  doc: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<ParamsToken> }
) {
  try {
    const { token } = await params; // 👈 mesmo ajuste aqui
    const body = (await req.json()) as PostBody;

    if (!body?.acao || !body?.doc) {
      return NextResponse.json(
        { error: "Ação e documento são obrigatórios." },
        { status: 400 }
      );
    }

    const bundle = await carregarPorToken(token);
    if (!bundle) {
      return NextResponse.json({ error: "Token inválido." }, { status: 404 });
    }

    const { tokenRow, ordemservicoid, cliente, statusOS, statusAprovacao } = bundle;

    const now = new Date();
    const usado = !!tokenRow.usado_em;
    const expirouPorData = tokenRow.expira_em ? new Date(tokenRow.expira_em) < now : false;

    // 🔴 Regra central: só pode responder se a OS estiver em APROVACAO_ORCAMENTO e PENDENTE
    const emAprovacao = statusOS === "APROVACAO_ORCAMENTO" && statusAprovacao === "PENDENTE";

    const ativo = !usado && !expirouPorData && emAprovacao;

    if (!ativo) {
      return NextResponse.json(
        { error: "Este link não está mais disponível para resposta." },
        { status: 400 }
      );
    }

    const doc = onlyDigits(body.doc);
    if (!doc || doc !== onlyDigits(cliente.cpfcnpj)) {
      return NextResponse.json(
        { error: "CPF/CNPJ não confere para este orçamento." },
        { status: 400 }
      );
    }

    const desiredAprov: DBAprovacao =
      body.acao === "aprovar" ? "APROVADA" : "REPROVADA";
    const desiredOS: DBStatusOS =
      body.acao === "aprovar" ? "ORCAMENTO_APROVADO" : "ORCAMENTO_RECUSADO";

    // 1) Atualiza a OS com o resultado da aprovação
    const upd = await supabaseAdmin
      .from("ordemservico")
      .update({
        statusaprovacao: desiredAprov,
        status: desiredOS,
      })
      .eq("id", ordemservicoid)
      .setHeader("x-audit-actor-type", "cliente")
      .setHeader("x-audit-actor-name", "Cliente via link de aprovação");

    if (upd.error) throw upd.error;

    // 2) Marca esse token como usado e registra quem aprovou (origem = LINK)
    const mark = await supabaseAdmin
      .from("osaprovacao")
      .update({
        usado_em: new Date().toISOString(),
        origem: "LINK",
        resultado: desiredAprov,
        aprovador_doc: doc,
        aprovador_usuario_id: null,
      })
      .eq("id", tokenRow.id)
      .is("usado_em", null)
      .setHeader("x-audit-actor-type", "cliente")
      .setHeader("x-audit-actor-name", "Cliente via link de aprovação");

    if (mark.error) throw mark.error;

    return NextResponse.json(
      {
        ok: true,
        ordemservicoid,
        status: desiredOS,
        statusaprovacao: desiredAprov,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/ordens/aprovacao/[token]", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao registrar resposta do orçamento." },
      { status: 500 }
    );
  }
}
