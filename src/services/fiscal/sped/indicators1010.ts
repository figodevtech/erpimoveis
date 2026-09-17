import type { SpedDiagnostic, SpedGateStatus } from "@/lib/sped/efd-icms-ipi";
import { SpedServiceError } from "./errors";

export type Sped1010IndicatorValue = "S" | "N";
export type Sped1010IndicatorOrigin =
  | "REGRA_UF"
  | "FONTES_MOVIMENTO"
  | "CONFIGURACAO"
  | "PADRAO_PROVISORIO";

export interface Sped1010IndicatorDetail {
  campo: string;
  titulo: string;
  valor: Sped1010IndicatorValue;
  status: SpedGateStatus;
  origem: Sped1010IndicatorOrigin;
  motivo: string;
}

export interface Sped1010ManualDecision {
  valor: Sped1010IndicatorValue;
  status: SpedGateStatus;
  descricao?: string;
  confirmadoEm?: string;
  confirmadoPor?: string;
}

export interface Sped1010ManualFieldDefinition {
  campo: string;
  titulo: string;
  subtitulo: string;
  registroEfd: string;
}

export const SPED_1010_MANUAL_FIELDS: readonly Sped1010ManualFieldDefinition[] = [
  {
    campo: "IND_EXP",
    titulo: "Operações de exportação",
    subtitulo: "Registro 1100 — Ocorrência de exportação direta ou indireta no período",
    registroEfd: "1100",
  },
  {
    campo: "IND_CCRF",
    titulo: "Controle de créditos fiscais de ICMS",
    subtitulo: "Registro 1200 — Controle de créditos acumulados ou saldo credor de ICMS transferido",
    registroEfd: "1200",
  },
  {
    campo: "IND_COMB",
    titulo: "Operações com combustíveis",
    subtitulo: "Registro 1300 — Comercialização, produção ou transporte de combustíveis e derivados",
    registroEfd: "1300",
  },
  {
    campo: "IND_USINA",
    titulo: "Usinas de açúcar e álcool",
    subtitulo: "Registro 1390 — Controle de produção e entrada de cana-de-açúcar em usinas",
    registroEfd: "1390",
  },
  {
    campo: "IND_EE",
    titulo: "Operações com energia elétrica",
    subtitulo: "Registro 1500 — Atividades de geração, transmissão ou distribuição de energia elétrica",
    registroEfd: "1500",
  },
  {
    campo: "IND_FORM",
    titulo: "Formulário de segurança",
    subtitulo: "Registro 1700 — Emissão de documentos fiscais em formulário de segurança (FS-DA)",
    registroEfd: "1700",
  },
  {
    campo: "IND_AER",
    titulo: "Transporte aéreo",
    subtitulo: "Registro 1800 — Prestação de serviços de transporte aéreo de passageiros ou cargas",
    registroEfd: "1800",
  },
] as const;

export interface Sped1010ContextInput {
  uf: string;
  config: Record<string, unknown> | null;
  hasExportOperations?: boolean;
  hasElectronicPayments?: boolean;
  hasC176C179Operations?: boolean;
}

export interface Sped1010Resolution {
  indicators: Record<string, Sped1010IndicatorValue>;
  details: Record<string, Sped1010IndicatorDetail>;
  diagnostics: SpedDiagnostic[];
}

const PE_ONLY_INDICATORS = new Set(["IND_GIAF1", "IND_GIAF3", "IND_GIAF4"]);

function parseManualDecision(raw: unknown): {
  isConfirmed: boolean;
  value: Sped1010IndicatorValue;
  descricao?: string;
  confirmadoEm?: string;
  confirmadoPor?: string;
} {
  if (raw == null) {
    return { isConfirmed: false, value: "N" };
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const status = String(obj.status || "").toUpperCase().trim();
    const val = String(obj.valor || "").toUpperCase().trim();
    if (status === "CONFIRMADO" && (val === "S" || val === "N")) {
      return {
        isConfirmed: true,
        value: val as Sped1010IndicatorValue,
        descricao: typeof obj.descricao === "string" ? obj.descricao.trim() : undefined,
        confirmadoEm: typeof obj.confirmadoEm === "string" ? obj.confirmadoEm : undefined,
        confirmadoPor: typeof obj.confirmadoPor === "string" ? obj.confirmadoPor : undefined,
      };
    }
    return { isConfirmed: false, value: val === "S" ? "S" : "N" };
  }
  // Compatibilidade retroativa para string direta "S" ou "N"
  const val = String(raw).toUpperCase().trim();
  if (val === "S" || val === "N") {
    return { isConfirmed: true, value: val as Sped1010IndicatorValue };
  }
  return { isConfirmed: false, value: "N" };
}

export function resolve1010Indicators(input: Sped1010ContextInput): Sped1010Resolution {
  const uf = String(input.uf || "").toUpperCase().trim();
  const config = input.config;
  const evidencias = (config?.evidencias as Record<string, unknown> | undefined) ?? {};
  const config1010 = (evidencias.indicadores_1010 as Record<string, unknown> | undefined) ?? {};

  const details: Record<string, Sped1010IndicatorDetail> = {};
  const indicators: Record<string, Sped1010IndicatorValue> = {};
  const diagnostics: SpedDiagnostic[] = [];

  function register(detail: Sped1010IndicatorDetail) {
    details[detail.campo] = detail;
    indicators[detail.campo] = detail.valor;
  }

  // 1. IND_EXP — Operações de Exportação (Bloco 1: 1100)
  const decExp = parseManualDecision(config1010.IND_EXP);
  if (input.hasExportOperations) {
    register({
      campo: "IND_EXP",
      titulo: "Operações de Exportação",
      valor: "S",
      status: "CONFIRMADO",
      origem: "FONTES_MOVIMENTO",
      motivo: "Identificadas operações de exportação (CFOP 7xxx) nas fontes fiscais do período.",
    });
  } else if (decExp.isConfirmed) {
    register({
      campo: "IND_EXP",
      titulo: "Operações de Exportação",
      valor: decExp.value,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: decExp.descricao
        ? `Decisão fiscal confirmada pelo contador: ${decExp.value} (${decExp.descricao}).`
        : `Decisão fiscal confirmada pelo contador: ${decExp.value}.`,
    });
  } else {
    register({
      campo: "IND_EXP",
      titulo: "Operações de Exportação",
      valor: "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Sem operações de exportação detectadas nas notas; requer confirmação fiscal formal.",
    });
  }

  // 2. IND_CCRF — Créditos Fiscais Acumulados de ICMS (Bloco 1: 1200)
  const decCcrf = parseManualDecision(config1010.IND_CCRF);
  if (decCcrf.isConfirmed) {
    register({
      campo: "IND_CCRF",
      titulo: "Controle de Créditos Fiscais de ICMS",
      valor: decCcrf.value,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: decCcrf.descricao
        ? `Decisão fiscal confirmada pelo contador: ${decCcrf.value} (${decCcrf.descricao}).`
        : `Decisão fiscal confirmada pelo contador: ${decCcrf.value}.`,
    });
  } else {
    register({
      campo: "IND_CCRF",
      titulo: "Controle de Créditos Fiscais de ICMS",
      valor: "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Ocorrência de créditos fiscais (registro 1200) pendente de decisão fiscal.",
    });
  }

  // 3. IND_COMB — Operações com Combustíveis (Bloco 1: 1300)
  const decComb = parseManualDecision(config1010.IND_COMB);
  if (decComb.isConfirmed) {
    register({
      campo: "IND_COMB",
      titulo: "Operações com Combustíveis",
      valor: decComb.value,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: decComb.descricao
        ? `Decisão fiscal confirmada pelo contador: ${decComb.value} (${decComb.descricao}).`
        : `Decisão fiscal confirmada pelo contador: ${decComb.value}.`,
    });
  } else {
    register({
      campo: "IND_COMB",
      titulo: "Operações com Combustíveis",
      valor: "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Comercialização de combustíveis (registro 1300) pendente de decisão fiscal.",
    });
  }

  // 4. IND_USINA — Usina de Açúcar e/ou Álcool (Bloco 1: 1390)
  const decUsina = parseManualDecision(config1010.IND_USINA);
  if (decUsina.isConfirmed) {
    register({
      campo: "IND_USINA",
      titulo: "Usinas de Açúcar e Álcool",
      valor: decUsina.value,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: decUsina.descricao
        ? `Decisão fiscal confirmada pelo contador: ${decUsina.value} (${decUsina.descricao}).`
        : `Decisão fiscal confirmada pelo contador: ${decUsina.value}.`,
    });
  } else {
    register({
      campo: "IND_USINA",
      titulo: "Usinas de Açúcar e Álcool",
      valor: "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Operações de usinas de açúcar/álcool (registro 1390) pendente de decisão fiscal.",
    });
  }

  // 5. IND_VA — Operações com Valor Adicionado (Registro 1400)
  const status1400 = config?.registro_1400_status as SpedGateStatus | undefined;
  const applicable1400 = config?.registro_1400_aplicavel === true;
  if (status1400 === "CONFIRMADO") {
    register({
      campo: "IND_VA",
      titulo: "Valor Adicionado por Município (Registro 1400)",
      valor: applicable1400 ? "S" : "N",
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Confirmado via gate Registro 1400: ${applicable1400 ? "Aplicável (S)" : "Inaplicável (N)"}.`,
    });
  } else {
    register({
      campo: "IND_VA",
      titulo: "Valor Adicionado por Município (Registro 1400)",
      valor: applicable1400 ? "S" : "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Gate do Registro 1400 ainda precisa de confirmação fiscal pelo contador.",
    });
  }

  // 6. IND_EE — Operações com Energia Elétrica (Bloco 1: 1500)
  const decEe = parseManualDecision(config1010.IND_EE);
  if (decEe.isConfirmed) {
    register({
      campo: "IND_EE",
      titulo: "Operações com Energia Elétrica",
      valor: decEe.value,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: decEe.descricao
        ? `Decisão fiscal confirmada pelo contador: ${decEe.value} (${decEe.descricao}).`
        : `Decisão fiscal confirmada pelo contador: ${decEe.value}.`,
    });
  } else {
    register({
      campo: "IND_EE",
      titulo: "Operações com Energia Elétrica",
      valor: "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Operações com energia elétrica (registro 1500) pendente de decisão fiscal.",
    });
  }

  // 7. IND_CART — Operações com Cartão / Pagamentos Eletrônicos (Registro 1601)
  const status1601 = config?.registro_1601_status as SpedGateStatus | undefined;
  const applicable1601 = config?.registro_1601_aplicavel === true;
  if (input.hasElectronicPayments) {
    register({
      campo: "IND_CART",
      titulo: "Operações com Instrumentos de Pagamento Eletrônico (Registro 1601)",
      valor: "S",
      status: "CONFIRMADO",
      origem: "FONTES_MOVIMENTO",
      motivo: "Identificadas operações com cartões/meios eletrônicos ou registros 1601 no período.",
    });
  } else if (status1601 === "CONFIRMADO") {
    register({
      campo: "IND_CART",
      titulo: "Operações com Instrumentos de Pagamento Eletrônico (Registro 1601)",
      valor: applicable1601 ? "S" : "N",
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Confirmado via gate Registro 1601: ${applicable1601 ? "Aplicável (S)" : "Inaplicável (N)"}.`,
    });
  } else {
    register({
      campo: "IND_CART",
      titulo: "Operações com Instrumentos de Pagamento Eletrônico (Registro 1601)",
      valor: "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Gate do Registro 1601 pendente de confirmação pelo contador.",
    });
  }

  // 8. IND_FORM — Emissão de Documentos em Formulário de Segurança (Bloco 1: 1700)
  const decForm = parseManualDecision(config1010.IND_FORM);
  if (decForm.isConfirmed) {
    register({
      campo: "IND_FORM",
      titulo: "Documentos em Formulário de Segurança",
      valor: decForm.value,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: decForm.descricao
        ? `Decisão fiscal confirmada pelo contador: ${decForm.value} (${decForm.descricao}).`
        : `Decisão fiscal confirmada pelo contador: ${decForm.value}.`,
    });
  } else {
    register({
      campo: "IND_FORM",
      titulo: "Documentos em Formulário de Segurança",
      valor: "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Emissão em formulário de segurança (registro 1700) pendente de decisão fiscal.",
    });
  }

  // 9. IND_AER — Transporte Aéreo (Bloco 1: 1800)
  const decAer = parseManualDecision(config1010.IND_AER);
  if (decAer.isConfirmed) {
    register({
      campo: "IND_AER",
      titulo: "Transporte Aéreo",
      valor: decAer.value,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: decAer.descricao
        ? `Decisão fiscal confirmada pelo contador: ${decAer.value} (${decAer.descricao}).`
        : `Decisão fiscal confirmada pelo contador: ${decAer.value}.`,
    });
  } else {
    register({
      campo: "IND_AER",
      titulo: "Transporte Aéreo",
      valor: "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Operações de transporte aéreo (registro 1800) pendente de decisão fiscal.",
    });
  }

  // 10, 11, 12. IND_GIAF1, IND_GIAF3, IND_GIAF4 — Guias GIAF (Exclusivas de Pernambuco)
  for (const giafField of ["IND_GIAF1", "IND_GIAF3", "IND_GIAF4"] as const) {
    const num = giafField.replace("IND_GIAF", "");
    if (uf !== "PE") {
      register({
        campo: giafField,
        titulo: `GIAF ${num} (Guia de Informações Fiscais - PE)`,
        valor: "N",
        status: "CONFIRMADO",
        origem: "REGRA_UF",
        motivo: `Dispensado: obrigação exclusiva de contribuintes estabelecidos em Pernambuco (UF da empresa: ${uf || "desconhecida"}).`,
      });
    } else {
      const decGiaf = parseManualDecision(config1010[giafField]);
      if (decGiaf.isConfirmed) {
        register({
          campo: giafField,
          titulo: `GIAF ${num} (Guia de Informações Fiscais - PE)`,
          valor: decGiaf.value,
          status: "CONFIRMADO",
          origem: "CONFIGURACAO",
          motivo: decGiaf.descricao
            ? `Decisão fiscal confirmada pelo contador: ${decGiaf.value} (${decGiaf.descricao}).`
            : `Decisão fiscal confirmada pelo contador: ${decGiaf.value}.`,
        });
      } else {
        register({
          campo: giafField,
          titulo: `GIAF ${num} (Guia de Informações Fiscais - PE)`,
          valor: "N",
          status: "PENDENTE",
          origem: "PADRAO_PROVISORIO",
          motivo: `Contribuinte em Pernambuco exige confirmação sobre obrigatoriedade da GIAF ${num}.`,
        });
      }
    }
  }

  // 13. IND_REST_RESSARC_COMPL_ICMS — Ressarcimento / Complementação de ICMS-ST (C176/C179/1250)
  const statusC176 = config?.c176_c179_status as SpedGateStatus | undefined;
  const applicableC176 = config?.c176_c179_aplicavel === true;
  if (statusC176 === "CONFIRMADO") {
    register({
      campo: "IND_REST_RESSARC_COMPL_ICMS",
      titulo: "Ressarcimento e Complementação de ICMS/ST (C176/C179)",
      valor: applicableC176 ? "S" : "N",
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Confirmado via gate C176/C179: ${applicableC176 ? "Aplicável (S)" : "Inaplicável (N)"}.`,
    });
  } else {
    register({
      campo: "IND_REST_RESSARC_COMPL_ICMS",
      titulo: "Ressarcimento e Complementação de ICMS/ST (C176/C179)",
      valor: applicableC176 ? "S" : "N",
      status: "PENDENTE",
      origem: "PADRAO_PROVISORIO",
      motivo: "Gate de Ressarcimento C176/C179 pendente de confirmação pelo contador.",
    });
  }

  // Gera diagnósticos para indicadores complementares pendentes de decisão fiscal
  const pendingSetorial = Object.values(details).filter(
    (d) =>
      d.status === "PENDENTE" &&
      !["IND_VA", "IND_CART", "IND_REST_RESSARC_COMPL_ICMS"].includes(d.campo) &&
      !PE_ONLY_INDICATORS.has(d.campo)
  );

  if (pendingSetorial.length > 0) {
    const fieldsList = pendingSetorial.map((d) => d.campo).join(", ");
    diagnostics.push({
      code: "INDICADORES_1010_PENDENTES",
      severity: "BLOQUEIO",
      message: `Os seguintes indicadores complementares do Bloco 1 (registro 1010) exigem confirmação fiscal do contador: ${fieldsList}.`,
    });
  }

  return { indicators, details, diagnostics };
}

/**
 * Valida e realiza merge profundo das decisões auditáveis do Registro 1010
 * preservando integralmente todas as outras evidências já cadastradas em fiscal_sped_config.evidencias.
 */
export function mergeSped1010Evidence(
  currentEvidencias: Record<string, unknown> | null | undefined,
  supplied1010: Record<string, unknown> | null | undefined,
  actorId: string
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(currentEvidencias ?? {}) };
  if (!supplied1010 || typeof supplied1010 !== "object") {
    return merged;
  }
  const existing1010 = (merged.indicadores_1010 && typeof merged.indicadores_1010 === "object"
    ? merged.indicadores_1010 as Record<string, unknown>
    : {});
  const next1010: Record<string, unknown> = { ...existing1010 };

  const VALID_1010_FIELDS = new Set([
    "IND_EXP", "IND_CCRF", "IND_COMB", "IND_USINA", "IND_EE", "IND_FORM", "IND_AER",
    "IND_GIAF1", "IND_GIAF3", "IND_GIAF4",
  ]);

  for (const [field, rawItem] of Object.entries(supplied1010)) {
    if (!VALID_1010_FIELDS.has(field)) continue;
    if (rawItem == null) {
      delete next1010[field];
      continue;
    }
    if (typeof rawItem === "object" && rawItem !== null) {
      const itemObj = rawItem as Record<string, unknown>;
      const rawStatus = String(itemObj.status || "PENDENTE").toUpperCase().trim();
      if (!["PENDENTE", "CONFIRMADO", "NAO_APLICAVEL"].includes(rawStatus)) {
        throw new SpedServiceError(`Status inválido para o indicador ${field}.`, 400, "INVALID_GATE_STATUS");
      }
      if (rawStatus === "CONFIRMADO") {
        const rawVal = String(itemObj.valor || "").toUpperCase().trim();
        if (rawVal !== "S" && rawVal !== "N") {
          throw new SpedServiceError(`O valor do indicador ${field} deve ser estritamente "S" ou "N".`, 400, "INVALID_INDICATOR_VALUE");
        }
        const descricao = String(itemObj.descricao || "").trim();
        if (!descricao) {
          throw new SpedServiceError(`Informe a evidência fiscal para confirmar o indicador ${field}.`, 400, "INDICATOR_EVIDENCE_REQUIRED");
        }
        next1010[field] = {
          valor: rawVal as Sped1010IndicatorValue,
          status: "CONFIRMADO",
          descricao,
          confirmadoEm: (typeof itemObj.confirmadoEm === "string" && itemObj.confirmadoEm) || new Date().toISOString(),
          confirmadoPor: (typeof itemObj.confirmadoPor === "string" && itemObj.confirmadoPor) || actorId,
        };
      } else {
        const rawVal = String(itemObj.valor || "").toUpperCase().trim();
        next1010[field] = {
          valor: rawVal === "S" || rawVal === "N" ? (rawVal as Sped1010IndicatorValue) : "N",
          status: "PENDENTE",
          descricao: String(itemObj.descricao || "").trim(),
        };
      }
    } else {
      const rawVal = String(rawItem).toUpperCase().trim();
      if (rawVal !== "S" && rawVal !== "N") {
        throw new SpedServiceError(`O valor do indicador ${field} deve ser estritamente "S" ou "N".`, 400, "INVALID_INDICATOR_VALUE");
      }
      next1010[field] = {
        valor: rawVal as Sped1010IndicatorValue,
        status: "CONFIRMADO",
        descricao: "Decisão fiscal confirmada pelo contador.",
        confirmadoEm: new Date().toISOString(),
        confirmadoPor: actorId,
      };
    }
  }

  merged.indicadores_1010 = next1010;
  return merged;
}

