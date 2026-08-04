/**
 * Indicador da inscrição estadual do destinatário (`indIEDest`, leiaute 4.00).
 *
 * Regra única do sistema. Antes o indicador era deduzido da existência de texto
 * em `cliente.inscricaoestadual` — uma IE cadastrada mas baixada na UF virava
 * `<indIEDest>1</indIEDest>` e a SEFAZ rejeitava com cStat 306. Situação fiscal
 * é dado de cadastro, não consequência de um campo estar preenchido.
 */

export const IND_IE_DEST_CONTRIBUINTE = 1;
export const IND_IE_DEST_ISENTO = 2;
export const IND_IE_DEST_NAO_CONTRIBUINTE = 9;

export type IndIEDest =
  | typeof IND_IE_DEST_CONTRIBUINTE
  | typeof IND_IE_DEST_ISENTO
  | typeof IND_IE_DEST_NAO_CONTRIBUINTE;

export const INDICADORES_IE_DEST: ReadonlyArray<{
  valor: IndIEDest;
  rotulo: string;
  descricao: string;
}> = [
  {
    valor: IND_IE_DEST_CONTRIBUINTE,
    rotulo: "1 - Contribuinte do ICMS",
    descricao: "Tem inscrição estadual ativa na UF. A IE vai na nota.",
  },
  {
    valor: IND_IE_DEST_ISENTO,
    rotulo: "2 - Contribuinte isento de inscrição",
    descricao: "Contribuinte dispensado de IE. A nota sai sem a tag de IE.",
  },
  {
    valor: IND_IE_DEST_NAO_CONTRIBUINTE,
    rotulo: "9 - Não contribuinte do ICMS",
    descricao: "Consumidor final, órgão público ou empresa sem IE.",
  },
];

export function isIndIEDest(valor: unknown): valor is IndIEDest {
  const numero = Number(valor);
  return (
    numero === IND_IE_DEST_CONTRIBUINTE ||
    numero === IND_IE_DEST_ISENTO ||
    numero === IND_IE_DEST_NAO_CONTRIBUINTE
  );
}

/** Converte para o indicador, ou `null` quando o valor não é 1, 2 nem 9. */
export function normalizarIndIEDest(valor: unknown): IndIEDest | null {
  if (valor == null || valor === "") return null;
  return isIndIEDest(valor) ? (Number(valor) as IndIEDest) : null;
}

/**
 * Sugestão para PREENCHER A TELA de um cliente ainda não classificado.
 *
 * Nunca use isto para montar o XML: é exatamente a dedução que causou a
 * rejeição 306. Serve só para o seletor abrir num valor plausível, que o
 * usuário confirma e aí sim vira dado de cadastro.
 */
export function sugerirIndIEDest(inscricaoEstadual?: string | null): IndIEDest {
  return String(inscricaoEstadual ?? "").trim()
    ? IND_IE_DEST_CONTRIBUINTE
    : IND_IE_DEST_NAO_CONTRIBUINTE;
}

export function precisaConfirmarIndIEDest(valor: unknown): boolean {
  return normalizarIndIEDest(valor) == null;
}

/** A IE só entra no XML quando o destinatário é contribuinte do ICMS. */
export function deveEnviarIeDoDestinatario(
  indIEDest: unknown,
  inscricaoEstadual?: string | null,
): boolean {
  return (
    normalizarIndIEDest(indIEDest) === IND_IE_DEST_CONTRIBUINTE &&
    Boolean(String(inscricaoEstadual ?? "").trim())
  );
}

export const MENSAGEM_INDICADOR_AUSENTE =
  "Selecione o indicador de inscrição estadual do destinatário.";
export const MENSAGEM_IE_OBRIGATORIA =
  "Informe a inscrição estadual do destinatário contribuinte do ICMS.";

/**
 * Barreira antes de gerar o XML. Lança quando o indicador não foi escolhido ou
 * quando o destinatário é contribuinte sem IE.
 */
export function validarInscricaoEstadualDestinatario(destinatario: {
  indIEDest?: unknown;
  inscricaoEstadual?: string | null;
}): asserts destinatario is { indIEDest: IndIEDest; inscricaoEstadual?: string | null } {
  const indicador = normalizarIndIEDest(destinatario.indIEDest);

  if (indicador == null) {
    throw new Error(MENSAGEM_INDICADOR_AUSENTE);
  }

  if (
    indicador === IND_IE_DEST_CONTRIBUINTE &&
    !String(destinatario.inscricaoEstadual ?? "").trim()
  ) {
    throw new Error(MENSAGEM_IE_OBRIGATORIA);
  }
}

/** Rejeição 306 da SEFAZ: IE do destinatário não está ativa na UF. */
export const CSTAT_IE_DESTINATARIO_INATIVA = "306";

export const MENSAGEM_REJEICAO_306 =
  "A inscrição estadual do destinatário não está ativa na UF.\n\n" +
  "Verifique se a IE foi digitada corretamente ou altere o indicador do " +
  "destinatário para “Não contribuinte do ICMS”, caso essa seja a situação " +
  "fiscal correta.";

export function ehRejeicaoIeDestinatarioInativa(
  codigo: string | number | null | undefined,
): boolean {
  return String(codigo ?? "").trim() === CSTAT_IE_DESTINATARIO_INATIVA;
}
