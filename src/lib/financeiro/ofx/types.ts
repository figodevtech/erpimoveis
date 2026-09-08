/**
 * O extrato bancário como ele sai do arquivo OFX — antes de qualquer conversa
 * com o ERP. Nada aqui conhece `transacao`, banco_id ou conciliação: é só a
 * leitura fiel do que o banco escreveu.
 *
 * Dinheiro mora sempre em centavos inteiros, com sinal. Crédito é positivo,
 * débito é negativo — é a convenção do próprio OFX em `TRNAMT`, e mantê-la
 * evita um segundo campo de sentido que poderia discordar do valor.
 */

/** Identificação da conta e do período, lida do cabeçalho do extrato. */
export interface OfxCabecalho {
  /** BANKID — código do banco (compensação) na visão do arquivo. */
  bankId: string | null;
  /** BRANCHID — agência. É o que se compara com `bancoconta.agencia`. */
  branchId: string | null;
  /** ACCTID — conta. É o que se compara com `bancoconta.contanumero`. */
  acctId: string | null;
  /** ACCTTYPE — CHECKING, SAVINGS, etc. Informativo. */
  acctType: string | null;
  /** CURDEF — moeda declarada. Extrato fora de BRL é recusado na importação. */
  moeda: string | null;
  /** DTSTART, já reduzido ao dia local (yyyy-mm-dd). */
  periodoInicio: string | null;
  /** DTEND, já reduzido ao dia local (yyyy-mm-dd). */
  periodoFim: string | null;
  /** LEDGERBAL/BALAMT em centavos. Nem todo banco envia. */
  saldoFinalCentavos: number | null;
  /** DTASOF do LEDGERBAL (yyyy-mm-dd). */
  saldoFinalEm: string | null;
}

/** Uma linha do extrato. */
export interface OfxMovimento {
  /**
   * Posição no arquivo, começando em 1.
   *
   * Não é identidade — dois arquivos com períodos sobrepostos numeram a mesma
   * linha de formas diferentes. Serve para exibir na ordem em que o banco
   * mandou e para desempatar linhas idênticas no fingerprint.
   */
  sequencia: number;
  /** TRNTYPE — DEBIT, CREDIT, PIX, FEE, INT… O banco inventa valores próprios. */
  tipoOfx: string | null;
  /** DTPOSTED reduzido ao dia local (yyyy-mm-dd). É a data do movimento. */
  dataPostagem: string;
  /** DTAVAIL reduzido ao dia local, quando o banco envia. */
  dataDisponivel: string | null;
  /** TRNAMT em centavos, com sinal: positivo entra na conta, negativo sai. */
  valorCentavos: number;
  /**
   * FITID.
   *
   * NÃO é chave única: nos extratos observados o mesmo FITID aparece em
   * movimentos diferentes. Entra no fingerprint como mais um ingrediente, nunca
   * sozinho.
   */
  fitid: string | null;
  checknum: string | null;
  refnum: string | null;
  /** NAME — costuma trazer a contraparte. */
  nome: string | null;
  /** MEMO — a descrição que o banco mostra no extrato. */
  memo: string | null;
}

export interface OfxExtrato {
  cabecalho: OfxCabecalho;
  movimentos: OfxMovimento[];
}

/**
 * Recusa de leitura com mensagem pronta para a tela.
 *
 * Existe para separar "o arquivo não serve" (que é conversa com o usuário) de
 * um defeito do parser, que deve subir como erro comum e virar 500.
 */
export class ErroDeOfx extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroDeOfx";
  }
}
