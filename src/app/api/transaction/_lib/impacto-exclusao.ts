import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { valorDeFace } from "@/lib/financeiro/transacao";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * O que acontece se estas transações forem excluídas.
 *
 * Nasce PLURAL de propósito. A versão individual fazia até treze consultas por
 * transação; repetida cem vezes viraria mais de mil idas ao banco, e a prévia da
 * exclusão em massa é justamente uma tela que abre com cem itens. Aqui o número
 * de consultas é fixo — cada uma pergunta pelo conjunto inteiro com `in(...)` e
 * o agrupamento acontece em memória.
 *
 * A rota individual passou a chamar `analisarImpacto([id])`. É o que garante que
 * as duas telas nunca discordem sobre o mesmo título: era o começo de duas
 * verdades sobre o que é excluir uma transação, e já havia frase divergindo.
 */

export interface AlvoDeDocumento {
  tipo: "OS" | "VENDA";
  id: number;
}

export interface ImpactoTransacao {
  reabriraPagamento: boolean;
  targets: AlvoDeDocumento[];
  adiantamento: null | {
    bloqueado: boolean;
    motivo: string;
    quantidade?: number;
    /** Verdadeiro no lançamento da antecipação: excluir reabre os títulos. */
    desfaz?: boolean;
    sentido?: "RECEBER" | "PAGAR";
    titulos?: Array<{ id: number; descricao: string | null; valor: number }>;
  };
  pagamentoMultiplo: null | {
    id: number;
    valorTotal: number;
    modo: string;
    documentos: AlvoDeDocumento[];
    quantidadeBaixada: number;
    bloqueado: boolean;
    motivo?: string;
  };
  transferencia: null | {
    id: number;
    valor: number;
    origem: string | null;
    destino: string | null;
    motivo: string;
  };
  lancamentoDeEventos: null | {
    id: number;
    parcelas: number;
    parcelasBaixadas: number;
    despesas: number;
    motivo: string;
  };
  liquidado: null | {
    bloqueado: true;
    estornavel: true;
    motivo: string;
    sentido: "RECEBER" | "PAGAR";
    valorReaberto: number;
    acrescimos: number;
    abonado: boolean;
    creditoCliente: boolean;
  };
  /**
   * Movimentos do extrato conciliados com o que esta exclusão apaga: a própria
   * linha e as que saem junto com ela (`irmasDoGrupo`).
   *
   * Não impede nada. O gatilho `trg_desconciliar_transacao_excluida` devolve
   * esses movimentos para pendente no mesmo comando da exclusão; o campo existe
   * para as duas telas avisarem antes. `movimentoIds` deixa o lote contar sem
   * repetir o movimento de duas linhas do mesmo grupo.
   */
  conciliadoNoExtrato: null | { movimentos: number; movimentoIds: number[]; motivo: string };
  /** Lançamento de estorno apontando para esta. Mesma razão: evita o 23503. */
  estornoApontando: null | { id: number; motivo: string };
  /** Filhas de baixa parcial. A classificação precisa saber quem o CASCADE leva. */
  filhasDeBaixaParcial: number[];
  /**
   * As outras linhas que somem junto com esta, por serem do mesmo grupo.
   *
   * Inclui a própria. É o que permite dizer com verdade "você marcou 3, saem 5":
   * sem a lista, o número de arrastados seria chute.
   */
  irmasDoGrupo: number[];
  /** Colunas que a classificação lê para decidir a ordem e o grupo. */
  vinculos: {
    pendente: boolean;
    ehAdiantamento: boolean;
    adiantamentoId: number | null;
    pagamentoMultiploId: number | null;
    transferenciaId: number | null;
    lancamentoId: number | null;
    ordemservicoId: number | null;
    vendaId: number | null;
    baixaDeTransacaoId: number | null;
    competenciaEm: string | null;
    descricao: string | null;
    valor: number;
  };
}

const toCents = (value: unknown) => Math.round((Number(value) || 0) * 100);

/** O PostgREST monta `in(...)` na URL; cem por vez não a estoura. */
const TAMANHO_DO_BLOCO = 100;

async function emBlocos<T>(
  ids: number[],
  consulta: (bloco: number[]) => Promise<T[]>,
): Promise<T[]> {
  const unicos = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (unicos.length === 0) return [];

  const resultados: T[] = [];
  for (let i = 0; i < unicos.length; i += TAMANHO_DO_BLOCO) {
    resultados.push(...(await consulta(unicos.slice(i, i + TAMANHO_DO_BLOCO))));
  }
  return resultados;
}

/** Agrupa uma lista por uma chave numérica, para o lookup sair de memória. */
function agruparPor<T>(linhas: T[], chave: (linha: T) => unknown): Map<number, T[]> {
  const mapa = new Map<number, T[]>();
  for (const linha of linhas) {
    const bruto = Number(chave(linha));
    if (!Number.isFinite(bruto)) continue;
    const atual = mapa.get(bruto);
    if (atual) atual.push(linha);
    else mapa.set(bruto, [linha]);
  }
  return mapa;
}

const emReal = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function analisarImpacto(
  ids: number[],
): Promise<Map<number, ImpactoTransacao>> {
  const alvo = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0);
  const mapa = new Map<number, ImpactoTransacao>();
  if (alvo.length === 0) return mapa;

  /* ---------------- 1. as transações selecionadas ---------------- */
  const transacoes = await emBlocos(alvo, async (bloco) => {
    const { data, error } = await supabaseAdmin
      .from("transacao")
      .select(
        "id, valor, valor_base, valor_acrescimos, tipo, pendente, competencia_em, descricao, ordemservicoid, vendaid, evento_financeiro_id, lancamento_id, adiantamento_id, eh_adiantamento, pagamento_multiplo_id, transferencia_id, baixa_de_transacao_id, abonado, metodopagamento",
      )
      .in("id", bloco)
      .eq("is_deleted", false);
    if (error) throw error;
    return (data ?? []) as any[];
  });

  if (transacoes.length === 0) return mapa;

  const idsPresentes = transacoes.map((t) => Number(t.id));

  /* ---------------- 2. os conjuntos referenciados ---------------- */
  const idsAntecipacao = transacoes.filter((t) => t.eh_adiantamento === true).map((t) => Number(t.id));
  const idsAdiantamentoPai = transacoes
    .map((t) => t.adiantamento_id)
    .filter((v) => v != null)
    .map(Number);
  const idsPagamentoMultiplo = transacoes
    .map((t) => t.pagamento_multiplo_id)
    .filter((v) => v != null)
    .map(Number);
  const idsTransferencia = transacoes
    .map((t) => t.transferencia_id)
    .filter((v) => v != null)
    .map(Number);
  const idsLancamento = transacoes
    .map((t) => t.lancamento_id)
    .filter((v) => v != null)
    .map(Number);

  const ehPagamento = (t: any) =>
    String(t.tipo ?? "").toUpperCase() === "RECEITA" && t.evento_financeiro_id == null;

  const idsOs = transacoes.filter(ehPagamento).map((t) => t.ordemservicoid).filter((v) => v != null).map(Number);
  const idsVenda = transacoes.filter(ehPagamento).map((t) => t.vendaid).filter((v) => v != null).map(Number);

  /* ---------------- 3. tudo em paralelo, por conjunto ---------------- */
  const [
    titulosDeAntecipacao,
    antecipacoesPai,
    gruposMultiplos,
    irmasDeMultiplo,
    rateios,
    transferencias,
    pernasDeTransferencia,
    parcelasDeLancamento,
    despesasDeLancamento,
    ordens,
    pagamentosDeOs,
    vendas,
    pagamentosDeVenda,
    estornos,
    filhasParciais,
  ] = await Promise.all([
    emBlocos(idsAntecipacao, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, descricao, valor, adiantamento_id")
        .in("adiantamento_id", b).eq("is_deleted", false).order("id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsAdiantamentoPai, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, adiantamento_manteve_pendentes").in("id", b);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsPagamentoMultiplo, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("pagamento_multiplo").select("id, valor_total, modo, tipo_documento").in("id", b);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsPagamentoMultiplo, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, pendente, pagamento_multiplo_id")
        .in("pagamento_multiplo_id", b).eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsPagamentoMultiplo, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("pagamento_multiplo_rateio").select("tipo_documento, documento_id, pagamento_multiplo_id")
        .in("pagamento_multiplo_id", b);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsTransferencia, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao_transferencia")
        .select(
          "id, valor, " +
            "origem:bancoconta!transacao_transferencia_banco_origem_id_fkey ( titulo ), " +
            "destino:bancoconta!transacao_transferencia_banco_destino_id_fkey ( titulo )",
        )
        .in("id", b);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsTransferencia, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, transferencia_id")
        .in("transferencia_id", b).eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsLancamento, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, pendente, lancamento_id")
        .in("lancamento_id", b).eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsLancamento, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("eventos_financeiros").select("id, lancamento_id").in("lancamento_id", b);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    Promise.resolve([] as any[]),
    emBlocos(idsOs, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, valor, valor_acrescimos, ordemservicoid")
        .in("ordemservicoid", b).eq("tipo", "RECEITA").is("evento_financeiro_id", null).eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsVenda, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("venda")
        .select("id, valortotal, status, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
        .in("id", b);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsVenda, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, valor, valor_acrescimos, vendaid")
        .in("vendaid", b).eq("tipo", "RECEITA").eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsPresentes, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, estorno_transacao_id").in("estorno_transacao_id", b).eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    emBlocos(idsPresentes, async (b) => {
      const { data, error } = await supabaseAdmin
        .from("transacao").select("id, baixa_de_transacao_id").in("baixa_de_transacao_id", b).eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
  ]);

  /* ---------------- 4. índices em memória ---------------- */
  const porAntecipacao = agruparPor(titulosDeAntecipacao, (t: any) => t.adiantamento_id);
  const paiPorId = new Map(antecipacoesPai.map((t: any) => [Number(t.id), t]));
  const grupoPorId = new Map(gruposMultiplos.map((g: any) => [Number(g.id), g]));
  const irmasPorGrupo = agruparPor(irmasDeMultiplo, (t: any) => t.pagamento_multiplo_id);
  const rateioPorGrupo = agruparPor(rateios, (r: any) => r.pagamento_multiplo_id);
  const transferenciaPorId = new Map(transferencias.map((t: any) => [Number(t.id), t]));
  const pernasPorTransferencia = agruparPor(pernasDeTransferencia, (t: any) => t.transferencia_id);
  const parcelasPorLancamento = agruparPor(parcelasDeLancamento, (t: any) => t.lancamento_id);
  const despesasPorLancamento = agruparPor(despesasDeLancamento, (e: any) => e.lancamento_id);
  const ordemPorId = new Map(ordens.map((o: any) => [Number(o.id), o]));
  const pagamentosPorOs = agruparPor(pagamentosDeOs, (t: any) => t.ordemservicoid);
  const vendaPorId = new Map(vendas.map((v: any) => [Number(v.id), v]));
  const pagamentosPorVenda = agruparPor(pagamentosDeVenda, (t: any) => t.vendaid);
  const estornoPorTransacao = new Map(
    estornos.map((e: any) => [Number(e.estorno_transacao_id), Number(e.id)]),
  );
  const filhasPorPai = agruparPor(filhasParciais, (t: any) => t.baixa_de_transacao_id);

  /*
   * Quem some junto com cada linha, por pertencer ao mesmo grupo. Inclui a
   * própria.
   *
   * A antecipação fica de fora de propósito: excluí-la não apaga os títulos,
   * devolve-os para em aberto. Eles só somem se estiverem marcados, e aí
   * contam como selecionados, não como arrastados.
   */
  const linhasQueSaem = (t: any): number[] => {
    const id = Number(t.id);
    const doGrupo = (lista: any[] | undefined) => {
      const ids = (lista ?? []).map((linha: any) => Number(linha.id));
      return ids.length > 0 ? ids : [id];
    };
    if (t.transferencia_id != null) return doGrupo(pernasPorTransferencia.get(Number(t.transferencia_id)));
    if (t.lancamento_id != null) return doGrupo(parcelasPorLancamento.get(Number(t.lancamento_id)));
    if (t.pagamento_multiplo_id != null) return doGrupo(irmasPorGrupo.get(Number(t.pagamento_multiplo_id)));
    return [id, ...(filhasPorPai.get(id) ?? []).map((f: any) => Number(f.id))];
  };

  /*
   * A consulta ao extrato vem depois das outras porque precisa dos grupos.
   * Conferir só a linha clicada deixaria passar a baixa parcial — que é
   * justamente o dinheiro que passou pelo banco.
   */
  const conciliados = await emBlocos(transacoes.flatMap(linhasQueSaem), async (b) => {
    const { data, error } = await supabaseAdmin
      .from("ofx_movimento").select("id, transacao_id").in("transacao_id", b).eq("status", "CONCILIADO");
    if (error) throw error;
    return (data ?? []) as any[];
  });
  const conciliadosPorTransacao = agruparPor(conciliados, (m: any) => m.transacao_id);

  /*
   * Quem mais do conjunto pertence a cada documento.
   *
   * É a correção que a análise plural traz de graça: a versão individual
   * subtraía só o id corrente ao somar o restante pago, então três pagamentos da
   * mesma OS selecionados juntos respondiam "não reabre" três vezes — e a
   * execução reabria. Com um id só na entrada o resultado é idêntico ao de
   * antes.
   */
  const selecionadosPorOs = agruparPor(
    transacoes.filter((t) => ehPagamento(t) && t.ordemservicoid != null),
    (t: any) => t.ordemservicoid,
  );
  const selecionadosPorVenda = agruparPor(
    transacoes.filter((t) => ehPagamento(t) && t.vendaid != null),
    (t: any) => t.vendaid,
  );

  /* ---------------- 5. um impacto por transação ---------------- */
  for (const transaction of transacoes) {
    const id = Number(transaction.id);

    /* --- antecipação, nas duas pontas --- */
    let adiantamento: ImpactoTransacao["adiantamento"] = null;

    if (transaction.eh_adiantamento) {
      const lista = porAntecipacao.get(id) ?? [];
      if (lista.length > 0) {
        const recebe = String(transaction.tipo ?? "").toUpperCase() === "RECEITA";
        adiantamento = {
          bloqueado: false,
          desfaz: true,
          sentido: recebe ? "RECEBER" : "PAGAR",
          quantidade: lista.length,
          titulos: lista.map((titulo: any) => ({
            id: Number(titulo.id),
            descricao: titulo.descricao ?? null,
            valor: Number(titulo.valor ?? 0),
          })),
          motivo: `Excluir esta antecipação devolve ${lista.length} título(s) para ${
            recebe ? "a receber" : "a pagar"
          }.`,
        };
      }
    } else if (transaction.adiantamento_id != null) {
      const antecipacao = paiPorId.get(Number(transaction.adiantamento_id));
      const baixaPropria =
        antecipacao?.adiantamento_manteve_pendentes === true && transaction.pendente === false;

      adiantamento = {
        bloqueado: true,
        motivo: baixaPropria
          ? `Este título faz parte da antecipação #${transaction.adiantamento_id} e não sai sozinho. ` +
            `Para refazer a baixa dele, use "Excluir do fluxo de caixa": isso o devolve para em aberto sem mexer na antecipação.`
          : `Este título faz parte da antecipação #${transaction.adiantamento_id} e não sai sozinho. ` +
            `Exclua a antecipação primeiro: ela devolve este título e os demais para em aberto.`,
      };
    }

    /* --- pagamento múltiplo --- */
    let pagamentoMultiplo: ImpactoTransacao["pagamentoMultiplo"] = null;

    if (transaction.pagamento_multiplo_id != null) {
      const grupoId = Number(transaction.pagamento_multiplo_id);
      const grupo = grupoPorId.get(grupoId);

      if (grupo) {
        const tipoDoGrupo = String(grupo.tipo_documento).toUpperCase() === "OS" ? "OS" : "VENDA";
        const documentos = [
          ...new Set((rateioPorGrupo.get(grupoId) ?? []).map((linha: any) => Number(linha.documento_id))),
        ].map((documentoId) => ({ tipo: tipoDoGrupo as "OS" | "VENDA", id: documentoId }));

        const quantidadeBaixada =
          String(grupo.modo).toUpperCase() === "PARCELADO"
            ? (irmasPorGrupo.get(grupoId) ?? []).filter((linha: any) => linha.pendente === false).length
            : 0;

        pagamentoMultiplo = {
          id: grupoId,
          valorTotal: Number(grupo.valor_total ?? 0),
          modo: String(grupo.modo),
          documentos,
          quantidadeBaixada,
          bloqueado: quantidadeBaixada > 0,
          motivo:
            quantidadeBaixada > 0
              ? `Este pagamento tem ${quantidadeBaixada} parcela(s) já baixada(s). Estorne essas baixas antes de excluir o pagamento.`
              : undefined,
        };
      }
    }

    /* --- transferência --- */
    let transferencia: ImpactoTransacao["transferencia"] = null;

    if (transaction.transferencia_id != null) {
      const op = transferenciaPorId.get(Number(transaction.transferencia_id)) as any;
      if (op) {
        const origem = op.origem?.titulo ?? null;
        const destino = op.destino?.titulo ?? null;
        const valor = Number(op.valor ?? 0);
        transferencia = {
          id: Number(op.id),
          valor,
          origem,
          destino,
          motivo:
            `Esta transação é uma das pernas da transferência de ${emReal(valor)}` +
            (origem && destino ? ` de ${origem} para ${destino}` : "") +
            `. Excluir apaga as duas: o dinheiro volta a estar onde estava antes.`,
        };
      }
    }

    /* --- boleto de despesas da OS --- */
    let lancamentoDeEventos: ImpactoTransacao["lancamentoDeEventos"] = null;

    if (transaction.lancamento_id != null) {
      const lancamentoId = Number(transaction.lancamento_id);
      const parcelas = parcelasPorLancamento.get(lancamentoId) ?? [];
      const total = parcelas.length;
      const baixadas = parcelas.filter((p: any) => p.pendente === false).length;
      const quantasDespesas = (despesasPorLancamento.get(lancamentoId) ?? []).length;

      lancamentoDeEventos = {
        id: lancamentoId,
        parcelas: total,
        parcelasBaixadas: baixadas,
        despesas: quantasDespesas,
        motivo:
          baixadas > 0
            ? `Este lançamento tem ${baixadas} de ${total} parcela(s) já paga(s). Enquanto houver parcela paga, nem as pendentes podem ser excluídas: tire a baixa do fluxo de caixa primeiro.`
            : `Esta é uma das ${total} parcela(s) de um lançamento de ${quantasDespesas} despesa(s) da OS. Excluir desfaz o lançamento inteiro: as ${total} parcela(s) somem e as despesas voltam a previstas.`,
      };
    }

    /* --- o documento reabre? --- */
    const targets: AlvoDeDocumento[] = [];
    const isPagamento = ehPagamento(transaction);

    if (isPagamento && transaction.ordemservicoid != null) {
      const osId = Number(transaction.ordemservicoid);
      const ordem = ordemPorId.get(osId);
      const saindo = new Set(
        (selecionadosPorOs.get(osId) ?? []).map((t: any) => Number(t.id)),
      );
      const totalDevido = toCents(
        calculateFinancialTotal(
          ordem?.orcamentototal,
          ordem?.acrescimo_financeiro_tipo,
          ordem?.acrescimo_financeiro_valor,
        ),
      );
      const restante = (pagamentosPorOs.get(osId) ?? [])
        .filter((item: any) => !saindo.has(Number(item.id)))
        .reduce((sum: number, item: any) => sum + toCents(valorDeFace(item)), 0);

      if (["CONCLUIDO", "FINALIZADA"].includes(String(ordem?.status ?? "").toUpperCase()) && restante < totalDevido) {
        targets.push({ tipo: "OS", id: osId });
      }
    }

    if (isPagamento && transaction.vendaid != null) {
      const vendaId = Number(transaction.vendaid);
      const venda = vendaPorId.get(vendaId);
      const saindo = new Set(
        (selecionadosPorVenda.get(vendaId) ?? []).map((t: any) => Number(t.id)),
      );
      const totalDevido = toCents(
        calculateFinancialTotal(
          venda?.valortotal,
          venda?.acrescimo_financeiro_tipo,
          venda?.acrescimo_financeiro_valor,
        ),
      );
      const restante = (pagamentosPorVenda.get(vendaId) ?? [])
        .filter((item: any) => !saindo.has(Number(item.id)))
        .reduce((sum: number, item: any) => sum + toCents(valorDeFace(item)), 0);

      if (["CONCLUIDO", "FINALIZADA"].includes(String(venda?.status ?? "").toUpperCase()) && restante < totalDevido) {
        targets.push({ tipo: "VENDA", id: vendaId });
      }
    }

    /*
     * Título liquidado não sai: excluí-lo apagaria a dívida junto com o
     * pagamento. Vem por último de propósito — antecipação, pagamento múltiplo e
     * boleto de despesas da OS também são liquidados, e a recusa deles é mais
     * específica, dizendo qual operação desfaz aquele conjunto.
     */
    const liquidado: ImpactoTransacao["liquidado"] =
      transaction.pendente === false &&
      !transaction.eh_adiantamento &&
      transaction.adiantamento_id == null &&
      transaction.pagamento_multiplo_id == null &&
      transaction.transferencia_id == null &&
      transaction.lancamento_id == null
        ? {
            bloqueado: true,
            estornavel: true,
            motivo:
              "Esta transação está liquidada e aparece no fluxo de caixa. Tire-a do fluxo primeiro: o título volta a ficar em aberto, e aí pode ser excluído.",
            sentido:
              String(transaction.tipo ?? "").toUpperCase() === "RECEITA" ? "RECEBER" : "PAGAR",
            valorReaberto: Number(transaction.valor_base ?? transaction.valor ?? 0),
            acrescimos: Number(transaction.valor_acrescimos ?? 0),
            abonado: transaction.abonado === true,
            creditoCliente:
              String(transaction.metodopagamento ?? "").toUpperCase() === "CREDITO CLIENTE",
          }
        : null;

    /* --- conciliação que sai junto, e a recusa que o banco faz --- */
    const movimentoIds = linhasQueSaem(transaction).flatMap((linha) =>
      (conciliadosPorTransacao.get(linha) ?? []).map((m: any) => Number(m.id)),
    );
    const conciliadoNoExtrato = movimentoIds.length > 0
      ? {
          movimentos: movimentoIds.length,
          movimentoIds,
          motivo:
            movimentoIds.length === 1
              ? "Está conciliada com um movimento do extrato bancário: a conciliação é desfeita e o movimento volta para pendente."
              : `Está conciliada com ${movimentoIds.length} movimentos do extrato bancário: a conciliação é desfeita e eles voltam para pendente.`,
        }
      : null;

    const idDoEstorno = estornoPorTransacao.get(id);
    const estornoApontando = idDoEstorno != null
      ? {
          id: idDoEstorno,
          motivo: `Esta transação já foi estornada pelo lançamento #${idDoEstorno}. Exclua o estorno primeiro.`,
        }
      : null;

    mapa.set(id, {
      reabriraPagamento: targets.length > 0,
      targets,
      adiantamento,
      pagamentoMultiplo,
      transferencia,
      lancamentoDeEventos,
      liquidado,
      conciliadoNoExtrato,
      estornoApontando,
      filhasDeBaixaParcial: (filhasPorPai.get(id) ?? []).map((t: any) => Number(t.id)),
      irmasDoGrupo: linhasQueSaem(transaction),
      vinculos: {
        pendente: transaction.pendente === true,
        ehAdiantamento: transaction.eh_adiantamento === true,
        adiantamentoId: transaction.adiantamento_id == null ? null : Number(transaction.adiantamento_id),
        pagamentoMultiploId:
          transaction.pagamento_multiplo_id == null ? null : Number(transaction.pagamento_multiplo_id),
        transferenciaId: transaction.transferencia_id == null ? null : Number(transaction.transferencia_id),
        lancamentoId: transaction.lancamento_id == null ? null : Number(transaction.lancamento_id),
        ordemservicoId: transaction.ordemservicoid == null ? null : Number(transaction.ordemservicoid),
        vendaId: transaction.vendaid == null ? null : Number(transaction.vendaid),
        baixaDeTransacaoId:
          transaction.baixa_de_transacao_id == null ? null : Number(transaction.baixa_de_transacao_id),
        competenciaEm: transaction.competencia_em ?? null,
        descricao: transaction.descricao ?? null,
        valor: Number(transaction.valor ?? 0),
      },
    });
  }

  return mapa;
}
