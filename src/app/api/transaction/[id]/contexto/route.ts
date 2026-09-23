export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { carregarAutores } from "@/lib/movement-authors";
import { modoDeReparcelamento } from "@/lib/financeiro/reparcelamento-modo";
import { tipoEhEntradaDeCaixa, valorDeFace } from "@/lib/financeiro/transacao";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao } from "../../_lib/autoria";

type Params = { params: Promise<{ id: string }> };

/**
 * Contexto de uma transacao para as abas do dialog: lancamentos relacionados,
 * cliente/fornecedor, documento de origem e trilha de auditoria.
 *
 * Somente leitura — nada aqui altera transacao.
 */

const RELACIONADA_FIELDS =
  'id, descricao, descricao_pagamento, valor, "valorLiquido", valor_base, valor_acrescimos, valor_descontos, data, vencimento_em, pago_em, pendente, tipo, metodopagamento, evento_financeiro_id, created_at, baixado_por, banco:bancoconta!transacao_banco_id_fkey ( id, titulo )';

/** O sufixo que o POST acrescenta a cada parcela criada em lote. */
const SUFIXO_PARCELA = / - Parcela \d+\/\d+$/;

const toCents = (value: unknown) => Math.round((Number(value) || 0) * 100);
const fromCents = (cents: number) => Number((cents / 100).toFixed(2));

type OrigemDoContexto = "OS" | "VENDA" | "PARCELAMENTO" | "NENHUM";

/**
 * Um lancamento entra no somatorio de "quanto falta".
 *
 * Com documento (OS ou venda), so receita de pagamento abate — a mesma regra que
 * /delete-impact usa para reabrir OS e venda. Despesa vinculada (custo interno
 * da ordem) aparece na lista, mas nao desconta do que o cliente deve.
 *
 * Num parcelamento avulso nao existe documento a abater: o grupo E o total. Aqui
 * toda parcela conta, inclusive de despesa — senao um parcelamento de conta a
 * pagar mostra "pago R$ 0,00" com todas as parcelas quitadas, que era o que
 * acontecia enquanto a regra de receita valia para os dois casos.
 */
function contaParaTotal(transacao: any, origem: OrigemDoContexto) {
  if (transacao?.evento_financeiro_id != null) return false;
  if (origem === "PARCELAMENTO") return true;
  return String(transacao?.tipo ?? "").toUpperCase() === "RECEITA";
}

function resumirLancamentos(
  itens: any[],
  totalDevidoCents: number | null,
  origem: OrigemDoContexto,
) {
  let pagoCents = 0;
  let pendenteCents = 0;

  for (const item of itens) {
    if (!contaParaTotal(item, origem)) continue;
    // Face, nao bruto: acrescimo e do pagamento, nao do documento.
    // `revalidarStatusOrdem`, `resumirPagamentos` e /delete-impact ja somam a
    // face. Somar o bruto aqui fazia esta aba discordar da propria OS: pague uma
    // parcela com juros e a barra enchia enquanto a ordem seguia em aberto.
    const cents = toCents(valorDeFace(item));
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
        "id, descricao, valor, data, tipo, pendente, created_at, updated_at, created_by, updated_by, baixado_por, cliente_id, fornecedor_id, ordemservicoid, vendaid, evento_financeiro_id, pagamento_multiplo_id, parcelamento_id, baixa_de_transacao_id, transferencia_id, entrada_id, usoconsumo_entrada_id, adiantamento_id, eh_adiantamento",
      )
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();

    if (transacaoError) throw transacaoError;
    if (!transacao) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    await exigirAcessoATransacao(id);

    /* ---------- Lancamentos relacionados ---------- */

    let origem: OrigemDoContexto = "NENHUM";
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
    } else if (transacao.pagamento_multiplo_id != null) {
      // Pagamento múltiplo: a transação não aponta para documento nenhum porque
      // cobre vários. As irmãs são as outras parcelas do mesmo grupo, e aqui o
      // vínculo é exato — não depende da heurística de descrição usada no
      // parcelamento avulso.
      const { data: irmas, error: irmasError } = await supabaseAdmin
        .from("transacao")
        .select(RELACIONADA_FIELDS)
        .eq("pagamento_multiplo_id", transacao.pagamento_multiplo_id)
        .eq("is_deleted", false)
        .order("data", { ascending: true })
        .order("id", { ascending: true });

      if (irmasError) throw irmasError;
      relacionadas = irmas ?? [];
      if (relacionadas.length > 1) origem = "PARCELAMENTO";
    } else if (transacao.parcelamento_id != null) {
      // Parcelamento avulso com grupo formal: o vínculo é exato, e é ele que
      // libera o reparcelamento. A heurística abaixo continua atendendo os grupos
      // anteriores à coluna que o backfill não conseguiu amarrar.
      origem = "PARCELAMENTO";

      const { data: itens, error: itensError } = await supabaseAdmin
        .from("transacao")
        .select(RELACIONADA_FIELDS)
        .eq("parcelamento_id", transacao.parcelamento_id)
        .eq("is_deleted", false)
        .order("data", { ascending: true })
        .order("id", { ascending: true });

      if (itensError) throw itensError;
      relacionadas = itens ?? [];
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

    /* ---------- Pagamento múltiplo ---------- */

    // Quais documentos este recebimento quitou, e quanto coube a cada um. É a
    // única resposta possível para "o que foi baixado com este dinheiro": a
    // transação sozinha não sabe, porque cobre vários documentos.
    let pagamentoMultiplo: Record<string, any> | null = null;

    if (transacao.pagamento_multiplo_id != null) {
      const grupoId = Number(transacao.pagamento_multiplo_id);
      const [{ data: grupo }, { data: rateio, error: rateioError }] = await Promise.all([
        supabaseAdmin
          .from("pagamento_multiplo")
          .select("id, descricao, modo, tipo_documento, valor_total, data")
          .eq("id", grupoId)
          .maybeSingle(),
        supabaseAdmin
          .from("pagamento_multiplo_rateio")
          .select("transacao_id, tipo_documento, documento_id, valor")
          .eq("pagamento_multiplo_id", grupoId)
          .order("documento_id", { ascending: true }),
      ]);
      if (rateioError) throw rateioError;

      const linhas = rateio ?? [];
      const desteLancamento = linhas.filter(
        (linha: any) => Number(linha.transacao_id) === id,
      );
      // Numa parcela, o rateio dela; num pagamento à vista dá no mesmo, porque só
      // existe uma transação no grupo.
      const documentos = (desteLancamento.length > 0 ? desteLancamento : linhas).map(
        (linha: any) => ({
          tipo: String(linha.tipo_documento) === "OS" ? "OS" : "VENDA",
          id: Number(linha.documento_id),
          valor: Number(linha.valor ?? 0),
          href:
            String(linha.tipo_documento) === "OS"
              ? `/print/ordemservico/${linha.documento_id}`
              : `/print/venda/${linha.documento_id}/orcamento`,
        }),
      );

      const parcelas = new Set(linhas.map((linha: any) => Number(linha.transacao_id))).size;

      pagamentoMultiplo = {
        id: grupoId,
        descricao: grupo?.descricao ?? null,
        modo: String(grupo?.modo ?? "AVISTA"),
        tipoDocumento: String(grupo?.tipo_documento ?? "OS") === "OS" ? "OS" : "VENDA",
        valorTotal: Number(grupo?.valor_total ?? 0),
        data: grupo?.data ?? null,
        parcelas,
        documentos,
        valorDesteLancamento: documentos.reduce(
          (total: number, documento: any) => total + documento.valor,
          0,
        ),
      };
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

    /* ---------- Linha da DRE ---------- */

    // Mesma resolucao de linha que o relatorio usa. Vem com o papel de cada
    // linha: DIRETO (a transacao e o fato, e o valor dela e o valor na DRE) ou
    // DOCUMENTO (ela so liquida OS/venda, e o que entra na DRE sao os
    // lancamentos do documento). Informativo — se a funcao falhar, o badge so
    // nao aparece.
    const { data: linhasDre } = await supabaseAdmin
      .rpc("dre_linha_da_transacao", { p_transacaoid: id })
      .then((resposta) => (resposta.error ? { data: null } : resposta));

    const dreLinhas = (linhasDre ?? []) as Array<Record<string, unknown>>;

    /* ---------- Historico de baixa e auditoria ---------- */

    const [{ data: baixa }, { data: ajustes }, { data: contraparte }] = await Promise.all([
      supabaseAdmin
        .from("transacao_baixa_historico")
        .select("vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, created_at")
        .eq("transacao_id", id)
        .maybeSingle(),
      supabaseAdmin
        .from("transacao_valor_historico")
        .select(
          "id, valor_anterior, valor_novo, valor_liquido_anterior, valor_liquido_novo, alterado_por, motivo, created_at",
        )
        .eq("transacao_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("transacao_contraparte_historico")
        .select(
          "id, cliente_anterior_id, cliente_novo_id, fornecedor_anterior_id, fornecedor_novo_id, nome_anterior, nome_novo, documento_anterior, documento_novo, alterado_por, created_at",
        )
        .eq("transacao_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    // `baixado_por`/`created_by` sao uuid soltos, sem FK para `usuario`.
    const autores = await carregarAutores([
      transacao.created_by,
      transacao.updated_by,
      transacao.baixado_por,
      baixa?.baixado_por,
      ...(ajustes ?? []).map((item) => item.alterado_por),
      ...(contraparte ?? []).map((item) => item.alterado_por),
      ...relacionadas.map((item) => item.baixado_por),
    ]);
    const autor = (valor: unknown) => autores.get(String(valor ?? "")) ?? null;

    /*
     * De onde esta linha veio, quando ela é o dinheiro da baixa de um título.
     *
     * Sem isto a transação de baixa chega ao dialog órfã: nenhuma aba a reconhece
     * — a de Adiantamento chega a dizer que ela "não faz parte de um
     * adiantamento" —, e a única pista de origem é a descrição, que é texto solto
     * e some se alguém a editar.
     */
    let baixaDe: {
      id: number;
      descricao: string | null;
      valor: number;
      valorLiquido: number;
      valorBaixado: number;
      pendente: boolean;
      vencimentoEm: string | null;
      antecipado: boolean;
    } | null = null;

    if (transacao.baixa_de_transacao_id != null) {
      const { data: titulo } = await supabaseAdmin
        .from("transacao")
        .select('id, descricao, valor, "valorLiquido", valor_baixado, pendente, vencimento_em, adiantamento_id')
        .eq("id", transacao.baixa_de_transacao_id)
        .maybeSingle();

      if (titulo) {
        baixaDe = {
          id: Number(titulo.id),
          descricao: titulo.descricao ?? null,
          valor: Number(titulo.valor ?? 0),
          valorLiquido: Number(titulo.valorLiquido ?? titulo.valor ?? 0),
          valorBaixado: Number(titulo.valor_baixado ?? 0),
          pendente: titulo.pendente === true,
          vencimentoEm: titulo.vencimento_em ?? null,
          antecipado: titulo.adiantamento_id != null,
        };
      }
    }

    /*
     * A transferência não cabia em `baixaDe`: ali a linha é o dinheiro de uma
     * baixa e o outro lado é um título. Aqui o outro lado é a perna gêmea, e o
     * que a tela precisa dizer é diferente — não "isto paga aquilo", e sim "isto
     * e aquilo são a mesma coisa vista de duas contas".
     */
    let transferencia: {
      id: number;
      valor: number;
      origem: string | null;
      destino: string | null;
      sentido: "SAIDA" | "ENTRADA";
      contraparteId: number | null;
    } | null = null;

    if (transacao.transferencia_id != null) {
      const [{ data: operacao }, { data: contraparte }] = await Promise.all([
        supabaseAdmin
          .from("transacao_transferencia")
          .select(
            "id, valor, " +
              "origem:bancoconta!transacao_transferencia_banco_origem_id_fkey ( titulo ), " +
              "destino:bancoconta!transacao_transferencia_banco_destino_id_fkey ( titulo )",
          )
          .eq("id", transacao.transferencia_id)
          .maybeSingle(),
        supabaseAdmin
          .from("transacao")
          .select("id")
          .eq("transferencia_id", transacao.transferencia_id)
          .neq("id", transacao.id)
          .eq("is_deleted", false)
          .maybeSingle(),
      ]);

      // O tipo gerado do Supabase ainda não conhece `transacao_transferencia`;
      // até ele ser regerado, a leitura passa por `any` como nos demais embeds.
      const op = operacao as any;
      if (op) {
        transferencia = {
          id: Number(op.id),
          valor: Number(op.valor ?? 0),
          origem: op.origem?.titulo ?? null,
          destino: op.destino?.titulo ?? null,
          sentido: tipoEhEntradaDeCaixa(transacao.tipo) ? "ENTRADA" : "SAIDA",
          contraparteId: contraparte ? Number(contraparte.id) : null,
        };
      }
    }

    return NextResponse.json({
      baixaDe,
      transferencia,
      relacionadas: {
        origem,
        itens: relacionadas.map((item) => ({
          ...item,
          contaParaTotal: contaParaTotal(item, origem),
          baixadoPor: autor(item.baixado_por),
        })),
        resumo: resumirLancamentos(relacionadas, totalDevidoCents, origem),
      },
      cliente: cliente ?? null,
      fornecedor: fornecedor ?? null,
      vinculo,
      dre: {
        // Sem `papel` misturado: uma transação ou é o fato, ou é a liquidação
        // de documento — a função já garante isso, e a tela mostra textos
        // diferentes para cada caso.
        papel: dreLinhas.length === 0 ? null : String(dreLinhas[0].papel),
        linhas: dreLinhas.map((linha) => ({
          documentoTipo: linha.documento_tipo == null ? null : String(linha.documento_tipo),
          documentoId: linha.documento_id == null ? null : Number(linha.documento_id),
          codigo: String(linha.codigo),
          nome: String(linha.nome),
          naturezaDre: linha.natureza_dre == null ? null : String(linha.natureza_dre),
          valor: Number(linha.valor ?? 0),
        })),
      },
      // Presente só no parcelamento avulso com grupo formal. Continua aqui
      // porque a aba ainda o usa para o aviso de agrupamento incerto.
      parcelamento:
        transacao.parcelamento_id != null
          ? { id: Number(transacao.parcelamento_id) }
          : null,
      /*
       * O que a aba Parcelas pode oferecer para esta linha, e com que regra de
       * total.
       *
       * Derivado das mesmas colunas que a RPC lê. A tela e o banco não podem
       * discordar sobre qual botão existe: oferecer um reparcelamento que a
       * função recusa é pior do que não oferecer nenhum.
       */
      reparcelamento: modoDeReparcelamento(transacao),
      pagamentoMultiplo,
      baixa: baixa
        ? { ...baixa, baixadoPor: autor(baixa.baixado_por) }
        : null,
      ajustes: (ajustes ?? []).map((item) => ({
        ...item,
        alteradoPor: autor(item.alterado_por),
      })),
      contraparte: (contraparte ?? []).map((item) => ({
        ...item,
        alteradoPor: autor(item.alterado_por),
      })),
      auditoria: {
        created_at: transacao.created_at ?? null,
        updated_at: transacao.updated_at ?? null,
        criadoPor: autor(transacao.created_by),
        alteradoPor: autor(transacao.updated_by),
        baixadoPor: autor(transacao.baixado_por),
      },
    });
  } catch (error: any) {
    // 401/403 precisam chegar como 401/403: um "Erro ao carregar" generico
    // esconderia que a recusa foi de permissao, e nao falha do servidor.
    const statusAutorizacao = Number(error?.statusCode);
    const status =
      statusAutorizacao === 401 || statusAutorizacao === 403 ? statusAutorizacao : 500;
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar o contexto da transação." },
      { status },
    );
  }
}
