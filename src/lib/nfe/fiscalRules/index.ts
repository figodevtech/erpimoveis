// Registry de regras fiscais por UF.
//
// Cada estado publica validações próprias que não estão no leiaute nacional —
// a Paraíba, por exemplo, exige CPF/CNPJ na NFC-e a partir de R$ 500. Sem um
// lugar só para isso, essas regras viram `if (uf === "PB")` espalhado por
// serviço, tela e rota, e a próxima UF vira uma caçada.
//
// Registrar uma UF nova é acrescentar um arquivo e uma linha aqui.

import { regraPB } from "./pb";
import type { ContextoRegraEstadual, RegraEstadual, ViolacaoRegraEstadual } from "./types";

export type { ContextoRegraEstadual, RegraEstadual, ViolacaoRegraEstadual } from "./types";
export { PB_NFCE_PISO_IDENTIFICACAO } from "./pb";

const REGRAS: Record<string, RegraEstadual> = {
  PB: regraPB,
};

export function getRegraEstadual(uf: string): RegraEstadual | null {
  return REGRAS[String(uf ?? "").trim().toUpperCase()] ?? null;
}

/**
 * Valida o documento contra as regras da UF do emitente.
 *
 * UF sem regras cadastradas devolve lista vazia — ausência de regra estadual
 * conhecida não impede a emissão, só não acrescenta validação.
 */
export function validarRegrasEstaduais(
  contexto: ContextoRegraEstadual,
): ViolacaoRegraEstadual[] {
  const regra = getRegraEstadual(contexto.uf);
  if (!regra) return [];
  return regra.validar({ ...contexto, uf: contexto.uf.trim().toUpperCase() });
}
