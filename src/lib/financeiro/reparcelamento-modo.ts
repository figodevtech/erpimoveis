import { origemDaTransacao } from "./transacao";

/**
 * O que dá para fazer com esta transação na tela de reparcelamento.
 *
 * Duas perguntas diferentes moram aqui, e antes estavam coladas numa só:
 *
 *   grupo — quais linhas eu edito?   `parcelamento_id`, ou o documento inteiro.
 *   modo  — a soma pode mudar?       depende de quem é dono da divisão.
 *
 * A nota de compra prova que são eixos separados: ela tem grupo formal e total
 * travado. Enquanto as duas perguntas eram uma, o parcelamento avulso carregava
 * uma trava que não protegia nada — o grupo É o total dele — e OS e venda
 * ficavam de fora inteiras, mesmo quando o que se queria era só mudar em quantas
 * vezes, sem tocar no total.
 *
 * Esta função responde o que a TELA mostra. Quem garante é a RPC
 * `reparcelar_transacao`, que refaz a mesma cascata em SQL a partir da linha
 * gravada: um cliente adulterado não escolhe o próprio modo.
 */

export type ModoDeReparcelamento = "AVULSO" | "VINCULADO" | "BLOQUEADO";

export interface GrupoDeReparcelamento {
  tipo: "PARCELAMENTO" | "OS" | "VENDA";
  id: number;
}

export interface ClassificacaoDeReparcelamento {
  modo: ModoDeReparcelamento;
  /** Texto pronto para o usuário. Só existe quando o modo é BLOQUEADO. */
  motivo: string | null;
  /** Como achar as irmãs. Nulo quando bloqueado. */
  grupo: GrupoDeReparcelamento | null;
}

/** As colunas que dizem a que esta transação pertence. */
export interface VinculosDeReparcelamento {
  ordemservicoid?: number | string | null;
  vendaid?: number | string | null;
  entrada_id?: number | string | null;
  usoconsumo_entrada_id?: number | string | null;
  parcelamento_id?: number | string | null;
  pagamento_multiplo_id?: number | string | null;
  evento_financeiro_id?: number | string | null;
  adiantamento_id?: number | string | null;
  eh_adiantamento?: boolean | null;
  transferencia_id?: number | string | null;
}

function bloqueado(motivo: string): ClassificacaoDeReparcelamento {
  return { modo: "BLOQUEADO", motivo, grupo: null };
}

function paraId(valor: number | string | null | undefined): number {
  return Math.trunc(Number(valor));
}

/**
 * A ordem da cascata É a regra.
 *
 * Os bloqueios vêm primeiro porque uma linha pode ter dois vínculos ao mesmo
 * tempo — um pagamento múltiplo aponta para a OS e para o rateio. Perguntar
 * primeiro pela OS classificaria como reparcelável algo que só o rateio sabe
 * dividir.
 */
export function modoDeReparcelamento(
  transacao: VinculosDeReparcelamento | null | undefined,
): ClassificacaoDeReparcelamento {
  if (!transacao) {
    return bloqueado("Transação não encontrada.");
  }

  // As duas pernas de uma transferência são o mesmo dinheiro visto de duas
  // contas: mudam juntas ou não mudam. `transacao_transferencia_imutavel_trg`
  // já recusa no banco.
  if (transacao.transferencia_id != null) {
    return bloqueado(
      "Transferência entre contas não é parcelamento: as duas pernas são o mesmo dinheiro e mudam juntas.",
    );
  }

  // O valor da linha é a soma de fatias em `pagamento_multiplo_rateio`. Mexer
  // nela sem mexer nas fatias faria a conferência por documento parar de fechar.
  if (transacao.pagamento_multiplo_id != null) {
    return bloqueado(
      "Este lançamento cobre vários documentos. Quem divide o valor dele é o rateio do pagamento múltiplo.",
    );
  }

  // Índice único evento↔transação: uma parcela nova não teria evento a que
  // pertencer, e o evento não vira dois.
  if (transacao.evento_financeiro_id != null) {
    return bloqueado(
      "Lançamento de evento financeiro é um por evento e não se divide em parcelas.",
    );
  }

  // Título antecipado responde ao contrato com o banco, não ao pagador: quem
  // decide o vencimento dele é a antecipação.
  if (transacao.adiantamento_id != null || transacao.eh_adiantamento === true) {
    return bloqueado(
      "Título antecipado responde ao contrato com o banco e não pode ser reparcelado aqui.",
    );
  }

  const origem = origemDaTransacao(transacao);

  /*
   * Com documento, o grupo é o próprio documento — não `parcelamento_id`.
   *
   * É a mesma definição que `ajustar_valores_transacao` já usa ("o ajuste
   * precisa incluir os N pagamentos do documento"), e é o que torna todo
   * parcelamento antigo de OS e de venda reparcelável na hora: eles nunca
   * ganharam grupo formal, porque o cadastro só cria um para o avulso.
   */
  if (origem === "OS") {
    return {
      modo: "VINCULADO",
      motivo: null,
      grupo: { tipo: "OS", id: paraId(transacao.ordemservicoid) },
    };
  }

  if (origem === "VENDA") {
    return {
      modo: "VINCULADO",
      motivo: null,
      grupo: { tipo: "VENDA", id: paraId(transacao.vendaid) },
    };
  }

  if (transacao.parcelamento_id != null) {
    const grupo: GrupoDeReparcelamento = {
      tipo: "PARCELAMENTO",
      id: paraId(transacao.parcelamento_id),
    };

    /*
     * Nota de compra: grupo formal, total travado.
     *
     * Ela é o caso que separa os dois eixos. O total é o da nota — dado dela,
     * não escolha de quem paga —, mas a divisão em parcelas é livre, e foi por
     * isso que a entrada saiu da lista de recusados em 20260903260000.
     */
    const ehEntrada = origem === "ENTRADA" || origem === "USOCONSUMO";
    return { modo: ehEntrada ? "VINCULADO" : "AVULSO", motivo: null, grupo };
  }

  /*
   * Sem grupo formal e sem documento não há onde escrever.
   *
   * O que a aba Parcelas mostra nesse caso é uma reconstrução por descrição e
   * horário de criação; escrever em cima dela poderia reparcelar meio grupo.
   */
  return bloqueado(
    "Esta transação não faz parte de um parcelamento, ou o grupo dela é anterior ao registro de parcelamentos.",
  );
}
