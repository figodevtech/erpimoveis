// src/lib/pagamentos/processar-pagamento.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fecharPedidoPos } from "./pagarme-connect";

// Literal já usado nas suas rotas de transação
const TIPO_TRANSACAO_RECEITA = "RECEITA";

// Categoria fixa da transação (enum categoria_transacao no banco)
const CATEGORIA_TRANSACAO_ORDEM_SERVICO = "ORDEM DE SERVIÇO";

/**
 * Mapeia o método do pagamento (texto livre da tabela `pagamento.metodo`)
 * para um valor VÁLIDO do enum `metodo_pagamento` da tabela `transacao`.
 *
 * Enum no banco: PIX, DEBITO, CREDITO, TRANSFERENCIA, TED, DOC, BOLETO, DINHEIRO
 */
function mapearMetodoPagamentoEnum(metodoBruto: any): string | null {
  if (!metodoBruto) return null;

  const s = String(metodoBruto).toUpperCase();

  // Se já vier pronto para o enum do banco.
  if (
    s === "PIX" ||
    s === "DEBITO" ||
    s === "CREDITO" ||
    s === "TRANSFERENCIA" ||
    s === "TED" ||
    s === "DOC" ||
    s === "BOLETO" ||
    s === "DINHEIRO"
  ) {
    return s;
  }

  // Casos derivados / com sufixo da Stone (CARTAO_CREDITO_STONE, etc.)
  if (s.includes("PIX")) return "PIX";
  if (s.includes("DEBITO")) return "DEBITO";
  if (s.includes("CREDITO")) return "CREDITO";
  if (s.includes("BOLETO")) return "BOLETO";
  if (s.includes("TRANSF")) return "TRANSFERENCIA";
  if (s.includes("DINHEIRO") || s.includes("CASH")) return "DINHEIRO";

  // Se não conseguir mapear, evita quebrar o insert
  console.warn(
    "[mapearMetodoPagamentoEnum] Não foi possível mapear metodo:",
    metodoBruto
  );
  return null;
}

/**
 * Processa a conclusão de um pagamento:
 * - Atualiza status do pagamento (PAGO/ESTORNADO/RECUSADO)
 * - Cria log em pagamento_evento
 * - Se PAGO:
 *   - Marca OS como CONCLUIDO
 *   - Se tiver flag EMITIR_NFE_PRODUTOS_QUANDO_PAGO → cria stub de NFE/NFSE
 *   - Cria transação de RECEITA na tabela transacao (categoria ORDEM_SERVICO)
 * - Fecha pedido no Pagar.me (provider_tx_id)
 */
export async function processarPagamentoConcluido(opts: {
  pagamentoId: number;
  novoStatus: "PAGO" | "ESTORNADO" | "RECUSADO";
  origem: "WEBHOOK" | "SIMULACAO";
  dadosWebhook?: any; // opcional
}) {
  const { pagamentoId, novoStatus, origem, dadosWebhook } = opts;

  // 1) Carrega pagamento
  const { data: pagamento, error: errPag } = await supabaseAdmin
    .from("pagamento")
    .select("*")
    .eq("id", pagamentoId)
    .maybeSingle();

  if (errPag || !pagamento) {
    console.error("Pagamento não encontrado em processarPagamentoConcluido:", {
      pagamentoId,
      errPag,
    });
    return;
  }

  // 2) Atualiza status do pagamento (PAGO/ESTORNADO/RECUSADO)
  const { error: errUpdatePag } = await supabaseAdmin
    .from("pagamento")
    .update({
      status: novoStatus,
      atualizado_em: new Date().toISOString(),
      nsu:
        dadosWebhook?.data?.transaction_id ??
        dadosWebhook?.data?.id ??
        pagamento.nsu,
      autorizacao:
        dadosWebhook?.data?.authorization_code ?? pagamento.autorizacao,
      bandeira: dadosWebhook?.data?.card?.brand ?? pagamento.bandeira,
    })
    .eq("id", pagamento.id);

  if (errUpdatePag) {
    console.error("Erro ao atualizar status do pagamento:", errUpdatePag);
  }

  // 3) Log no pagamento_evento
  await supabaseAdmin.from("pagamento_evento").insert({
    pagamentoid: pagamento.id,
    tipo: `PAGAMENTO_${novoStatus}_${origem}`,
    payload: dadosWebhook ?? {},
  });

  // 4) Se pagamento aprovado, marca OS como CONCLUIDO
  if (novoStatus === "PAGO" && pagamento.ordemservicoid) {
    const { error: errOs } = await supabaseAdmin
      .from("ordemservico")
      .update({ status: "CONCLUIDO" })
      .eq("id", pagamento.ordemservicoid);

    if (errOs) {
      console.error("Erro ao atualizar status da OS para CONCLUIDO:", errOs);
    }
  }

  // 5) Se tiver evento EMITIR_NFE_PRODUTOS_QUANDO_PAGO → cria stub de notas
  if (novoStatus === "PAGO") {
    const { data: eventosNfe } = await supabaseAdmin
      .from("pagamento_evento")
      .select("*")
      .eq("pagamentoid", pagamento.id)
      .eq("tipo", "EMITIR_NFE_PRODUTOS_QUANDO_PAGO");

    if (eventosNfe && eventosNfe.length && pagamento.ordemservicoid) {
      await criarNotaFiscalStubParaOs(pagamento.ordemservicoid, pagamento.id);
    }

    // 6) Lança transação de RECEITA na tabela transacao
    await criarTransacaoReceitaParaPagamento(pagamento);
  }

  // 7) Fecha pedido no Pagar.me para remover da fila da maquineta
  if (pagamento.provider_tx_id) {
    await fecharPedidoPos(pagamento.provider_tx_id);
  }
}

/**
 * Stub de emissão de Nota Fiscal baseada nos itens da OS:
 * - se só tiver serviços -> cria apenas NFSE
 * - se só tiver produtos -> cria apenas NFE
 * - se tiver produtos E serviços -> cria UMA NFE (produtos) e UMA NFSE (serviços)
 *
 * Cada registro vai para a tabela notafiscal, com:
 *  - tipo: "NFE" ou "NFSE"
 *  - xml: JSON com os itens usados na nota (apenas pra debug/simulação)
 */
async function criarNotaFiscalStubParaOs(
  ordemServicoId: number,
  pagamentoId: number
) {
  try {
    // Busca itens de produtos e serviços da OS
    const { data: itensProduto, error: errProd } = await supabaseAdmin
      .from("osproduto")
      .select("produtoid, quantidade, precounitario, subtotal")
      .eq("ordemservicoid", ordemServicoId);

    const { data: itensServico, error: errServ } = await supabaseAdmin
      .from("osservico")
      .select("servicoid, quantidade, precounitario, subtotal")
      .eq("ordemservicoid", ordemServicoId);

    if (errProd) {
      console.error("Erro ao buscar itens de produto da OS:", errProd);
    }
    if (errServ) {
      console.error("Erro ao buscar itens de serviço da OS:", errServ);
    }

    const temProdutos = (itensProduto?.length ?? 0) > 0;
    const temServicos = (itensServico?.length ?? 0) > 0;

    if (!temProdutos && !temServicos) {
      console.log(
        "OS não possui produtos nem serviços para emissão de nota (stub)."
      );
      return;
    }

    // Verifica se já existem notas dessa OS por tipo,
    // para não criar NFE/NFSE duplicadas.
    const { data: notasExistentes, error: errNotas } = await supabaseAdmin
      .from("notafiscal")
      .select("id, tipo")
      .eq("ordemservicoid", ordemServicoId);

    if (errNotas) {
      console.error("Erro ao buscar notas fiscais existentes da OS:", errNotas);
    }

    const jaTemNfe =
      notasExistentes?.some(
        (n) => String(n.tipo).toUpperCase() === "NFE"
      ) ?? false;
    const jaTemNfse =
      notasExistentes?.some(
        (n) => String(n.tipo).toUpperCase() === "NFSE"
      ) ?? false;

    // Helper para inserir uma nota
    async function inserirNota(tipo: "NFE" | "NFSE", payloadItens: any) {
      const { data: nota, error: errNota } = await supabaseAdmin
        .from("notafiscal")
        .insert({
          ordemservicoid: ordemServicoId,
          tipo, // "NFE" ou "NFSE"
          numero: "SIMULACAO",
          serie: "1",
          status: "PENDENTE_EMISSAO",
          xml: JSON.stringify(payloadItens), // só pra simulação
          protocolo: null,
        })
        .select()
        .single();

      if (errNota) {
        console.error(
          `Erro ao criar stub de nota fiscal (${tipo}):`,
          errNota
        );
        return;
      }

      await supabaseAdmin.from("pagamento_evento").insert({
        pagamentoid: pagamentoId,
        tipo: "NFE_STUB_CRIADA",
        payload: { notafiscalid: nota.id, tipo },
      });

      console.log(
        `Stub de Nota Fiscal (${tipo}) criada para OS ${ordemServicoId}, nota ${nota.id}.`
      );
    }

    // 1) Nota de produtos (NFE)
    if (temProdutos && !jaTemNfe) {
      await inserirNota("NFE", {
        produtos: itensProduto ?? [],
        servicos: [],
      });
    }

    // 2) Nota de serviços (NFSE)
    if (temServicos && !jaTemNfse) {
      await inserirNota("NFSE", {
        produtos: [],
        servicos: itensServico ?? [],
      });
    }
  } catch (erro) {
    console.error("Erro em criarNotaFiscalStubParaOs:", erro);
  }
}

/**
 * Cria uma transação de RECEITA na tabela transacao
 * quando o pagamento da OS é marcado como PAGO.
 * - Categoria FIXA: ORDEM_SERVICO (enum categoria_transacao)
 * - Usa cliente da OS como pagador
 * - Usa pagamento.metodo mapeado para o enum de metodopagamento
 */
async function criarTransacaoReceitaParaPagamento(pagamento: any) {
  try {
    if (!pagamento?.ordemservicoid) {
      // Por enquanto só tratamos RECEITA de OS aqui. Depois dá pra estender pra vendaid.
      return;
    }

    const osId = Number(pagamento.ordemservicoid);

    // 1) Busca OS para pegar cliente
    const { data: os, error: osErr } = await supabaseAdmin
      .from("ordemservico")
      .select("id, clienteid")
      .eq("id", osId)
      .maybeSingle();

    if (osErr || !os) {
      console.error("Não foi possível carregar OS para lançar transação:", {
        osId,
        osErr,
      });
      return;
    }

    // 2) Busca cliente
    const { data: cliente, error: cliErr } = await supabaseAdmin
      .from("cliente")
      .select("id, nomerazaosocial, cpfcnpj")
      .eq("id", os.clienteid)
      .maybeSingle();

    if (cliErr || !cliente) {
      console.error(
        "Não foi possível carregar cliente da OS para lançar transação:",
        {
          clienteId: os.clienteid,
          cliErr,
        }
      );
      return;
    }

    // 3) Conta bancária padrão (primeira ativa)
    const { data: conta, error: bancoErr } = await supabaseAdmin
      .from("bancoconta")
      .select("id")
      .eq("ativo", true)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (bancoErr || !conta) {
      console.error(
        "Nenhuma conta bancária ativa encontrada para lançar transação:",
        bancoErr
      );
      return;
    }

    const bancoId = conta.id;

    // 4) Categoria da transação: fixa ORDEM_SERVICO (enum categoria_transacao)
    const categoriaEnum = CATEGORIA_TRANSACAO_ORDEM_SERVICO;

    // 5) Ajusta valor: pagamento.valor está em centavos → converte para reais
    const valorEmCentavos = Number(pagamento.valor ?? 0);
    if (!Number.isFinite(valorEmCentavos) || valorEmCentavos <= 0) {
      console.error(
        "Valor inválido ao tentar lançar transação para pagamento:",
        valorEmCentavos
      );
      return;
    }

    const valor = Number((valorEmCentavos / 100).toFixed(2)); // ex.: 56400 -> 564.00

    const descricaoTransacao = `Recebimento OS #${os.id} - Maquineta Stone`;
    const agoraIso = new Date().toISOString();

    // 6) Método de pagamento → mapear para enum válido
    const metodoEnum = mapearMetodoPagamentoEnum(pagamento.metodo);
    if (!metodoEnum) {
      console.error(
        "Não foi possível mapear pagamento.metodo para enum metodopagamento:",
        pagamento.metodo
      );
      return;
    }

    const payloadTransacao = {
      descricao: descricaoTransacao,
      valor,
      valorLiquido: valor,
      data: agoraIso,
      metodopagamento: metodoEnum,
      categoria: categoriaEnum, // enum categoria_transacao = 'ORDEM_SERVICO'
      tipo: TIPO_TRANSACAO_RECEITA, // "RECEITA"
      cliente_id: cliente.id,
      banco_id: bancoId,
      nomepagador: cliente.nomerazaosocial ?? "Cliente OS",
      cpfcnpjpagador: cliente.cpfcnpj ?? "00000000000",
      ordemservicoid: os.id,
      pendente: false,
    };

    const { error: txErr } = await supabaseAdmin
      .from("transacao")
      .insert(payloadTransacao);

    if (txErr) {
      console.error(
        "Erro ao inserir transação de receita para pagamento da OS:",
        txErr,
        payloadTransacao
      );
      return;
    }

    await supabaseAdmin.from("pagamento_evento").insert({
      pagamentoid: pagamento.id,
      tipo: "TRANSACAO_RECEITA_CRIADA",
      payload: {
        ordemservicoid: os.id,
        valor,
        banco_id: bancoId,
        metodopagamento: metodoEnum,
        categoria: categoriaEnum,
      },
    });

    console.log(
      `Transação de RECEITA criada para pagamento ${pagamento.id}, OS ${os.id}.`
    );
  } catch (erro) {
    console.error("Erro em criarTransacaoReceitaParaPagamento:", erro);
  }
}
