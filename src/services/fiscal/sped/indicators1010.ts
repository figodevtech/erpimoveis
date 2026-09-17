import type { SpedDiagnostic, SpedGateStatus } from "@/lib/sped/efd-icms-ipi";

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
  if (input.hasExportOperations) {
    register({
      campo: "IND_EXP",
      titulo: "Operações de Exportação",
      valor: "S",
      status: "CONFIRMADO",
      origem: "FONTES_MOVIMENTO",
      motivo: "Identificadas operações de exportação (CFOP 7xxx) nas fontes fiscais do período.",
    });
  } else if (config1010.IND_EXP != null) {
    const val = String(config1010.IND_EXP).toUpperCase() === "S" ? "S" : "N";
    register({
      campo: "IND_EXP",
      titulo: "Operações de Exportação",
      valor: val,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Decisão fiscal confirmada pelo contador: ${val}.`,
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
  if (config1010.IND_CCRF != null) {
    const val = String(config1010.IND_CCRF).toUpperCase() === "S" ? "S" : "N";
    register({
      campo: "IND_CCRF",
      titulo: "Controle de Créditos Fiscais de ICMS",
      valor: val,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Decisão fiscal confirmada pelo contador: ${val}.`,
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
  if (config1010.IND_COMB != null) {
    const val = String(config1010.IND_COMB).toUpperCase() === "S" ? "S" : "N";
    register({
      campo: "IND_COMB",
      titulo: "Operações com Combustíveis",
      valor: val,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Decisão fiscal confirmada pelo contador: ${val}.`,
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
  if (config1010.IND_USINA != null) {
    const val = String(config1010.IND_USINA).toUpperCase() === "S" ? "S" : "N";
    register({
      campo: "IND_USINA",
      titulo: "Usinas de Açúcar e Álcool",
      valor: val,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Decisão fiscal confirmada pelo contador: ${val}.`,
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
  if (config1010.IND_EE != null) {
    const val = String(config1010.IND_EE).toUpperCase() === "S" ? "S" : "N";
    register({
      campo: "IND_EE",
      titulo: "Operações com Energia Elétrica",
      valor: val,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Decisão fiscal confirmada pelo contador: ${val}.`,
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
  if (config1010.IND_FORM != null) {
    const val = String(config1010.IND_FORM).toUpperCase() === "S" ? "S" : "N";
    register({
      campo: "IND_FORM",
      titulo: "Documentos em Formulário de Segurança",
      valor: val,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Decisão fiscal confirmada pelo contador: ${val}.`,
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
  if (config1010.IND_AER != null) {
    const val = String(config1010.IND_AER).toUpperCase() === "S" ? "S" : "N";
    register({
      campo: "IND_AER",
      titulo: "Transporte Aéreo",
      valor: val,
      status: "CONFIRMADO",
      origem: "CONFIGURACAO",
      motivo: `Decisão fiscal confirmada pelo contador: ${val}.`,
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
    } else if (config1010[giafField] != null) {
      const val = String(config1010[giafField]).toUpperCase() === "S" ? "S" : "N";
      register({
        campo: giafField,
        titulo: `GIAF ${num} (Guia de Informações Fiscais - PE)`,
        valor: val,
        status: "CONFIRMADO",
        origem: "CONFIGURACAO",
        motivo: `Decisão fiscal confirmada pelo contador: ${val}.`,
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
