// Modelo do documento fiscal eletrônico.
//
// O sistema fala duas línguas para a mesma coisa: o XML e a chave de acesso
// usam o código numérico ("55", "65"), enquanto `nfe.modelo` e
// `nfe_config.modelo` usam o enum do banco ('NFE', 'NFCE'). Este módulo é o
// único lugar que conhece as duas e converte entre elas — é o que evita
// `isNfce: boolean` espalhado pelo motor.

import type { ModeloDocumentoFiscal, ModeloDocumentoFiscalDb } from "./types";

export const MODELO_NFE: ModeloDocumentoFiscal = 55;
export const MODELO_NFCE: ModeloDocumentoFiscal = 65;

/** Rótulo curto para mensagens de erro e telas. */
export function rotuloModelo(modelo: ModeloDocumentoFiscal): string {
  return modelo === MODELO_NFCE ? "NFC-e" : "NF-e";
}

/** Código de 2 dígitos usado no `<mod>` do XML e na chave de acesso. */
export function modeloParaCodigo(modelo: ModeloDocumentoFiscal): string {
  return String(modelo);
}

/** Valor gravado em `nfe.modelo` / `nfe_config.modelo`. */
export function modeloParaDb(modelo: ModeloDocumentoFiscal): ModeloDocumentoFiscalDb {
  return modelo === MODELO_NFCE ? "NFCE" : "NFE";
}

/**
 * Lê o modelo do que veio do banco, do XML ou de um parâmetro de rota.
 *
 * Aceita 'NFE'/'NFCE', 55/65 e "55"/"65" porque as três formas circulam pelo
 * sistema. Devolve `null` para qualquer outra coisa: modelo desconhecido nunca
 * pode virar 55 por omissão — emitir o modelo errado é erro fiscal.
 */
export function normalizarModelo(value: unknown): ModeloDocumentoFiscal | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "NFCE" || raw === "65") return MODELO_NFCE;
  if (raw === "NFE" || raw === "55") return MODELO_NFE;
  return null;
}

/** Mesma leitura, mas explode em vez de devolver `null`. */
export function exigirModelo(value: unknown): ModeloDocumentoFiscal {
  const modelo = normalizarModelo(value);
  if (!modelo) {
    throw new Error(`Modelo de documento fiscal inválido ou ausente: "${String(value ?? "")}".`);
  }
  return modelo;
}

export function isNfce(modelo: ModeloDocumentoFiscal): boolean {
  return modelo === MODELO_NFCE;
}
