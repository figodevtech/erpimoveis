// Intermediador da transação (NT 2020.006).
//
// Venda não presencial precisa dizer se passou por plataforma de terceiros:
// sem o <indIntermed> a SEFAZ devolve a rejeição 434 ("NF-e sem indicativo do
// intermediador"), e foi assim que a primeira nota de um pedido do Mercado
// Livre da BR Peças voltou (out/2026). Com indIntermed=1 a nota leva também o
// grupo <infIntermed>, com o CNPJ da plataforma e o cadastro do vendedor nela.

import { isValidCnpj, normalizeCnpj } from "@/lib/fiscal-identifiers";
import { escapeXml } from "./xmlUtils";

/** CNPJ que o próprio Mercado Livre manda informar como intermediador. */
export const CNPJ_INTERMEDIADOR_MERCADO_LIVRE = "03007331000141";

export type NFeIntermediador = {
  /** CNPJ da plataforma (marketplace, delivery, agenciador). */
  cnpj: string;
  /** Identificador do vendedor na plataforma: no Mercado Livre, o apelido da conta. */
  idCadIntTran: string;
};

/**
 * O leiaute só aceita o indicador nas operações não presenciais. Em venda
 * presencial (1 e 5) ou sem presença (0), ele não pode ir.
 */
export function exigeIndicadorIntermediador(indPres: unknown) {
  return ["2", "3", "4", "9"].includes(String(indPres ?? "").trim());
}

/**
 * Normaliza o que veio do rascunho. Vazio é "sem intermediador"; preenchido
 * pela metade é erro, porque a nota não pode declarar uma plataforma sem dizer
 * qual.
 */
export function normalizarIntermediador(value: unknown): NFeIntermediador | null {
  if (!value || typeof value !== "object") return null;
  const bruto = value as { cnpj?: unknown; idCadIntTran?: unknown };
  const cnpj = normalizeCnpj(bruto.cnpj);
  const idCadIntTran = String(bruto.idCadIntTran ?? "").replace(/\s+/g, " ").trim();
  if (!cnpj && !idCadIntTran) return null;
  return { cnpj, idCadIntTran };
}

/** Mensagem do problema, ou `null` quando o intermediador pode ir para a nota. */
export function validarIntermediador(intermediador: NFeIntermediador | null): string | null {
  if (!intermediador) return null;
  if (!isValidCnpj(intermediador.cnpj)) return "CNPJ do intermediador inválido.";
  if (intermediador.idCadIntTran.length < 2 || intermediador.idCadIntTran.length > 60) {
    return "Identificador do vendedor no intermediador deve ter de 2 a 60 caracteres.";
  }
  return null;
}

/** 0/1 para o <ide>, ou `undefined` quando a presença não admite o campo. */
export function indicadorIntermediador(indPres: unknown, intermediador: NFeIntermediador | null): 0 | 1 | undefined {
  if (!exigeIndicadorIntermediador(indPres)) return undefined;
  return intermediador ? 1 : 0;
}

/** Grupo <infIntermed>, que no schema fica entre <pag> e <infAdic>. */
export function buildInfIntermedXml(intermediador: NFeIntermediador | null): string {
  if (!intermediador) return "";
  const erro = validarIntermediador(intermediador);
  if (erro) throw new Error(`NFE_INTERMEDIADOR_INVALIDO: ${erro}`);
  return (
    "<infIntermed>" +
    `<CNPJ>${intermediador.cnpj}</CNPJ>` +
    `<idCadIntTran>${escapeXml(intermediador.idCadIntTran)}</idCadIntTran>` +
    "</infIntermed>"
  );
}
