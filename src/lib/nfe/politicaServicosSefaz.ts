import type { ModeloDocumentoFiscal } from "./types";

/** NT 2023.002 v1.02, cronograma p.4 e regra I01a p.10. */
const FIM_INUTILIZACAO = "2026-11-11";
const FUSO_UF: Record<string, string> = {
  AC: "America/Rio_Branco", BA: "America/Bahia", SP: "America/Sao_Paulo",
};

export function dataServicoSefaz(uf: string, instante = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_UF[uf.trim().toUpperCase()] ?? "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instante);
}

export function motivoInutilizacaoDesativada(params: {
  uf: string;
  modelo: ModeloDocumentoFiscal;
  ambiente: "PRODUCAO" | "HOMOLOGACAO";
  /** Data da solicitação no fuso da UF, não o ano da numeração inutilizada. */
  data: string;
}): string | null {
  const uf = params.uf.trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.data)) throw new Error("Data inválida para a política de serviços da SEFAZ.");
  if (![55, 65].includes(params.modelo) || !FUSO_UF[uf] || params.data < FIM_INUTILIZACAO) return null;
  // A homologação pode ser desativada antes. Só há data-limite confirmada na NT.
  return `Serviço de inutilização desativado para ${uf}, modelo ${params.modelo}, em ${params.ambiente}, ` +
    `a partir de 11/11/2026 (NT 2023.002 v1.02, I01a).`;
}
