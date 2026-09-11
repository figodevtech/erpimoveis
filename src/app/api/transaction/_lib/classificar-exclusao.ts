import type { AlvoDeDocumento, ImpactoTransacao } from "./impacto-exclusao";

/**
 * Decide o que fazer com cada linha marcada, e em que ordem.
 *
 * A regra que organiza tudo: **a classificação é função da SELEÇÃO INTEIRA, não
 * de cada linha.** A mesma transação muda de classe conforme quem mais está
 * marcado, e ignorar isso dá a resposta errada nos casos mais comuns:
 *
 *   - as duas pernas de uma transferência são UMA operação, não duas: a segunda
 *     chamada devolveria 404 porque o CASCADE já a levou;
 *   - um título de antecipação sozinho é bloqueado, mas sai numa boa se a
 *     antecipação estiver marcada junto — ela é excluída primeiro e o reabre;
 *   - a filha de uma baixa parcial é absorvida pelo CASCADE do pai.
 *
 * Função pura, sem I/O: entra o mapa de impacto, sai a prévia e o plano. É onde
 * moram as regras que mais erram, e é por isso que ela é testável sem banco.
 */

export type Classificacao =
  | "EXCLUI"
  | "EXCLUI_EM_GRUPO"
  | "ESTORNA_E_EXCLUI"
  | "BLOQUEADO";

export type TipoGrupo =
  | "TRANSFERENCIA"
  | "LANCAMENTO"
  | "ANTECIPACAO"
  | "PAGAMENTO_MULTIPLO"
  | "BAIXA_PARCIAL";

export type AcaoDoPasso =
  | "EXCLUIR_TRANSACAO"
  | "EXCLUIR_ANTECIPACAO"
  | "EXCLUIR_TRANSFERENCIA"
  | "EXCLUIR_LANCAMENTO"
  | "EXCLUIR_PAGAMENTO_MULTIPLO"
  | "ESTORNAR_E_EXCLUIR";

export interface GrupoDoItem {
  tipo: TipoGrupo;
  /** O documento/grupo. Numa transferência é o id da operação, não o da perna. */
  id: number;
  /** A linha que recebe a operação. */
  lider: number;
  resumo: string;
}

export interface ItemClassificado {
  id: number;
  classificacao: Classificacao;
  motivo: string;
  descricao: string | null;
  valor: number;
  grupo?: GrupoDoItem;
  /** Documentos que voltam a ficar em aberto. Aviso, não impedimento. */
  reabre: AlvoDeDocumento[];
  /** Lançamento de mês anterior: excluí-lo mexe num resultado já fechado. */
  competenciaAnterior: boolean;
}

export interface Passo {
  ordem: number;
  acao: AcaoDoPasso;
  /** Quem recebe a operação. */
  alvo: number;
  /** Todos os ids selecionados que este passo remove. */
  cobre: number[];
}

export interface ResumoDaExclusao {
  selecionados: number;
  /** Quantas linhas deixam de existir — marcadas e arrastadas. */
  saem: number;
  /** Linhas que somem sem terem sido marcadas — arrastadas por um grupo. */
  arrastados: number;
  porClasse: Record<Classificacao, number>;
  reabrem: AlvoDeDocumento[];
  competenciaAnterior: number;
}

export interface PlanoDeExclusao {
  itens: ItemClassificado[];
  plano: Passo[];
  resumo: ResumoDaExclusao;
}


/** "2026-08" a partir de um timestamp, no fuso da oficina. */
function competenciaDe(iso: string | null): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const local = new Date(data.toLocaleString("sv-SE", { timeZone: "America/Fortaleza" }));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}`;
}

function mesDe(momento: Date): string {
  const local = new Date(momento.toLocaleString("sv-SE", { timeZone: "America/Fortaleza" }));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}`;
}

/** A faixa de execução de cada ação. Menor roda antes. */
const FAIXA: Record<AcaoDoPasso, number> = {
  // Reabre títulos que podem estar na própria seleção — tem que vir antes de
  // tudo que os toca.
  EXCLUIR_ANTECIPACAO: 1,
  EXCLUIR_PAGAMENTO_MULTIPLO: 2,
  EXCLUIR_LANCAMENTO: 3,
  EXCLUIR_TRANSFERENCIA: 4,
  ESTORNAR_E_EXCLUIR: 5,
  // Pai de baixa parcial e demais avulsos. A separação entre os dois acontece
  // na ordenação, não aqui: os dois são a mesma ação.
  EXCLUIR_TRANSACAO: 6,
};

export function classificarExclusaoEmLote(
  ids: number[],
  impactos: Map<number, ImpactoTransacao>,
  { hoje = new Date() }: { hoje?: Date } = {},
): PlanoDeExclusao {
  const selecionados = [...new Set(ids)]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => a - b);

  const mesCorrente = mesDe(hoje);
  const naSelecao = new Set(selecionados);

  type Parcial = {
    item: ItemClassificado;
    acao?: AcaoDoPasso;
    /** Chave do grupo, para deduplicar quem lidera. */
    chave?: string;
    /**
     * Sai junto com outra linha, e não por chave de grupo.
     *
     * É o caso da filha de baixa parcial: quem a leva é o passo do PAI, que é um
     * passo solto, sem chave nenhuma. Procurar por chave não o acharia.
     */
    absorvidaPor?: number;
  };

  const parciais = new Map<number, Parcial>();

  /* ---------------- passo 1: o que cada linha é por si ---------------- */
  for (const id of selecionados) {
    const impacto = impactos.get(id);

    if (!impacto) {
      parciais.set(id, {
        item: {
          id,
          classificacao: "BLOQUEADO",
          motivo: "Transação não encontrada — pode já ter sido excluída.",
          descricao: null,
          valor: 0,
          reabre: [],
          competenciaAnterior: false,
        },
      });
      continue;
    }

    const { vinculos } = impacto;
    const competencia = competenciaDe(vinculos.competenciaEm);
    const base = {
      id,
      descricao: vinculos.descricao,
      valor: vinculos.valor,
      reabre: impacto.targets,
      competenciaAnterior: competencia != null && competencia < mesCorrente,
    };

    const bloquear = (motivo: string): Parcial => ({
      item: { ...base, classificacao: "BLOQUEADO", motivo },
    });

    // 1 e 2: as duas recusas que o banco faria, antecipadas para a prévia.
    if (impacto.conciliadoNoExtrato) {
      parciais.set(id, bloquear(impacto.conciliadoNoExtrato.motivo));
      continue;
    }
    if (impacto.estornoApontando) {
      parciais.set(id, bloquear(impacto.estornoApontando.motivo));
      continue;
    }

    // 3: transferência — uma operação para as duas pernas.
    if (vinculos.transferenciaId != null) {
      parciais.set(id, {
        item: {
          ...base,
          classificacao: "EXCLUI_EM_GRUPO",
          motivo: impacto.transferencia?.motivo ?? "Sai junto com a outra perna da transferência.",
          grupo: {
            tipo: "TRANSFERENCIA",
            id: vinculos.transferenciaId,
            lider: id,
            resumo: impacto.transferencia
              ? `Transferência #${impacto.transferencia.id} — saem as duas pernas.`
              : `Transferência #${vinculos.transferenciaId} — saem as duas pernas.`,
          },
        },
        acao: "EXCLUIR_TRANSFERENCIA",
        chave: `TRANSFERENCIA:${vinculos.transferenciaId}`,
      });
      continue;
    }

    // 4 e 5: boleto de despesas da OS. Com parcela paga, nem as pendentes saem.
    if (vinculos.lancamentoId != null) {
      const lancamento = impacto.lancamentoDeEventos;
      if ((lancamento?.parcelasBaixadas ?? 0) > 0) {
        parciais.set(id, bloquear(lancamento?.motivo ?? "Este lançamento tem parcela já paga."));
        continue;
      }
      parciais.set(id, {
        item: {
          ...base,
          classificacao: "EXCLUI_EM_GRUPO",
          motivo: lancamento?.motivo ?? "Sai junto com as demais parcelas do lançamento.",
          grupo: {
            tipo: "LANCAMENTO",
            id: vinculos.lancamentoId,
            lider: id,
            resumo: `Lançamento de despesas #${vinculos.lancamentoId} — saem ${
              lancamento?.parcelas ?? "as"
            } parcela(s) e ${lancamento?.despesas ?? "as"} despesa(s) voltam a previstas.`,
          },
        },
        acao: "EXCLUIR_LANCAMENTO",
        chave: `LANCAMENTO:${vinculos.lancamentoId}`,
      });
      continue;
    }

    // 6: a antecipação. Excluí-la é o que devolve os títulos.
    if (vinculos.ehAdiantamento && impacto.adiantamento?.desfaz) {
      parciais.set(id, {
        item: {
          ...base,
          classificacao: "EXCLUI_EM_GRUPO",
          motivo: impacto.adiantamento.motivo,
          grupo: {
            tipo: "ANTECIPACAO",
            id,
            lider: id,
            resumo: `Antecipação #${id} — devolve ${
              impacto.adiantamento.quantidade ?? 0
            } título(s) para em aberto.`,
          },
        },
        acao: "EXCLUIR_ANTECIPACAO",
        chave: `ANTECIPACAO:${id}`,
      });
      continue;
    }

    // 7 e 8: título de antecipação. O passo 2 decide qual dos dois.
    if (vinculos.adiantamentoId != null) {
      parciais.set(id, bloquear(impacto.adiantamento?.motivo ?? "Faz parte de uma antecipação."));
      continue;
    }

    // 9 e 10: pagamento múltiplo.
    if (vinculos.pagamentoMultiploId != null) {
      const grupo = impacto.pagamentoMultiplo;
      if (grupo?.bloqueado) {
        parciais.set(id, bloquear(grupo.motivo ?? "Este pagamento tem parcela já baixada."));
        continue;
      }
      parciais.set(id, {
        item: {
          ...base,
          classificacao: "EXCLUI_EM_GRUPO",
          motivo: `Esta linha é parte do pagamento múltiplo #${vinculos.pagamentoMultiploId}. Excluir desfaz o pagamento inteiro.`,
          grupo: {
            tipo: "PAGAMENTO_MULTIPLO",
            id: vinculos.pagamentoMultiploId,
            lider: id,
            resumo: `Pagamento múltiplo #${vinculos.pagamentoMultiploId} — sai o pagamento inteiro, em ${
              grupo?.documentos.length ?? 0
            } documento(s).`,
          },
        },
        acao: "EXCLUIR_PAGAMENTO_MULTIPLO",
        chave: `PAGAMENTO_MULTIPLO:${vinculos.pagamentoMultiploId}`,
      });
      continue;
    }

    // 12: liquidada. O estorno devolve o título e a exclusão o apaga em seguida.
    if (impacto.liquidado) {
      parciais.set(id, {
        item: {
          ...base,
          classificacao: "ESTORNA_E_EXCLUI",
          motivo:
            "Está liquidada: a baixa é desfeita e o título é apagado em seguida. A dívida deixa de existir.",
        },
        acao: "ESTORNAR_E_EXCLUIR",
      });
      continue;
    }

    if (!vinculos.pendente) {
      // Liquidada sem `liquidado` preenchido é estado que o impacto não soube
      // classificar. Recusar é mais honesto do que adivinhar.
      parciais.set(id, bloquear("Esta transação está liquidada e não pôde ser analisada."));
      continue;
    }

    // 13: pendente e sem vínculo de grupo.
    parciais.set(id, {
      item: { ...base, classificacao: "EXCLUI", motivo: "Sai sem mexer em outros documentos." },
      acao: "EXCLUIR_TRANSACAO",
    });
  }

  /* ---------------- passo 2: o que muda por causa do conjunto ---------------- */

  // 7: o título sai quando a antecipação dele também está marcada — ela é
  // excluída primeiro e o devolve para em aberto.
  for (const id of selecionados) {
    const parcial = parciais.get(id);
    const vinculos = impactos.get(id)?.vinculos;
    if (!parcial || !vinculos?.adiantamentoId) continue;
    if (parcial.item.classificacao !== "BLOQUEADO") continue;

    const antecipacao = parciais.get(vinculos.adiantamentoId);
    if (!naSelecao.has(vinculos.adiantamentoId)) continue;
    if (antecipacao?.acao !== "EXCLUIR_ANTECIPACAO") continue;

    parcial.item.classificacao = "EXCLUI";
    parcial.item.motivo = `A antecipação #${vinculos.adiantamentoId} também está marcada: ela é desfeita primeiro e devolve este título para em aberto.`;
    parcial.acao = "EXCLUIR_TRANSACAO";
  }

  // 11: a filha de uma baixa parcial é absorvida pelo CASCADE do pai.
  for (const id of selecionados) {
    const parcial = parciais.get(id);
    const vinculos = impactos.get(id)?.vinculos;
    const pai = vinculos?.baixaDeTransacaoId;
    if (!parcial || pai == null || !naSelecao.has(pai)) continue;

    const paiParcial = parciais.get(pai);
    if (!paiParcial?.acao || paiParcial.item.classificacao === "BLOQUEADO") continue;

    parcial.item.classificacao = "EXCLUI_EM_GRUPO";
    parcial.item.motivo = `Esta baixa parcial sai junto com o título #${pai}, que também está marcado.`;
    parcial.item.grupo = {
      tipo: "BAIXA_PARCIAL",
      id: pai,
      lider: pai,
      resumo: `Baixa parcial de #${pai} — a parcial sai junto com o título.`,
    };
    parcial.acao = undefined;
    parcial.chave = undefined;
    parcial.absorvidaPor = pai;
  }

  /* ---------------- passo 3: o plano ---------------- */
  const passosPorChave = new Map<string, Passo>();
  const passosSoltos: Passo[] = [];

  for (const id of selecionados) {
    const parcial = parciais.get(id);
    if (!parcial) continue;

    // Absorvida por outro passo: entra no `cobre` dele, não vira passo. A
    // ligação é feita depois, quando todos os passos já existem.
    if (!parcial.acao) continue;

    if (parcial.chave) {
      const existente = passosPorChave.get(parcial.chave);
      if (existente) {
        // Irmão da mesma operação: a segunda chamada daria 404.
        existente.cobre.push(id);
        continue;
      }
      const passo: Passo = {
        ordem: FAIXA[parcial.acao],
        acao: parcial.acao,
        alvo: parcial.acao === "EXCLUIR_PAGAMENTO_MULTIPLO" ? parcial.item.grupo!.id : id,
        cobre: [id],
      };
      passosPorChave.set(parcial.chave, passo);
      continue;
    }

    passosSoltos.push({ ordem: FAIXA[parcial.acao], acao: parcial.acao, alvo: id, cobre: [id] });
  }

  // Agora que todos os passos existem, cada absorvida encontra o seu dono.
  const todosOsPassos = [...passosPorChave.values(), ...passosSoltos];
  for (const id of selecionados) {
    const parcial = parciais.get(id);
    if (!parcial || parcial.acao) continue;

    const dono = parcial.absorvidaPor != null
      ? todosOsPassos.find(
          (p) => p.alvo === parcial.absorvidaPor || p.cobre.includes(parcial.absorvidaPor!),
        )
      : parcial.chave
        ? passosPorChave.get(parcial.chave)
        : undefined;

    if (dono && !dono.cobre.includes(id)) dono.cobre.push(id);
  }

  const plano = todosOsPassos.sort((a, b) => {
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;

    /*
     * Dentro da última faixa, as exclusões do mesmo documento ficam juntas.
     *
     * Cada uma toma `pg_advisory_xact_lock` na OS pelo gatilho de recálculo;
     * intercalar documentos diferentes faz a fila crescer sem necessidade. E o
     * desempate final é por id, para o mesmo conjunto sempre gerar o mesmo
     * plano — há teste disso.
     */
    const docA = impactos.get(a.alvo)?.vinculos;
    const docB = impactos.get(b.alvo)?.vinculos;
    const chaveA = `${docA?.ordemservicoId ?? 0}:${docA?.vendaId ?? 0}`;
    const chaveB = `${docB?.ordemservicoId ?? 0}:${docB?.vendaId ?? 0}`;
    if (chaveA !== chaveB) return chaveA < chaveB ? -1 : 1;

    return a.alvo - b.alvo;
  });

  /* ---------------- passo 4: o resumo ---------------- */
  const itens = selecionados
    .map((id) => parciais.get(id)?.item)
    .filter((item): item is ItemClassificado => item != null);

  const porClasse: Record<Classificacao, number> = {
    EXCLUI: 0,
    EXCLUI_EM_GRUPO: 0,
    ESTORNA_E_EXCLUI: 0,
    BLOQUEADO: 0,
  };
  for (const item of itens) porClasse[item.classificacao]++;

  const saem = new Set<number>();
  for (const passo of plano) for (const id of passo.cobre) saem.add(id);

  /*
   * Tudo o que deixa de existir, marcado ou não.
   *
   * A perna da transferência que ninguém clicou, as demais parcelas do
   * lançamento, as filhas de uma baixa parcial: somem por CASCADE e o usuário
   * precisa saber antes. A antecipação é a exceção — excluí-la devolve os
   * títulos para em aberto, não os apaga.
   */
  const somem = new Set<number>();
  for (const passo of plano) {
    const arrastaGrupo =
      passo.acao === "EXCLUIR_TRANSFERENCIA" ||
      passo.acao === "EXCLUIR_LANCAMENTO" ||
      passo.acao === "EXCLUIR_PAGAMENTO_MULTIPLO" ||
      passo.acao === "EXCLUIR_TRANSACAO";

    const irmas = arrastaGrupo ? (impactos.get(passo.alvo)?.irmasDoGrupo ?? []) : [];
    for (const id of irmas.length > 0 ? irmas : [passo.alvo]) somem.add(id);
    for (const id of passo.cobre) somem.add(id);
  }

  let arrastados = 0;
  for (const id of somem) if (!naSelecao.has(id)) arrastados++;

  const reabrem: AlvoDeDocumento[] = [];
  const vistos = new Set<string>();
  for (const item of itens) {
    if (!saem.has(item.id)) continue;
    for (const alvo of item.reabre) {
      const chave = `${alvo.tipo}:${alvo.id}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      reabrem.push(alvo);
    }
  }

  return {
    itens,
    plano,
    resumo: {
      selecionados: selecionados.length,
      saem: somem.size,
      arrastados,
      porClasse,
      reabrem,
      competenciaAnterior: itens.filter((i) => saem.has(i.id) && i.competenciaAnterior).length,
    },
  };
}
