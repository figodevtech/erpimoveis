export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { carregarAutores } from "@/lib/movement-authors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

/**
 * Contexto de uma transacao para as abas do dialog: lancamentos relacionados,
 * cliente/fornecedor, documento de origem e trilha de auditoria.
 *
 * Somente leitura — nada aqui altera transacao.
 */

const RELACIONADA_FIELDS =
  'id, descricao, descricao_pagamento, valor, "valorLiquido", data, vencimento_em, pago_em, pendente, tipo, metodopagamento, evento_financeiro_id, created_at, baixado_por, banco:bancoconta!transacao_banco_id_fkey ( id, titulo )';

/** O sufixo que o POST acrescenta a cada parcela criada em lote. */
const SUFIXO_PARCELA = / - Parcela \d+\/\d+$/;

const toCents = (value: unknown) => Math.round((Number(value) || 0) * 100);
const fromCents = (cents: number) => Number((cents / 100).toFixed(2));

/**
 * Um lancamento entra no somatorio de "quanto falta" quando é uma receita de
 * pagamento — a mesma regra que /delete-impact usa para reabrir OS e venda.
 * Despesas vinculadas (custo interno da OS) aparecem na lista, mas nao abatem.
 */
function contaParaTotal(transacao: any) {
  return (
    String(transacao?.tipo ?? "").toUpperCase() === "RECEITA" &&
    transacao?.evento_financeiro_id == null
  );
}

function resumirLancamentos(itens: any[], totalDevidoCents: number | null) {
  let pagoCents = 0;
  let pendenteCents = 0;

  for (const item of itens) {
    if (!contaParaTotal(item)) continue;
    const cents = toCents(item.valor);
    if (item.pendente) pendenteCents += cents;
    else pagoCents += cents;
  }

  return {
    totalDevido: totalDevidoCents == null ? null : fromCents(totalDevidoCents),
    pago: fromCents(pagoCents),
    pendente: fromCents(pendenteCents),
    lancado: fromCents(pagoCents + pendenteCents),
    // Sem documento de origem nao existe "quanto falta": o grupo é o proprio total.
    restante:
      totalDevidoCents == null
        ? null
        : fromCents(Math.max(0, totalDevidoCents - pagoCents)),
  };
}

export async function GET(_: Request, { params }: Params) {
  try {
    await requireFinanceirosAccess();

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const { data: transacao, error: transacaoError } = await supabaseAdmin
      .from("transacao")
      .select(
        "id, descricao, valor, data, tipo, pendente, created_at, updated_at, created_by, updated_by, baixado_por, cliente_id, fornecedor_id, ordemservicoid, vendaid, evento_financeiro_id",
      )
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (transacaoError) throw transacaoError;
    if (!transacao) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    /* ---------- Lancamentos relacionados ---------- */

    let origem: "OS" | "VENDA" | "PARCELAMENTO" | "NENHUM" = "NENHUM";
    let relacionadas: any[] = [];
    let totalDevidoCents: number | null = null;
    let vinculo: Record<string, any> | null = null;

    if (transacao.ordemservicoid != null) {
      origem = "OS";
      const osId = Number(transacao.ordemservicoid);

      const [{ data: ordem }, { data: itens, error: itensError }] = await Promise.all([
        supabaseAdmin
          .from("ordemservico")
          .select(
            "id, status, orcamentototal, dataentrada, datasaida, descricao, acrescimo_financeiro_tipo, acrescimo_financeiro_valor, veiculo:veiculoid ( marca, modelo, placa, placa_formatada )",
          )
          .eq("id", osId)
          .maybeSingle(),
        supabaseAdmin
          .from("transacao")
          .select(RELACIONADA_FIELDS)
          .eq("ordemservicoid", osId)
          .eq("is_deleted", false)
          .order("data", { ascending: true })
          .order("id", { ascending: true }),
      ]);

      if (itensError) throw itensError;
      relacionadas = itens ?? [];

      if (ordem) {
        totalDevidoCents = toCents(
          calculateFinancialTotal(
            ordem.orcamentototal,
            ordem.acrescimo_financeiro_tipo,
            ordem.acrescimo_financeiro_valor,
          ),
        );
        const veiculo = Array.isArray(ordem.veiculo) ? ordem.veiculo[0] : ordem.veiculo;
        vinculo = {
          tipo: "OS",
          id: ordem.id,
          status: ordem.status ?? null,
          total: fromCents(totalDevidoCents),
          descricao: ordem.descricao ?? null,
          dataentrada: ordem.dataentrada ?? null,
          datasaida: ordem.datasaida ?? null,
          veiculo: veiculo
            ? {
                nome: [veiculo.marca, veiculo.modelo].filter(Boolean).join(" ") || null,
                // A placa cadastrada, nao o equivalente Mercosul gerado.
                placa: veiculo.placa ?? veiculo.placa_formatada ?? null,
              }
            : null,
          // Nao existe rota de detalhe /ordens/[id] — os detalhes sao dialog na
          // listagem. A impressao e o unico destino enderecavel por id.
          href: `/print/ordemservico/${ordem.id}`,
        };
      }
    } else if (transacao.vendaid != null) {
      origem = "VENDA";
      const vendaId = Number(transacao.vendaid);

      const [{ data: venda }, { data: itens, error: itensError }] = await Promise.all([
        supabaseAdmin
          .from("venda")
          .select(
            "id, status, valortotal, datavenda, createdat, acrescimo_financeiro_tipo, acrescimo_financeiro_valor",
          )
          .eq("id", vendaId)
          .maybeSingle(),
        supabaseAdmin
          .from("transacao")
          .select(RELACIONADA_FIELDS)
          .eq("vendaid", vendaId)
          .eq("is_deleted", false)
          .order("data", { ascending: true })
          .order("id", { ascending: true }),
      ]);

      if (itensError) throw itensError;
      relacionadas = itens ?? [];

      if (venda) {
        totalDevidoCents = toCents(
          calculateFinancialTotal(
            venda.valortotal,
            venda.acrescimo_financeiro_tipo,
            venda.acrescimo_financeiro_valor,
          ),
        );
        vinculo = {
          tipo: "VENDA",
          id: venda.id,
          status: venda.status ?? null,
          total: fromCents(totalDevidoCents),
          datavenda: venda.datavenda ?? venda.createdat ?? null,
          href: `/print/venda/${venda.id}/orcamento`,
        };
      }
    } else if (SUFIXO_PARCELA.test(String(transacao.descricao ?? ""))) {
      // Parcelamento avulso: nao existe coluna que agrupe as parcelas. As linhas
      // nascem de um unico insert, entao compartilham `created_at` exato e a mesma
      // descricao base. É heuristica — o front avisa o usuario.
      origem = "PARCELAMENTO";
      const base = String(transacao.descricao).replace(SUFIXO_PARCELA, "");

      const { data: itens, error: itensError } = await supabaseAdmin
        .from("transacao")
        .select(RELACIONADA_FIELDS)
        .eq("created_at", transacao.created_at)
        .eq("is_deleted", false)
        .like("descricao", `${base} - Parcela %`)
        .order("data", { ascending: true })
        .order("id", { ascending: true });

      if (itensError) throw itensError;
      relacionadas = itens ?? [];
    }

    /* ---------- Cliente / fornecedor ---------- */

    const [{ data: cliente }, { data: fornecedor }] = await Promise.all([
      transacao.cliente_id != null
        ? supabaseAdmin
            .from("cliente")
            .select(
              "id, nomerazaosocial, cpfcnpj, telefone, email, endereco, endereconumero, enderecocomplemento, bairro, cidade, estado, cep",
            )
            .eq("id", transacao.cliente_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      transacao.fornecedor_id != null
        ? supabaseAdmin
            .from("fornecedor")
            .select(
              "id, nomerazaosocial, nomefantasia, cpfcnpj, contato, endereco, endereconumero, bairro, cidade, estado, cep",
            )
            .eq("id", transacao.fornecedor_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    /* ---------- Historico de baixa e auditoria ---------- */

    const { data: baixa } = await supabaseAdmin
      .from("transacao_baixa_historico")
      .select("vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, created_at")
      .eq("transacao_id", id)
      .maybeSingle();

    // `baixado_por`/`created_by` sao uuid soltos, sem FK para `usuario`.
    const autores = await carregarAutores([
      transacao.created_by,
      transacao.updated_by,
      transacao.baixado_por,
      baixa?.baixado_por,
      ...relacionadas.map((item) => item.baixado_por),
    ]);
    const autor = (valor: unknown) => autores.get(String(valor ?? "")) ?? null;

    return NextResponse.json({
      relacionadas: {
        origem,
        itens: relacionadas.map((item) => ({
          ...item,
          contaParaTotal: contaParaTotal(item),
          baixadoPor: autor(item.baixado_por),
        })),
        resumo: resumirLancamentos(relacionadas, totalDevidoCents),
      },
      cliente: cliente ?? null,
      fornecedor: fornecedor ?? null,
      vinculo,
      baixa: baixa
        ? { ...baixa, baixadoPor: autor(baixa.baixado_por) }
        : null,
      auditoria: {
        created_at: transacao.created_at ?? null,
        updated_at: transacao.updated_at ?? null,
        criadoPor: autor(transacao.created_by),
        alteradoPor: autor(transacao.updated_by),
        baixadoPor: autor(transacao.baixado_por),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar o contexto da transação." },
      { status: 500 },
    );
  }
}
