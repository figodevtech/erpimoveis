import { civilDateInTimezone } from "./guards";

export interface SpedEntryCandidateInput {
  id?: number | string | null;
  fiscal?: boolean | null;
  status?: string | null;
  origem?: string | null;
  tipo?: string | null;
  notachave?: string | null;
  fiscal_dfe_documento_id?: number | string | null;
  data_emissao?: string | Date | null;
  created_at?: string | Date | null;
  data_entrada_fiscal?: string | null;
  dfe?: { data_emissao?: string | Date | null } | null;
}

/**
 * Determina se uma entrada do ERP é documental/fiscal para fins de SPED Fiscal (EFD ICMS/IPI).
 *
 * Entradas avulsas, manuais sem documento fiscal, ajustes rápidos de estoque, inventário
 * ou saldos iniciais NÃO pertencem ao SPED (não geram C100/C170 nem pendência de data).
 *
 * Exige obrigatoriamente:
 * 1. fiscal === true
 * 2. Origem documental suportada (não pode ser ajuste de estoque, inventário ou saldo inicial)
 * 3. Tipo não-ajuste (tipos de sistema como AJUSTE_RAPIDO e SALDO_INICIAL são excluídos)
 * 4. Evidência documental inequívoca:
 *    - Chave de acesso válida de 44 dígitos (NF-e/NFC-e)
 *    - e/ou vínculo com fiscal_dfe_documento (fiscal_dfe_documento_id válido)
 */
export function isSpedFiscalEntryCandidate(entry: SpedEntryCandidateInput | null | undefined): boolean {
  if (!entry || !entry.fiscal) return false;

  const origem = String(entry.origem ?? "").trim().toUpperCase();
  if (["AJUSTE_RAPIDO", "INVENTARIO", "SALDO_INICIAL", "AVULSA"].includes(origem)) {
    return false;
  }

  const tipo = String(entry.tipo ?? "").trim().toUpperCase();
  if (["AJUSTE_RAPIDO", "SALDO_INICIAL"].includes(tipo)) {
    return false;
  }

  const rawKey = String(entry.notachave ?? "").replace(/\D/g, "");
  const hasValidKey = rawKey.length === 44;
  const hasDfeLink = entry.fiscal_dfe_documento_id != null && Number(entry.fiscal_dfe_documento_id) > 0;

  return hasValidKey || hasDfeLink;
}

/**
 * Determina se uma entrada documental SEM data fiscal confirmada deve gerar
 * bloqueio (DATA_ENTRADA_FISCAL_NAO_CONFIRMADA) para a competência em validação.
 *
 * Critérios rigorosos para exigir revisão na competência [competence.start, competence.end]:
 * 1. Deve ser entrada documental válida (isSpedFiscalEntryCandidate).
 * 2. Deve estar CONFIRMADA no estoque.
 * 3. data_entrada_fiscal deve estar nula.
 * 4. O documento não pode ter emissão posterior ao fim da competência (data_emissao <= competence.end).
 * 5. O registro operacional (created_at civil no fuso do estabelecimento) deve ter
 *    sido criado dentro da competência (competence.start <= createdCivil <= competence.end).
 */
export function isPendingFiscalDateCandidateForCompetence(
  entry: SpedEntryCandidateInput | null | undefined,
  competence: { start: string; end: string },
  timeZone?: string | null,
): boolean {
  if (!entry) return false;
  if (!isSpedFiscalEntryCandidate(entry)) return false;

  const status = String(entry.status ?? "").trim().toUpperCase();
  if (status !== "CONFIRMADA") return false;

  if (entry.data_entrada_fiscal != null && String(entry.data_entrada_fiscal).trim() !== "") {
    return false;
  }

  // 1. Data civil de criação do registro de entrada no ERP no fuso do estabelecimento
  const createdRaw = entry.created_at
    ? (typeof entry.created_at === "string" ? entry.created_at : entry.created_at.toISOString())
    : null;
  const createdCivil = (timeZone ? civilDateInTimezone(createdRaw, timeZone) : null)
    ?? (createdRaw ? createdRaw.slice(0, 10) : null);
  if (!createdCivil) return false;

  // Se o registro operacional foi criado fora da competência (antes ou depois), não bloqueia esta competência
  if (createdCivil < competence.start || createdCivil > competence.end) {
    return false;
  }

  // 2. Data civil de emissão da NF-e (prioriza dfe.data_emissao, fallback entrada.data_emissao)
  const dfeEmissao = entry.dfe?.data_emissao;
  const rawEmission = dfeEmissao ?? entry.data_emissao;
  const emissionStr = rawEmission
    ? (typeof rawEmission === "string" ? rawEmission : rawEmission.toISOString())
    : null;
  const emissionCivil = emissionStr ? emissionStr.slice(0, 10) : null;

  // Documento com emissão posterior ao fim da competência nunca pode pertencer a ela
  if (emissionCivil && emissionCivil > competence.end) {
    return false;
  }

  return true;
}

/**
 * Determina se uma entrada documental com data fiscal confirmada pertence
 * à escrituração fiscal da competência especificada.
 *
 * A autoridade definitiva de inclusão no SPED é a data_entrada_fiscal confirmada.
 */
export function isConfirmedFiscalDateInCompetence(
  entry: SpedEntryCandidateInput | null | undefined,
  competence: { start: string; end: string },
): boolean {
  if (!entry) return false;
  if (!isSpedFiscalEntryCandidate(entry)) return false;

  const status = String(entry.status ?? "").trim().toUpperCase();
  if (status !== "CONFIRMADA") return false;

  const date = String(entry.data_entrada_fiscal ?? "").slice(0, 10);
  if (!date) return false;

  return date >= competence.start && date <= competence.end;
}
