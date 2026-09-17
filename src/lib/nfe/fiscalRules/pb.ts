import { MODELO_NFCE } from "../modeloDocumento";
import type { ContextoRegraEstadual, RegraEstadual, ViolacaoRegraEstadual } from "./types";

/**
 * Piso, em reais, a partir do qual a Paraíba exige identificação do consumidor
 * na NFC-e. Em vigor desde 04/05/2026.
 *
 * Fonte: SEFAZ-PB, comunicado 17555 — "Em vigor dia 4 de maio: nova validação de
 * emissão da NFC-e sem CPF ou CNPJ acima de R$ 500,00".
 */
export const PB_NFCE_PISO_IDENTIFICACAO = 500;

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Regras estaduais da Paraíba.
 *
 * A validação roda ANTES da transmissão: esperar a rejeição 750 da SEFAZ para
 * avisar o operador significa queimar número de nota e refazer a venda no
 * balcão com o cliente esperando.
 */
export const regraPB: RegraEstadual = {
  uf: "PB",
  validar(contexto: ContextoRegraEstadual): ViolacaoRegraEstadual[] {
    const violacoes: ViolacaoRegraEstadual[] = [];

    if (contexto.modelo !== MODELO_NFCE) return violacoes;

    const identificado =
      onlyDigits(contexto.destinatario?.cpf).length === 11 ||
      normalizeCnpj(contexto.destinatario?.cnpj).length === 14;

    if (contexto.totalDocumento >= PB_NFCE_PISO_IDENTIFICACAO && !identificado) {
      violacoes.push({
        code: "NFCE_PB_CPF_OBRIGATORIO",
        field: "destinatario.cpfCnpj",
        rejeicaoEsperada: "750",
        message:
          `NFC-e de R$ ${contexto.totalDocumento.toFixed(2)} na Paraíba exige CPF ou CNPJ do ` +
          `consumidor. A partir de R$ ${PB_NFCE_PISO_IDENTIFICACAO.toFixed(2)} a identificação é obrigatória.`,
      });
    }

    return violacoes;
  },
};
import { normalizeCnpj } from "@/lib/fiscal-identifiers";
