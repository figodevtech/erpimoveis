// src/app/api/venda/[id]/route.ts

export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { auth } from "@/lib/auth";
import { requireVendasAccess, requireVendasDelete, requireVendasEdit } from "@/app/api/_authz/perms";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";

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
  criador:created_by ( id, nome ),
  comissao_venda_percent_aplicada,
  vendedor_rel:vendedor ( id, nome ),
  editor:updated_by ( id, nome ),
  desconto_tipo,
  desconto_valor,
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
  formaPagamento?: string | null;
  subTotal?: number;
  valorTotal?: number;
  dataVenda?: string | null; // ISO string
  observacoes?: string | null;
  observacoesFiscais?: string | null;
  vendedor?: string | null;
  categoriaVendaId?: number | null;
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
      formaPagamento,
      subTotal,
      valorTotal,
      dataVenda,
      observacoes,
      observacoesFiscais,
      vendedor,
      categoriaVendaId,
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
      formaPagamento === undefined &&
      subTotal === undefined &&
      valorTotal === undefined &&
      dataVenda === undefined &&
      observacoes === undefined &&
      observacoesFiscais === undefined &&
      vendedor === undefined &&
      categoriaVendaId === undefined
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

    if (status !== undefined) {
      const upperStatus = String(status).toUpperCase();
      if (!STATUS_SET.has(upperStatus as Status)) {
        return NextResponse.json(
          {
            error: `Status inválido. Use um dos: ${Array.from(STATUS_SET).join(", ")}.`,
          },
          { status: 400 }
        );
      }
      updatePayload.status = upperStatus;
    }

    if (descontoTipo !== undefined) updatePayload.desconto_tipo = descontoTipo;
    if (descontoValor !== undefined) updatePayload.desconto_valor = descontoValor;
    if (formaPagamento !== undefined) updatePayload.forma_pagamento = formaPagamento;
    if (subTotal !== undefined) updatePayload.sub_total = subTotal;
    if (valorTotal !== undefined) updatePayload.valortotal = valorTotal;
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

    // Agrupar quantidade por produto
    const qtyPorProduto = new Map<number, number>();

    for (const row of itensVenda ?? []) {
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

    // 3) Estornar estoque (produto.estoque += qty)
    if (produtoIds.length > 0) {
      const { data: produtos, error: produtosError } = await supabaseAdmin
        .from("produto")
        .select("id, estoque")
        .in("id", produtoIds);

      if (produtosError) {
        console.error("Erro ao buscar produtos para estorno de estoque:", produtosError);
        return NextResponse.json(
          { error: "Erro ao buscar produtos para estornar estoque." },
          { status: 500 }
        );
      }

      const estoqueAtualPorId = new Map<number, number>();
      for (const p of produtos ?? []) {
        const id = Number((p as any).id);
        const est = Number((p as any).estoque ?? 0);
        estoqueAtualPorId.set(id, Number.isFinite(est) ? est : 0);
      }

      for (const pid of produtoIds) {
        if (!estoqueAtualPorId.has(pid)) {
          return NextResponse.json(
            { error: `Produto ${pid} não encontrado para estorno de estoque. Exclusão abortada.` },
            { status: 400 }
          );
        }

        const estoqueAtual = estoqueAtualPorId.get(pid) ?? 0;
        const estornar = qtyPorProduto.get(pid) ?? 0;
        const novoEstoque = estoqueAtual + estornar;

        const { error: updErr } = await supabaseAdmin
          .from("produto")
          .update({
            estoque: novoEstoque,
            updatedat: new Date().toISOString(),
          })
          .eq("id", pid);

        if (updErr) {
          console.error(`Erro ao atualizar estoque do produto ${pid}:`, updErr);
          return NextResponse.json(
            { error: `Erro ao estornar estoque do produto ${pid}. Exclusão abortada.` },
            { status: 500 }
          );
        }
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
