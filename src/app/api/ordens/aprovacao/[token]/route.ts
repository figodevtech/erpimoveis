// src/app/api/ordens/aprovacao/[token]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  registerLoginFailure,
} from "@/lib/login-rate-limit";
import { buildPublicApprovalRateLimitKeys } from "@/lib/login-security";
import {
  arredondarMoeda,
  calcularDescontoAplicado,
  sanitizeTipoDesconto,
  type TipoDesconto,
} from "@/lib/ordens/desconto";

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

type LinhaOrcamento = {
  descricao: string;
  /** Item informado no orçamento que ainda não foi vinculado ao catálogo. */
  avulso?: boolean;
  quantidade: number;
  precounitario: number;
  /** quantidade x preço unitário, antes do desconto do item */
  valorBruto: number;
  descontoTipo: TipoDesconto;
  /** valor informado no cadastro: reais quando FIXO, percentual quando PORCENTAGEM */
  desconto: number;
  /** quanto o desconto do item representa em reais */
  descontoAplicado: number;
  /** valorBruto - descontoAplicado */
  subtotal: number;
};

type LinhaProduto = LinhaOrcamento;

type LinhaServico = LinhaOrcamento;

type Totais = {
  totalProdutos: number;
  totalServicos: number;
  /** soma dos itens já líquidos do desconto de cada um */
  subtotal: number;
  descontoGeralTipo: TipoDesconto;
  descontoGeralInformado: number;
  /** desconto geral da OS convertido em reais */
  descontoGeral: number;
  valorFrete: number;
  /** subtotal - descontoGeral + frete: é o valor que o cliente está aprovando */
  totalGeral: number;
};

const TOTAIS_ZERADOS: Totais = {
  totalProdutos: 0,
  totalServicos: 0,
  subtotal: 0,
  descontoGeralTipo: null,
  descontoGeralInformado: 0,
  descontoGeral: 0,
  valorFrete: 0,
  totalGeral: 0,
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
  totais: Totais;
  statusOS: DBStatusOS;
  statusAprovacao: DBAprovacao;
};

function onlyDigits(s: string | null | undefined) {
  return (s || "").replace(/\D+/g, "");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function rateLimited(retryAfter: number) {
  return NextResponse.json(
    { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, retryAfter)),
        "Cache-Control": "no-store",
      },
    },
  );
}

function auditHeaderValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 120);
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
    .select("id, status, statusaprovacao, clienteid, desconto, desconto_tipo, valor_frete")
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
      "produtoid, quantidade, precounitario, subtotal, desconto, desconto_tipo, produto:produtoid ( titulo, descricao )"
    )
    .eq("ordemservicoid", osId);

  if (prod.error) throw prod.error;

  const avulsos = await supabaseAdmin
    .from("osproduto_avulso")
    .select("id, titulo, quantidade, precounitario, subtotal, desconto, desconto_tipo")
    .eq("ordemservicoid", osId)
    .order("id", { ascending: true });

  if (avulsos.error) throw avulsos.error;

  const serv = await supabaseAdmin
    .from("osservico")
    .select(
      "servicoid, quantidade, precounitario, subtotal, desconto, desconto_tipo, servico:servicoid ( descricao )"
    )
    .eq("ordemservicoid", osId);

  if (serv.error) throw serv.error;

  // `subtotal` já é gravado líquido do desconto do item, mas recalculamos a partir do
  // bruto para o detalhamento nunca divergir do desconto que está sendo exibido.
  function montarLinha(
    descricao: string,
    row: any,
    avulso = false,
  ): LinhaOrcamento {
    const quantidade = Number(row.quantidade) || 0;
    const precounitario = Number(row.precounitario) || 0;
    const valorBruto = arredondarMoeda(quantidade * precounitario);
    const descontoTipo = sanitizeTipoDesconto(row.desconto_tipo);
    const desconto = Number(row.desconto) || 0;
    const descontoAplicado = calcularDescontoAplicado(valorBruto, descontoTipo, desconto);

    return {
      descricao,
      avulso,
      quantidade,
      precounitario,
      valorBruto,
      descontoTipo,
      desconto,
      descontoAplicado,
      subtotal: arredondarMoeda(valorBruto - descontoAplicado),
    };
  }

  const produtosCadastrados: LinhaProduto[] = (prod.data ?? []).map((row: any) =>
    montarLinha(row.produto?.titulo || row.produto?.descricao || "Produto", row)
  );

  const produtosAvulsos: LinhaProduto[] = (avulsos.data ?? []).map((row: any) =>
    montarLinha(row.titulo || "Produto avulso", row, true)
  );

  const produtos = [...produtosCadastrados, ...produtosAvulsos];

  const servicos: LinhaServico[] = (serv.data ?? []).map((row: any) =>
    montarLinha(row.servico?.descricao ?? "Serviço", row)
  );

  const totalProdutos = arredondarMoeda(produtos.reduce((acc, p) => acc + p.subtotal, 0));
  const totalServicos = arredondarMoeda(servicos.reduce((acc, s) => acc + s.subtotal, 0));
  const subtotal = arredondarMoeda(totalProdutos + totalServicos);

  // O desconto geral da OS incide sobre a soma dos itens e é o que faltava aqui:
  // sem ele o cliente aprovava um valor maior do que o orçado.
  const descontoGeralTipo = sanitizeTipoDesconto(os.data.desconto_tipo);
  const descontoGeralInformado = Number(os.data.desconto) || 0;
  const descontoGeral = calcularDescontoAplicado(subtotal, descontoGeralTipo, descontoGeralInformado);
  const valorFrete = arredondarMoeda(Math.max(0, Number(os.data.valor_frete) || 0));
  const totalGeral = arredondarMoeda(subtotal - descontoGeral + valorFrete);

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
    totais: {
      totalProdutos,
      totalServicos,
      subtotal,
      descontoGeralTipo,
      descontoGeralInformado,
      descontoGeral,
      valorFrete,
      totalGeral,
    },
    statusOS: (os.data.status || "ORCAMENTO") as DBStatusOS,
    statusAprovacao: (os.data.statusaprovacao || "PENDENTE") as DBAprovacao,
  };
}

type ParamsToken = { token: string };

/* ===========================
 * GET /api/ordens/aprovacao/[token]
 * =========================== */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<ParamsToken> }
) {
  try {
    const { token } = await params; // 👈 aqui é o ajuste
    if (!isUuid(token)) {
      return NextResponse.json({ error: "Token inválido" }, { status: 404 });
    }

    const bundle = await carregarPorToken(token);
    if (!bundle) {
      return NextResponse.json({ error: "Token inválido" }, { status: 404 });
    }

    const { tokenRow, statusOS, statusAprovacao } = bundle;

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
          totais: TOTAIS_ZERADOS,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ...base,
        acessoLiberado: false,
        produtos: [],
        servicos: [],
        totais: TOTAIS_ZERADOS,
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
 * body: { acao: "consultar" | "aprovar" | "reprovar", doc: string }
 * =========================== */

type PostBody = {
  acao: "consultar" | "aprovar" | "reprovar";
  doc: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<ParamsToken> }
) {
  try {
    const { token } = await params; // 👈 mesmo ajuste aqui
    if (!isUuid(token)) {
      return NextResponse.json({ error: "Token inválido." }, { status: 404 });
    }
    const body = (await req.json()) as PostBody;

    if (!body?.doc || !["consultar", "aprovar", "reprovar"].includes(body?.acao)) {
      return NextResponse.json(
        { error: "Ação e documento são obrigatórios." },
        { status: 400 }
      );
    }

    const rateLimitKeys = buildPublicApprovalRateLimitKeys(token, req);
    const retryAfter = await checkLoginRateLimit(rateLimitKeys);
    if (retryAfter > 0) return rateLimited(retryAfter);

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
      const blockedFor = await registerLoginFailure(rateLimitKeys);
      if (blockedFor > 0) return rateLimited(blockedFor);
      return NextResponse.json(
        { error: "CPF/CNPJ não confere para este orçamento." },
        { status: 400 }
      );
    }

    if (body.acao === "consultar") {
      await clearLoginRateLimit([rateLimitKeys[0]]);
      return NextResponse.json({
        ordemservicoid,
        osId: ordemservicoid,
        cliente: { nomerazaosocial: cliente.nomerazaosocial },
        statusOS,
        statusAprovacao,
        statusToken: "valido",
        usado: false,
        expirado: false,
        acessoLiberado: true,
        produtos: bundle.produtos,
        servicos: bundle.servicos,
        totais: bundle.totais,
      });
    }

    const desiredAprov: DBAprovacao =
      body.acao === "aprovar" ? "APROVADA" : "REPROVADA";
    const desiredOS: DBStatusOS =
      body.acao === "aprovar" ? "ORCAMENTO_APROVADO" : "ORCAMENTO_RECUSADO";

    const auditActorName = auditHeaderValue(
      `Cliente: ${cliente.nomerazaosocial} (link de aprovacao)`,
    );

    const result = await supabaseAdmin
      .rpc("responder_aprovacao_os", {
        p_token: token,
        p_documento: doc,
        p_acao: body.acao,
      })
      .setHeader("x-audit-actor-type", "cliente")
      .setHeader("x-audit-actor-name", auditActorName);

    if (result.error) throw result.error;
    await clearLoginRateLimit([rateLimitKeys[0]]);

    return NextResponse.json(
      {
        ok: true,
        ordemservicoid: result.data?.ordemservicoid ?? ordemservicoid,
        status: result.data?.status ?? desiredOS,
        statusaprovacao: result.data?.statusaprovacao ?? desiredAprov,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("POST /api/ordens/aprovacao/[token]", err);
    const code = String(err?.code ?? "");
    const status = code === "P0002" ? 404 : code === "22023" ? 409 : 500;
    return NextResponse.json(
      { error: err?.message || "Falha ao registrar resposta do orçamento." },
      { status }
    );
  }
}
