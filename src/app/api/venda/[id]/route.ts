// src/app/api/venda/[id]/route.ts

export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { requireVendasAccess, requireVendasDelete, requireVendasEdit } from "@/app/api/_authz/perms";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";
import { calculateFinancialTotal, sanitizeFinancialSurchargeType } from "@/lib/financial-surcharge";

type Status =
  | "ORCAMENTO"
  | "ABERTA"
  | "PAGAMENTO"
  | "PENDENTE"
  | "PAGO"
  | "AUTORIZADO"
  | "FINALIZADA"
  | "CANCELADA"
  | "CANCELADO";
const STATUS_SET = new Set<Status>([
  "ORCAMENTO",
  "ABERTA",
  "PAGAMENTO",
  "PENDENTE",
  "PAGO",
  "AUTORIZADO",
  "FINALIZADA",
  "CANCELADA",
  "CANCELADO",
]);

/** Estados em que a venda nao pode manter estoque baixado. */
const STATUS_CANCELADOS = new Set<string>(["CANCELADA", "CANCELADO"]);

/**
 * SELECT padrão da venda com cliente e itens (vendaproduto) + produto.
 * Atenção:
 * - vendaproduto usa venda_id
 * - produto embed via FK produtoid
 */
const VENDA_SELECT = `
  id,
  clienteid,
  cliente:cliente (
    id,
    nomerazaosocial,
    cpfcnpj,
    email,
    telefone
  ),
  status,
  categoriavendaid,
  categoria_venda:categoriavendaid (
    id,
    nome,
    descricao,
    ativo
  ),
  canal,
  status_entrega,
  codigo_rastreio,
  transportadora_rastreio,
  ultimo_evento_rastreio,
  ultimo_evento_rastreio_em,
  status_rastreio,
  eventos_rastreio,
  rastreio_atualizado_em,
  nfe_chave_acesso,
  danfe_url,
  valortotal,
  datavenda,
  createdat,
  updatedat,
  created_by,
  vendedor,
  updated_by,
  motivo_cancelamento,
  cancelada_at,
  cancelada_by,
  cancelada_por:cancelada_by ( id, nome ),
  criador:created_by ( id, nome ),
  comissao_venda_percent_aplicada,
  vendedor_rel:vendedor ( id, nome ),
  editor:updated_by ( id, nome ),
  desconto_tipo,
  desconto_valor,
  valor_frete,
  acrescimo_financeiro_tipo,
  acrescimo_financeiro_valor,
  observacoes,
  observacoes_fiscais,
  forma_pagamento,
  sub_total,
  itens:vendaproduto (
    id,
    venda_id,
    produtoid,
    quantidade,
    sub_total,
    valor_total,
    valor_desconto,
    tipo_desconto,
    created_at,
    updated_at,
    produto:produtoid (
      id,
      titulo,
      descricao,
      precovenda,
      imgUrl,
      ncm,
      unidade,
      codigobarras,
      csosn,
      cst,
      cest,
      aliquotaicms,
      cfop,
      cst_pis,
      aliquota_pis,
      cst_cofins,
      aliquota_cofins
    )
  )
`;

type VendaPatchBody = {
  clienteId?: number;
  status?: string;
  statusEntrega?: string | null; // enum_status_entrega (SEPARACAO|ENVIO|ENTREGUE)
  codigoRastreio?: string | null;
  transportadoraRastreio?: string | null;
  nfeChaveAcesso?: string | null;
  danfeUrl?: string | null;
  descontoTipo?: string | null;
  descontoValor?: number | null;
  valorFrete?: number | null;
  acrescimoFinanceiroTipo?: string | null;
  acrescimoFinanceiroValor?: number | null;
  formaPagamento?: string | null;
  subTotal?: number;
  valorTotal?: number;
  dataVenda?: string | null; // ISO string
  observacoes?: string | null;
  observacoesFiscais?: string | null;
  vendedor?: string | null;
  categoriaVendaId?: number | null;
  itens?: Array<{
    produtoId?: number;
    quantidade?: number;
    precoUnitario?: number;
    valorDesconto?: number | null;
    tipoDesconto?: string | null;
    subTotal?: number;
    valorTotal?: number;
  }>;
};

type ParamsCtx = { params: Promise<{ id: string }> };

/* ========================= Helpers ========================= */

function parseId(idStr: string) {
  if (!idStr) {
    return {
      error: 'Parâmetro "id" é obrigatório na URL.',
      status: 400,
      id: null as number | null,
    };
  }

  const id = Number(idStr);
  if (Number.isNaN(id)) {
    return {
      error: 'Parâmetro "id" inválido. Deve ser numérico.',
      status: 400,
      id: null as number | null,
    };
  }

  return { id, error: null as string | null, status: 200 };
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

async function resolveUsuarioInternoId(session: any): Promise<string | null> {
  const directId = (session?.user as any)?.id as string | undefined;
  const email = (session?.user?.email as string | undefined) ?? null;

  if (directId) {
    const byId = await supabaseAdmin
      .from("usuario")
      .select("id")
      .eq("id", directId)
      .maybeSingle();

    if (byId.data?.id) return String(byId.data.id);
  }

  if (email) {
    const byEmail = await supabaseAdmin
      .from("usuario")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (byEmail.data?.id) return String(byEmail.data.id);
  }

  return null;
}

/* ========================= GET /api/venda/[id] ========================= */

export async function GET(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasAccess();

    const { id: idStr } = await ctx.params;
    const parsed = parseId(idStr);

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const vendaId = parsed.id as number;

    const { data, error } = await supabaseAdmin
      .from("venda")
      .select(VENDA_SELECT)
      .eq("id", vendaId)
      .single();

    if (error) {
      console.error("Erro ao buscar venda por id:", error);
      return NextResponse.json({ error: "Erro ao buscar venda." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (e: any) {
    console.error("Erro inesperado no GET /venda/[id]:", e);
    return NextResponse.json(
      { error: e?.message || "Erro interno do servidor." },
      { status: 500 }
    );
  }
}

/* ========================= PATCH /api/venda/[id] ========================= */

export async function PATCH(req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasEdit();
    const { id: idStr } = await ctx.params;
    const parsed = parseId(idStr);

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const session = await auth();
    const usuarioInternoId = await resolveUsuarioInternoId(session);

    const vendaId = parsed.id as number;
    const body = (await req.json().catch(() => null)) as VendaPatchBody | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Body inválido. Envie um JSON com campos a atualizar." },
        { status: 400 }
      );
    }

    if (String(body.status ?? "").toUpperCase() === "PAGAMENTO") {
      const atual = await supabaseAdmin
        .from("venda")
        .select("status")
        .eq("id", vendaId)
        .maybeSingle();
      if (atual.error) throw atual.error;
      if (!atual.data) return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });

      if (String(atual.data.status).toUpperCase() === "ORCAMENTO") {
        const aprovacao = await supabaseAdmin.rpc("fn_aprovar_orcamento_venda", {
          p_venda_id: vendaId,
          p_forma_pagamento: body.formaPagamento ?? null,
        });
        if (aprovacao.error) {
          const message = aprovacao.error.message || "Não foi possível aprovar o orçamento.";
          const statusCode = /estoque|orçamento|orcamento/i.test(message) ? 409 : 500;
          return NextResponse.json({ error: message }, { status: statusCode });
        }
        if (usuarioInternoId) {
          await supabaseAdmin.from("venda").update({ updated_by: usuarioInternoId }).eq("id", vendaId);
        }
        const refreshed = await supabaseAdmin.from("venda").select(VENDA_SELECT).eq("id", vendaId).single();
        if (refreshed.error) throw refreshed.error;
        return NextResponse.json({ message: "Orçamento aprovado com sucesso.", data: refreshed.data });
      }
    }

    const {
      clienteId,
      status,
      statusEntrega,
      codigoRastreio,
      transportadoraRastreio,
      nfeChaveAcesso,
      danfeUrl,
      descontoTipo,
      descontoValor,
      valorFrete,
      acrescimoFinanceiroTipo,
      acrescimoFinanceiroValor,
      formaPagamento,
      subTotal,
      valorTotal,
      dataVenda,
      observacoes,
      observacoesFiscais,
      vendedor,
      categoriaVendaId,
      itens,
    } = body;

    if (
      clienteId === undefined &&
      status === undefined &&
      statusEntrega === undefined &&
      codigoRastreio === undefined &&
      transportadoraRastreio === undefined &&
      nfeChaveAcesso === undefined &&
      danfeUrl === undefined &&
      descontoTipo === undefined &&
      descontoValor === undefined &&
      valorFrete === undefined &&
      acrescimoFinanceiroTipo === undefined &&
      acrescimoFinanceiroValor === undefined &&
      formaPagamento === undefined &&
      subTotal === undefined &&
      valorTotal === undefined &&
      dataVenda === undefined &&
      observacoes === undefined &&
      observacoesFiscais === undefined &&
      vendedor === undefined &&
      categoriaVendaId === undefined &&
      itens === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Nenhum campo para atualização foi enviado. Informe pelo menos um campo.",
        },
        { status: 400 }
      );
    }

    const updatePayload: any = {};
    const roundSaleMoney = (value: number) => Math.round(value * 100) / 100;
    let normalizedItems: Array<{
      produtoId: number;
      quantidade: number;
      precoUnitario: number;
      subTotal: number;
      valorTotal: number;
      valorDesconto: number;
      tipoDesconto: "FIXO" | "PORCENTAGEM" | null;
    }> | null = null;
    let resolvedSubTotal = subTotal;
    let resolvedValorTotal = valorTotal;
    let resolvedDescontoTipo = descontoTipo;
    let resolvedDescontoValor = descontoValor;
    let resolvedValorFrete = valorFrete;

    if (itens !== undefined) {
      if (!Array.isArray(itens) || itens.length === 0) {
        return NextResponse.json(
          { error: "A venda deve possuir ao menos um produto." },
          { status: 400 },
        );
      }

      const productIds = itens.map((item) => Number(item.produtoId));
      if (
        productIds.some((id) => !Number.isInteger(id) || id <= 0) ||
        new Set(productIds).size !== productIds.length
      ) {
        return NextResponse.json(
          { error: "Os produtos da venda são inválidos ou estão duplicados." },
          { status: 400 },
        );
      }

      const [{ data: currentSale, error: currentSaleError }, { data: products, error: productsError }] =
        await Promise.all([
          supabaseAdmin
            .from("venda")
            .select("desconto_tipo, desconto_valor, valor_frete")
            .eq("id", vendaId)
            .maybeSingle(),
          supabaseAdmin.from("produto").select("id, precovenda").in("id", productIds),
        ]);

      if (currentSaleError) throw currentSaleError;
      if (productsError) throw productsError;
      if (!currentSale) {
        return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
      }

      const priceByProduct = new Map(
        (products ?? []).map((product) => [Number(product.id), Number(product.precovenda)]),
      );
      if (priceByProduct.size !== productIds.length) {
        return NextResponse.json({ error: "Um ou mais produtos não existem." }, { status: 400 });
      }

      normalizedItems = [];
      let itemDiscountTotal = 0;

      for (const item of itens) {
        const produtoId = Number(item.produtoId);
        const quantidade = Number(item.quantidade);
        const precoUnitario = Number(item.precoUnitario ?? priceByProduct.get(produtoId));
        const tipoDescontoItem =
          item.tipoDesconto === "FIXO" || item.tipoDesconto === "PORCENTAGEM"
            ? item.tipoDesconto
            : null;
        const valorDescontoItem = tipoDescontoItem ? Number(item.valorDesconto ?? 0) : 0;

        if (!Number.isInteger(quantidade) || quantidade <= 0) {
          return NextResponse.json(
            { error: `Informe uma quantidade válida para o produto ${produtoId}.` },
            { status: 400 },
          );
        }
        if (!Number.isFinite(precoUnitario) || precoUnitario <= 0) {
          return NextResponse.json(
            { error: `Informe um preço unitário maior que zero para o produto ${produtoId}.` },
            { status: 400 },
          );
        }
        if (!Number.isFinite(valorDescontoItem) || valorDescontoItem < 0) {
          return NextResponse.json(
            { error: `O desconto do produto ${produtoId} é inválido.` },
            { status: 400 },
          );
        }

        const itemSubTotal = roundSaleMoney(precoUnitario * quantidade);
        const itemDiscountApplied = tipoDescontoItem === "PORCENTAGEM"
          ? roundSaleMoney(itemSubTotal * (Math.min(valorDescontoItem, 100) / 100))
          : Math.min(itemSubTotal, roundSaleMoney(valorDescontoItem));
        if (tipoDescontoItem === "PORCENTAGEM" && valorDescontoItem > 100) {
          return NextResponse.json(
            { error: `O desconto percentual do produto ${produtoId} não pode ultrapassar 100%.` },
            { status: 400 },
          );
        }

        itemDiscountTotal += itemDiscountApplied;
        normalizedItems.push({
          produtoId,
          quantidade,
          precoUnitario: roundSaleMoney(precoUnitario),
          subTotal: itemSubTotal,
          valorTotal: roundSaleMoney(itemSubTotal - itemDiscountApplied),
          valorDesconto: roundSaleMoney(valorDescontoItem),
          tipoDesconto: tipoDescontoItem,
        });
      }

      resolvedSubTotal = roundSaleMoney(
        normalizedItems.reduce((sum, item) => sum + item.subTotal, 0),
      );
      resolvedDescontoTipo = descontoTipo === undefined
        ? currentSale.desconto_tipo
        : descontoTipo;
      resolvedDescontoValor = descontoValor === undefined
        ? Number(currentSale.desconto_valor ?? 0)
        : Number(descontoValor ?? 0);
      resolvedValorFrete = valorFrete === undefined
        ? Number(currentSale.valor_frete ?? 0)
        : Number(valorFrete ?? 0);

      const baseGeneralDiscount = Math.max(0, resolvedSubTotal - roundSaleMoney(itemDiscountTotal));
      const generalDiscount = resolvedDescontoTipo === "PORCENTAGEM"
        ? roundSaleMoney(baseGeneralDiscount * (Math.min(Number(resolvedDescontoValor ?? 0), 100) / 100))
        : resolvedDescontoTipo === "FIXO"
          ? Math.min(baseGeneralDiscount, roundSaleMoney(Number(resolvedDescontoValor ?? 0)))
          : 0;
      resolvedValorTotal = roundSaleMoney(
        baseGeneralDiscount - generalDiscount + Number(resolvedValorFrete ?? 0),
      );
    }

    const wantsDeliveryFields =
      statusEntrega !== undefined ||
      codigoRastreio !== undefined ||
      transportadoraRastreio !== undefined ||
      nfeChaveAcesso !== undefined ||
      danfeUrl !== undefined;

    // Regras do pedido ONLINE (server-side) para evitar inconsistencias.
    if (wantsDeliveryFields) {
      const { data: vendaBase, error: vendaBaseErr } = await supabaseAdmin
        .from("venda")
        .select("id, canal, status")
        .eq("id", vendaId)
        .single();

      if (vendaBaseErr) {
        console.error("Erro ao buscar venda (base) para validacao:", vendaBaseErr);
        return NextResponse.json({ error: "Erro ao validar venda." }, { status: 500 });
      }

      if (!vendaBase) {
        return NextResponse.json({ error: "Venda nao encontrada." }, { status: 404 });
      }

      const canalUpper = String((vendaBase as any).canal ?? "").toUpperCase();
      const statusAtual = String((vendaBase as any).status ?? "").toUpperCase();

      if (!isMarketplaceCanal(canalUpper)) {
        return NextResponse.json(
          { error: "Campos de entrega/rastreio sao permitidos apenas para vendas de marketplace." },
          { status: 400 }
        );
      }

      const normalizedEntrega = statusEntrega == null ? null : String(statusEntrega).toUpperCase();
      if (
        normalizedEntrega !== null &&
        normalizedEntrega !== "SEPARACAO" &&
        normalizedEntrega !== "ENVIO" &&
        normalizedEntrega !== "ENTREGUE"
      ) {
        return NextResponse.json(
          { error: 'statusEntrega invalido. Use: \"SEPARACAO\", \"ENVIO\" ou \"ENTREGUE\".' },
          { status: 400 }
        );
      }

      // So pode iniciar/alterar entrega depois de pago (ou finalizada).
      if (normalizedEntrega !== null) {
        if (statusAtual !== "PAGO" && statusAtual !== "FINALIZADA") {
          return NextResponse.json(
            { error: "So e possivel iniciar/alterar a entrega apos a venda estar PAGA." },
            { status: 400 }
          );
        }
      }

      // Ao marcar ENVIO, exige codigo de rastreio.
      if (normalizedEntrega === "ENVIO") {
        const code = (codigoRastreio ?? "").toString().trim();
        if (!code) {
          return NextResponse.json(
            { error: "Para marcar como ENVIO, informe o codigo de rastreio." },
            { status: 400 }
          );
        }
      }

      if (statusEntrega !== undefined) updatePayload.status_entrega = normalizedEntrega;
      if (codigoRastreio !== undefined) updatePayload.codigo_rastreio = codigoRastreio?.trim() || null;
      if (transportadoraRastreio !== undefined)
        updatePayload.transportadora_rastreio = transportadoraRastreio?.trim() || null;
      if (nfeChaveAcesso !== undefined) updatePayload.nfe_chave_acesso = nfeChaveAcesso?.trim() || null;
      if (danfeUrl !== undefined) updatePayload.danfe_url = danfeUrl?.trim() || null;
    }

    if (clienteId !== undefined) {
      if (clienteId === null || Number.isNaN(Number(clienteId))) {
        return NextResponse.json({ error: "clienteId inválido." }, { status: 400 });
      }
      updatePayload.clienteid = clienteId;
    }

    // Guardado antes da atualizacao para decidir, depois dela, se o estoque
    // precisa ser devolvido ou baixado de novo por causa da troca de status.
    let statusAnterior: string | null = null;

    if (status !== undefined) {
      const upperStatus = String(status).toUpperCase();
      if (STATUS_CANCELADOS.has(upperStatus)) {
        return NextResponse.json(
          { error: "Use o fluxo de cancelamento da venda para informar o motivo e estornar estoque e transações." },
          { status: 409 },
        );
      }
      if (!STATUS_SET.has(upperStatus as Status)) {
        return NextResponse.json(
          {
            error: `Status inválido. Use um dos: ${Array.from(STATUS_SET).join(", ")}.`,
          },
          { status: 400 }
        );
      }

      const atual = await supabaseAdmin
        .from("venda")
        .select("status")
        .eq("id", vendaId)
        .maybeSingle();
      if (atual.error) throw atual.error;
      if (!atual.data) {
        return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
      }
      statusAnterior = String(atual.data.status ?? "").toUpperCase();

      updatePayload.status = upperStatus;
    }

    if (descontoTipo !== undefined || normalizedItems) {
      if (
        resolvedDescontoTipo !== null &&
        resolvedDescontoTipo !== undefined &&
        resolvedDescontoTipo !== "FIXO" &&
        resolvedDescontoTipo !== "PORCENTAGEM"
      ) {
        return NextResponse.json({ error: "Tipo de desconto inválido." }, { status: 400 });
      }
      updatePayload.desconto_tipo = resolvedDescontoTipo ?? null;
    }
    if (descontoValor !== undefined || normalizedItems) {
      const normalizedDiscount = Number(resolvedDescontoValor ?? 0);
      if (!Number.isFinite(normalizedDiscount) || normalizedDiscount < 0) {
        return NextResponse.json({ error: "Valor do desconto inválido." }, { status: 400 });
      }
      if (resolvedDescontoTipo === "PORCENTAGEM" && normalizedDiscount > 100) {
        return NextResponse.json({ error: "O desconto percentual deve estar entre 0 e 100." }, { status: 400 });
      }
      if (
        resolvedDescontoTipo === "FIXO" &&
        resolvedSubTotal !== undefined &&
        normalizedDiscount > Number(resolvedSubTotal)
      ) {
        return NextResponse.json({ error: "O desconto não pode ultrapassar o subtotal." }, { status: 400 });
      }
      updatePayload.desconto_valor = normalizedDiscount;
    }
    if (valorFrete !== undefined || normalizedItems) {
      const normalizedFreight = Number(resolvedValorFrete ?? 0);
      if (!Number.isFinite(normalizedFreight) || normalizedFreight < 0) {
        return NextResponse.json({ error: "O valor do frete não pode ser negativo." }, { status: 400 });
      }
      updatePayload.valor_frete = roundSaleMoney(normalizedFreight);
    }
    if (acrescimoFinanceiroTipo !== undefined) {
      const normalizedType = sanitizeFinancialSurchargeType(acrescimoFinanceiroTipo);
      if (acrescimoFinanceiroTipo != null && !normalizedType) {
        return NextResponse.json({ error: "Tipo de acréscimo financeiro inválido." }, { status: 400 });
      }
      updatePayload.acrescimo_financeiro_tipo = normalizedType;
    }
    if (acrescimoFinanceiroValor !== undefined) {
      const normalizedValue = Number(acrescimoFinanceiroValor ?? 0);
      if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
        return NextResponse.json({ error: "Valor do acréscimo financeiro inválido." }, { status: 400 });
      }
      const effectiveType = sanitizeFinancialSurchargeType(
        acrescimoFinanceiroTipo === undefined ? updatePayload.acrescimo_financeiro_tipo : acrescimoFinanceiroTipo,
      );
      if (effectiveType === "PORCENTAGEM" && normalizedValue > 100) {
        return NextResponse.json({ error: "O acréscimo percentual deve estar entre 0 e 100." }, { status: 400 });
      }
      updatePayload.acrescimo_financeiro_valor = normalizedValue;
    }
    if (formaPagamento !== undefined) updatePayload.forma_pagamento = formaPagamento;
    if (subTotal !== undefined || normalizedItems) {
      if (!Number.isFinite(Number(resolvedSubTotal)) || Number(resolvedSubTotal) < 0) {
        return NextResponse.json({ error: "Subtotal inválido." }, { status: 400 });
      }
      updatePayload.sub_total = resolvedSubTotal;
    }
    if (valorTotal !== undefined || normalizedItems) {
      if (!Number.isFinite(Number(resolvedValorTotal)) || Number(resolvedValorTotal) < 0) {
        return NextResponse.json({ error: "O total da venda não pode ser negativo." }, { status: 400 });
      }
      updatePayload.valortotal = resolvedValorTotal;
    }
    if (dataVenda !== undefined) updatePayload.datavenda = dataVenda;
    if (observacoes !== undefined) updatePayload.observacoes = observacoes;
    if (observacoesFiscais !== undefined) updatePayload.observacoes_fiscais = observacoesFiscais;
    if (vendedor !== undefined) updatePayload.vendedor = vendedor;
    if (categoriaVendaId !== undefined) {
      if (categoriaVendaId === null) {
        updatePayload.categoriavendaid = null;
      } else {
        const idCategoriaVenda = Number(categoriaVendaId);
        if (!Number.isFinite(idCategoriaVenda) || idCategoriaVenda <= 0) {
          return NextResponse.json({ error: "categoriaVendaId inválido." }, { status: 400 });
        }
        updatePayload.categoriavendaid = Math.trunc(idCategoriaVenda);
      }
    }

    if (
      valorTotal !== undefined ||
      normalizedItems !== null ||
      acrescimoFinanceiroTipo !== undefined ||
      acrescimoFinanceiroValor !== undefined
    ) {
      const [{ data: vendaAtual, error: vendaAtualError }, { data: pagamentos, error: pagamentosError }] =
        await Promise.all([
          supabaseAdmin
            .from("venda")
            .select("valortotal, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
            .eq("id", vendaId)
            .single(),
          supabaseAdmin
            .from("transacao")
            .select("valor")
            .eq("vendaid", vendaId)
            .eq("tipo", "RECEITA")
            .eq("is_deleted", false),
        ]);
      if (vendaAtualError) throw vendaAtualError;
      if (pagamentosError) throw pagamentosError;

      const effectiveSurchargeType = sanitizeFinancialSurchargeType(
        acrescimoFinanceiroTipo === undefined
          ? vendaAtual.acrescimo_financeiro_tipo
          : acrescimoFinanceiroTipo,
      );
      const effectiveSurchargeValue = Number(
        acrescimoFinanceiroValor === undefined
          ? vendaAtual.acrescimo_financeiro_valor
          : acrescimoFinanceiroValor,
      );
      if (effectiveSurchargeType === "PORCENTAGEM" && effectiveSurchargeValue > 100) {
        return NextResponse.json(
          { error: "O acréscimo percentual deve estar entre 0 e 100." },
          { status: 400 },
        );
      }
      const totalFinanceiro = calculateFinancialTotal(
        resolvedValorTotal === undefined ? vendaAtual.valortotal : resolvedValorTotal,
        effectiveSurchargeType,
        effectiveSurchargeValue,
      );
      const totalPago = (pagamentos ?? []).reduce(
        (sum, pagamento) => sum + Number(pagamento.valor ?? 0),
        0,
      );
      if (totalFinanceiro < totalPago) {
        return NextResponse.json(
          { error: "O total financeiro não pode ficar menor que o total já pago." },
          { status: 409 },
        );
      }
    }

    if (normalizedItems) {
      const { error: editItemsError } = await supabaseAdmin.rpc(
        "fn_editar_venda_com_itens",
        {
          p_venda_id: vendaId,
          p_itens: normalizedItems,
          p_sub_total: Number(resolvedSubTotal ?? 0),
          p_valor_total: Number(resolvedValorTotal ?? 0),
          p_desconto_tipo: resolvedDescontoTipo ?? null,
          p_desconto_valor: Number(resolvedDescontoValor ?? 0),
          p_valor_frete: Number(resolvedValorFrete ?? 0),
          p_updated_by: usuarioInternoId,
        },
      );

      if (editItemsError) {
        const message = editItemsError.message || "Não foi possível atualizar os itens da venda.";
        const statusCode = /estoque|itens|produto|nf-e|paga|finalizada|cancelada/i.test(message)
          ? 409
          : 500;
        return NextResponse.json({ error: message }, { status: statusCode });
      }

      delete updatePayload.sub_total;
      delete updatePayload.valortotal;
      delete updatePayload.desconto_tipo;
      delete updatePayload.desconto_valor;
      delete updatePayload.valor_frete;
    }

    updatePayload.updatedat = new Date().toISOString();
    if (usuarioInternoId) updatePayload.updated_by = usuarioInternoId;

    const { data, error } = await supabaseAdmin
      .from("venda")
      .update(updatePayload)
      .eq("id", vendaId)
      .select(VENDA_SELECT)
      .single();

    if (error) {
      console.error("Erro ao atualizar venda:", error);
      return NextResponse.json({ error: "Erro ao atualizar venda." }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
    }

    // Cancelar uma venda devolve o estoque; tirar do cancelamento faz a baixa
    // valer de novo. Sem isso o saldo ficava preso numa venda que nao existe
    // mais para o negocio, e a unica forma de recuperar era excluir a venda.
    //
    // Roda depois da atualizacao porque e nela que moram as validacoes: se o
    // movimento de estoque falhar, o status volta ao que era, para nao sobrar
    // venda cancelada com saldo preso nem o contrario.
    if (statusAnterior !== null && updatePayload.status) {
      const statusNovo = String(updatePayload.status).toUpperCase();
      const eraCancelada = STATUS_CANCELADOS.has(statusAnterior);
      const ficouCancelada = STATUS_CANCELADOS.has(statusNovo);

      let movimento: "fn_estornar_estoque_venda" | "fn_baixar_estoque_venda" | null = null;
      if (!eraCancelada && ficouCancelada) {
        movimento = "fn_estornar_estoque_venda";
      } else if (eraCancelada && !ficouCancelada && statusNovo !== "ORCAMENTO") {
        // Orcamento nao reserva estoque, entao voltar para ele nao rebaixa nada.
        movimento = "fn_baixar_estoque_venda";
      }

      if (movimento) {
        const { error: movimentoError } = await supabaseAdmin.rpc(movimento, {
          p_venda_id: vendaId,
        });

        if (movimentoError) {
          await supabaseAdmin
            .from("venda")
            .update({ status: statusAnterior })
            .eq("id", vendaId);

          console.error("Erro ao ajustar o estoque na troca de status da venda:", movimentoError);
          return NextResponse.json(
            {
              error:
                movimento === "fn_estornar_estoque_venda"
                  ? "Erro ao estornar o estoque da venda. O status foi mantido."
                  : `Erro ao rebaixar o estoque da venda: ${movimentoError.message ?? "falha desconhecida"}. O status foi mantido.`,
            },
            { status: 409 }
          );
        }
      }
    }

    if (normalizedItems) {
      const productIds = normalizedItems.map((item) => item.produtoId);
      await syncPendingMercadoLivreStock({
        productIds,
        limit: productIds.length || 1,
      }).catch((syncError) => {
        console.warn("Venda editada; sincronização imediata do estoque Mercado Livre ficou pendente.", syncError);
      });
    }

    return NextResponse.json({
      message: "Venda atualizada com sucesso.",
      data,
    });
  } catch (e: any) {
    console.error("Erro inesperado no PATCH /venda/[id]:", e);
    return NextResponse.json(
      { error: e?.message || "Erro interno do servidor." },
      { status: 500 }
    );
  }
}

function isMarketplaceCanal(canal: unknown) {
  const value = String(canal ?? "").toUpperCase();
  return value === "ONLINE" || value === "MERCADO_LIVRE" || value === "SHOPEE";
}

/* ========================= DELETE /api/venda/[id] ========================= */
/**
 * Exclui uma venda fazendo:
 * - Bloqueio se existir NF-e vinculada com status <> RASCUNHO (inclui AUTORIZADA e CANCELADA)
 * - Estorno de estoque (produto.estoque += vendaproduto.quantidade)
 * - Delete de transacao vinculada
 * - Delete de vendaproduto
 * - Delete da venda
 */
export async function DELETE(_req: NextRequest, ctx: ParamsCtx) {
  try {
    await requireVendasDelete();

    const { id: idStr } = await ctx.params;
    const parsed = parseId(idStr);

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const vendaId = parsed.id as number;

    const { data: vendaBaseEstorno, error: vendaBaseEstornoError } = await supabaseAdmin
      .from("venda")
      .select("status")
      .eq("id", vendaId)
      .maybeSingle();
    if (vendaBaseEstornoError) throw vendaBaseEstornoError;
    if (!vendaBaseEstorno) return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });

    // 1) Bloqueia exclusão se já existe NF-e vinculada à venda que NÃO esteja em RASCUNHO
    const { data: nfesBloqueantes, error: nfeError } = await supabaseAdmin
      .from("nfe")
      .select("id, status, chave_acesso, protocolo")
      .eq("vendaid", vendaId)
      .neq("status", "RASCUNHO") // AUTORIZADA, CANCELADA, REJEITADA, DENEGADA, etc. bloqueiam
      .limit(1);

    if (nfeError) {
      console.error("Erro ao verificar NF-e vinculadas à venda:", nfeError);
      return NextResponse.json(
        { error: "Erro ao verificar NF-e vinculadas à venda. Exclusão não realizada." },
        { status: 500 }
      );
    }

    if (nfesBloqueantes && nfesBloqueantes.length > 0) {
      const nfe = nfesBloqueantes[0];
      return NextResponse.json(
        {
          error:
            "Não é possível excluir a venda pois existe NF-e vinculada (já registrada na SEFAZ).",
          nfeVinculada: {
            id: nfe.id,
            status: nfe.status,
            chave_acesso: nfe.chave_acesso,
            protocolo: nfe.protocolo,
          },
        },
        { status: 409 }
      );
    }

    // 2) Buscar itens da venda (para estornar estoque)
    const { data: itensVenda, error: itensError } = await supabaseAdmin
      .from("vendaproduto")
      .select("id, produtoid, quantidade")
      .eq("venda_id", vendaId);

    if (itensError) {
      console.error("Erro ao buscar itens da venda (vendaproduto):", itensError);
      return NextResponse.json(
        { error: "Erro ao buscar itens da venda para estornar estoque." },
        { status: 500 }
      );
    }

    const { data: baixasRegistradas, error: baixasError } = await supabaseAdmin
      .from("vendaproduto_baixa")
      .select("produtoid, quantidade")
      .eq("venda_id", vendaId);
    if (baixasError) throw baixasError;

    // A baixa registrada é a fonte oficial. Para vendas legadas sem rastreamento,
    // os itens só são usados como fallback quando não se trata de um orçamento.
    const qtyPorProduto = new Map<number, number>();
    const origemEstorno = (baixasRegistradas?.length ?? 0) > 0
      ? baixasRegistradas
      : String(vendaBaseEstorno.status).toUpperCase() === "ORCAMENTO"
        ? []
        : itensVenda;

    for (const row of origemEstorno ?? []) {
      const produtoId = Number((row as any).produtoid);
      const qtd = toInt((row as any).quantidade);

      if (!Number.isFinite(produtoId) || produtoId <= 0) {
        return NextResponse.json(
          { error: "Item da venda com produtoid inválido. Exclusão abortada." },
          { status: 400 }
        );
      }

      if (qtd === null) {
        return NextResponse.json(
          { error: `Quantidade inválida no item do produto ${produtoId}. Exclusão abortada.` },
          { status: 400 }
        );
      }

      qtyPorProduto.set(produtoId, (qtyPorProduto.get(produtoId) ?? 0) + qtd);
    }

    const produtoIds = Array.from(qtyPorProduto.keys());

    // 3) Estornar estoque
    //
    // O estorno roda em fn_estornar_estoque_venda, que devolve o saldo a partir da
    // baixa registrada, trava a venda e carimba o movimento no razao de estoque.
    // Antes isso era feito aqui lendo o saldo e regravando o valor absoluto, sem
    // travar a linha e sem deixar rastro da devolucao.
    //
    // Vendas legadas, anteriores ao rastreamento, tem a baixa semeada a partir dos
    // itens antes do estorno, para percorrerem exatamente o mesmo caminho.
    if (produtoIds.length > 0) {
      if ((baixasRegistradas?.length ?? 0) === 0) {
        const { error: seedError } = await supabaseAdmin.from("vendaproduto_baixa").upsert(
          produtoIds.map((pid) => ({
            venda_id: vendaId,
            produtoid: pid,
            quantidade: qtyPorProduto.get(pid) ?? 0,
          })),
          { onConflict: "venda_id,produtoid" }
        );

        if (seedError) {
          console.error("Erro ao registrar a baixa legada da venda:", seedError);
          return NextResponse.json(
            { error: "Erro ao preparar o estorno de estoque da venda. Exclusão abortada." },
            { status: 500 }
          );
        }
      }

      const { error: estornoError } = await supabaseAdmin.rpc("fn_estornar_estoque_venda", {
        p_venda_id: vendaId,
      });

      if (estornoError) {
        console.error("Erro ao estornar estoque da venda:", estornoError);
        return NextResponse.json(
          { error: "Erro ao estornar estoque da venda. Exclusão abortada." },
          { status: 500 }
        );
      }
    }

    // 4) Excluir transações vinculadas à venda
    const { error: delTransError } = await supabaseAdmin
      .from("transacao")
      .delete()
      .eq("vendaid", vendaId);

    if (delTransError) {
      console.error("Erro ao excluir transações da venda:", delTransError);
      return NextResponse.json(
        { error: "Erro ao excluir transações vinculadas à venda. Exclusão não realizada." },
        { status: 500 }
      );
    }

    // 5) Excluir itens da venda (vendaproduto)
    const { error: delItensError } = await supabaseAdmin
      .from("vendaproduto")
      .delete()
      .eq("venda_id", vendaId);

    if (delItensError) {
      console.error("Erro ao excluir itens (vendaproduto) da venda:", delItensError);
      return NextResponse.json(
        { error: "Erro ao excluir itens da venda. Exclusão não realizada." },
        { status: 500 }
      );
    }

    // 6) Excluir a venda
    const { data: vendaDel, error: delVendaError } = await supabaseAdmin
      .from("venda")
      .delete()
      .eq("id", vendaId)
      .select("id")
      .maybeSingle();

    if (delVendaError) {
      console.error("Erro ao excluir venda:", delVendaError);
      return NextResponse.json({ error: "Erro ao excluir venda." }, { status: 500 });
    }

    if (!vendaDel) {
      return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
    }

    const marketplaceStockSync = await syncPendingMercadoLivreStock({
      productIds: produtoIds,
      limit: produtoIds.length || 1,
    }).catch((error: any) => {
      console.warn("Venda excluída; sincronização imediata do estoque Mercado Livre ficou pendente.", error);
      return [];
    });

    return NextResponse.json({
      message: "Venda excluída com sucesso (transações removidas e estoque estornado).",
      id: vendaDel.id,
      estorno: {
        produtosAfetados: produtoIds.length,
        quantidadePorProduto: Object.fromEntries(qtyPorProduto.entries()),
      },
      marketplaceStockSync,
    });
  } catch (e: any) {
    console.error("Erro inesperado no DELETE /venda/[id]:", e);
    return NextResponse.json(
      { error: e?.message || "Erro interno do servidor." },
      { status: 500 }
    );
  }
}
