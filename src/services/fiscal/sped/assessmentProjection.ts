import { endOfCompetence, parseCompetence } from "@/lib/fiscal-date";
import type { EfdRecord, SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";

import type { ProjectedFiscalDocument } from "./documentProjection";

type Row = Record<string, any>;

export type SpedAssessmentAdjustment = {
  id: string | number;
  destination: "E111" | "E115" | "E116" | "E311" | "E312" | "E313" | "E316";
  nature: "DEBITO" | "CREDITO" | "ESTORNO_CREDITO" | "ESTORNO_DEBITO" | "DEDUCAO" | "DEBITO_ESPECIAL" | "INFORMATIVO" | "RECOLHIMENTO" | "REFERENCIA";
  code: string;
  uf?: string | null;
  value: number;
  description: string;
  documentNumber?: string | null;
  reference?: Row;
};

export type SpedAssessmentSnapshot = {
  type: "ICMS_PROPRIO" | "DIFAL";
  uf: string | null;
  periodStart: string;
  periodEnd: string;
  payload: Row;
};

export type SpedAssessmentProjection = {
  blockERecords: EfdRecord[];
  snapshots: SpedAssessmentSnapshot[];
  diagnostics: SpedDiagnostic[];
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function cents(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function adjustmentRecord(adjustment: SpedAssessmentAdjustment): EfdRecord | null {
  const source = { source: "LANCAMENTO_MANUAL" as const, table: "fiscal_sped_ajuste_apuracao", id: adjustment.id };
  if (adjustment.destination === "E111" || adjustment.destination === "E311") return {
    code: adjustment.destination,
    values: {
      COD_AJ_APUR: adjustment.code,
      DESCR_COMPL_AJ: adjustment.description,
      VL_AJ_APUR: cents(adjustment.value),
    },
    source,
  };
  if (adjustment.destination === "E115") return {
    code: "E115",
    values: {
      COD_INF_ADIC: adjustment.code,
      VL_INF_ADIC: cents(adjustment.value),
      DESCR_COMPL_AJ: adjustment.description,
    },
    source,
  };
  if (adjustment.destination === "E116" || adjustment.destination === "E316") return {
    code: adjustment.destination,
    values: {
      COD_OR: adjustment.code,
      VL_OR: cents(adjustment.value),
      DT_VCTO: text(adjustment.reference?.dataVencimento),
      COD_REC: text(adjustment.reference?.codigoReceita),
      NUM_PROC: text(adjustment.reference?.numeroProcesso),
      IND_PROC: text(adjustment.reference?.indicadorProcesso),
      PROC: text(adjustment.reference?.processo),
      TXT_COMPL: adjustment.description,
      MES_REF: text(adjustment.reference?.mesReferencia),
    },
    source,
  };
  return null;
}

function sumAdjustments(adjustments: SpedAssessmentAdjustment[], nature: SpedAssessmentAdjustment["nature"]): number {
  return cents(adjustments.filter((item) => item.nature === nature).reduce((sum, item) => sum + cents(item.value), 0));
}

function previousOwnBalance(priorEfd: Row | null): number {
  return cents(priorEfd?.saldos_apuracao?.icmsProprio?.saldoCredorTransportar);
}

function previousDifalBalance(priorEfd: Row | null, uf: string, field: "saldoCredorDifalTransportar" | "saldoCredorFcpTransportar"): number {
  const rows = priorEfd?.saldos_apuracao?.difalFcpByUf;
  if (!Array.isArray(rows)) return 0;
  const found = rows.find((row: Row) => text(row.uf).toUpperCase() === uf);
  return cents(found?.[field]);
}

export function projectSpedAssessment(input: {
  competence: string;
  documents: ProjectedFiscalDocument[];
  priorEfd: Row | null;
  adjustments?: SpedAssessmentAdjustment[];
}): SpedAssessmentProjection {
  const { start } = parseCompetence(input.competence);
  const end = endOfCompetence(input.competence);
  const adjustments = input.adjustments ?? [];
  const ownAdjustments = adjustments.filter((item) => !item.uf);
  const diagnostics: SpedDiagnostic[] = [];
  const outputDocuments = input.documents.filter((document) => document.operation === "SAIDA" && document.situationCode !== "02");
  const inputDocuments = input.documents.filter((document) => document.operation === "ENTRADA" && document.situationCode !== "02");

  const totalDebits = cents(outputDocuments.reduce((sum, document) => sum + cents(document.payload.totais?.vICMS), 0));
  const totalCredits = cents(inputDocuments.reduce((documentSum, document) => documentSum + document.items
    .filter((item) => item.creditTreatment === "CREDITAVEL")
    .reduce((itemSum, item) => itemSum + cents(item.payload.valor_icms), 0), 0));
  const previousCredit = previousOwnBalance(input.priorEfd);
  const adjustmentDebits = sumAdjustments(ownAdjustments, "DEBITO");
  const adjustmentCredits = sumAdjustments(ownAdjustments, "CREDITO");
  const creditReversals = sumAdjustments(ownAdjustments, "ESTORNO_CREDITO");
  const debitReversals = sumAdjustments(ownAdjustments, "ESTORNO_DEBITO");
  const deductions = sumAdjustments(ownAdjustments, "DEDUCAO");
  const specialDebits = sumAdjustments(ownAdjustments, "DEBITO_ESPECIAL");
  const debitSide = cents(totalDebits + adjustmentDebits + creditReversals);
  const creditSide = cents(totalCredits + adjustmentCredits + debitReversals + previousCredit);
  const assessedBalance = cents(Math.max(0, debitSide - creditSide));
  const taxDue = cents(Math.max(0, assessedBalance - deductions));
  const creditCarry = cents(Math.max(0, creditSide - debitSide));

  const e110: EfdRecord = {
    code: "E110",
    values: {
      VL_TOT_DEBITOS: totalDebits,
      VL_AJ_DEBITOS: 0,
      VL_TOT_AJ_DEBITOS: adjustmentDebits,
      VL_ESTORNOS_CRED: creditReversals,
      VL_TOT_CREDITOS: totalCredits,
      VL_AJ_CREDITOS: 0,
      VL_TOT_AJ_CREDITOS: adjustmentCredits,
      VL_ESTORNOS_DEB: debitReversals,
      VL_SLD_CREDOR_ANT: previousCredit,
      VL_SLD_APURADO: assessedBalance,
      VL_TOT_DED: deductions,
      VL_ICMS_RECOLHER: taxDue,
      VL_SLD_CREDOR_TRANSPORTAR: creditCarry,
      DEB_ESP: specialDebits,
    },
    source: { source: "CALCULO" },
  };

  const e111 = ownAdjustments.filter((item) => item.destination === "E111").map(adjustmentRecord).filter(Boolean) as EfdRecord[];
  const e115 = ownAdjustments.filter((item) => item.destination === "E115").map(adjustmentRecord).filter(Boolean) as EfdRecord[];
  const e116Adjustments = ownAdjustments.filter((item) => item.destination === "E116");
  const e116 = e116Adjustments.map(adjustmentRecord).filter(Boolean) as EfdRecord[];
  if (taxDue > 0 && e116.length === 0) diagnostics.push({
    code: "E116_RECOLHIMENTO_AUSENTE",
    severity: "BLOQUEIO",
    message: `A apuração própria possui R$ ${taxDue.toFixed(2)} a recolher, mas não há E116 revisado.`,
    record: "E116",
    source: { source: "CALCULO" },
  });
  const e116Total = cents(e116Adjustments.reduce((sum, item) => sum + item.value, 0));
  if (e116.length > 0 && e116Total !== taxDue) diagnostics.push({
    code: "E116_VALOR_DIVERGENTE",
    severity: "BLOQUEIO",
    message: `Os E116 totalizam R$ ${e116Total.toFixed(2)}, mas o ICMS próprio a recolher é R$ ${taxDue.toFixed(2)}.`,
    record: "E116",
    source: { source: "LANCAMENTO_MANUAL", table: "fiscal_sped_ajuste_apuracao" },
  });
  for (const adjustment of e116Adjustments) {
    if (!text(adjustment.reference?.dataVencimento)) diagnostics.push({
      code: "E116_VENCIMENTO_AUSENTE",
      severity: "BLOQUEIO",
      message: `O recolhimento ${adjustment.id} não possui data de vencimento.`,
      record: "E116",
      field: "DT_VCTO",
      source: { source: "LANCAMENTO_MANUAL", table: "fiscal_sped_ajuste_apuracao", id: adjustment.id },
    });
  }

  const blockERecords: EfdRecord[] = [
    { code: "E100", values: { DT_INI: start, DT_FIN: end }, source: { source: "CALCULO" } },
    e110,
    ...e111,
    ...e115,
    ...e116,
  ];
  const snapshots: SpedAssessmentSnapshot[] = [{
    type: "ICMS_PROPRIO",
    uf: null,
    periodStart: start,
    periodEnd: end,
    payload: {
      saldoCredorAnterior: previousCredit,
      totalDebitos: totalDebits,
      totalCreditos: totalCredits,
      totalAjustes: cents(adjustmentDebits + adjustmentCredits + creditReversals + debitReversals + deductions + specialDebits),
      impostoRecolher: taxDue,
      saldoTransportar: creditCarry,
      linhas: [
        { id: "saldo-anterior", grupo: "SALDO", codigo: null, descricao: "Saldo credor da EFD anterior", valor: previousCredit, origem: "EFD anterior", fontes: [] },
        { id: "debitos-documentos", grupo: "DÉBITO", codigo: null, descricao: "ICMS destacado nas saídas", valor: totalDebits, origem: "XML", fontes: [] },
        { id: "creditos-documentos", grupo: "CRÉDITO", codigo: null, descricao: "ICMS de entradas classificadas como creditáveis", valor: totalCredits, origem: "XML + decisão fiscal", fontes: [] },
      ],
    },
  }];

  const difalByUf = new Map<string, { difal: number; fcp: number }>();
  for (const document of outputDocuments) {
    const uf = text(document.payload.participanteUf).toUpperCase();
    const difal = cents(document.items.reduce((sum, item) => sum + cents(item.payload.valor_icms_uf_dest), 0));
    const fcp = cents(document.items.reduce((sum, item) => sum + cents(item.payload.valor_fcp_uf_dest), 0));
    if (!difal && !fcp) continue;
    if (!/^[A-Z]{2}$/.test(uf)) {
      diagnostics.push({
        code: "DIFAL_UF_DESTINO_AUSENTE",
        severity: "BLOQUEIO",
        message: `A NF-e ${document.key} possui DIFAL/FCP sem UF de destino confiável.`,
        record: "E300",
        source: { source: "XML", table: document.sourceTable, id: document.sourceId, documentKey: document.key },
      });
      continue;
    }
    const current = difalByUf.get(uf) ?? { difal: 0, fcp: 0 };
    current.difal = cents(current.difal + difal);
    current.fcp = cents(current.fcp + fcp);
    difalByUf.set(uf, current);
  }

  for (const [uf, totals] of Array.from(difalByUf.entries()).sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const previousDifal = previousDifalBalance(input.priorEfd, uf, "saldoCredorDifalTransportar");
    const previousFcp = previousDifalBalance(input.priorEfd, uf, "saldoCredorFcpTransportar");
    const ufAdjustments = adjustments.filter((item) => text(item.uf).toUpperCase() === uf);
    const e311Adjustments = ufAdjustments.filter((item) => item.destination === "E311");
    const taxAdjustments = (tax: "DIFAL" | "FCP") => e311Adjustments.filter(
      (item) => text(item.reference?.tributo).toUpperCase() === tax,
    );
    for (const adjustment of e311Adjustments) {
      if (!["DIFAL", "FCP"].includes(text(adjustment.reference?.tributo).toUpperCase())) diagnostics.push({
        code: "E311_TRIBUTO_AUSENTE",
        severity: "BLOQUEIO",
        message: `O ajuste E311 ${adjustment.id} não informa se compõe DIFAL ou FCP.`,
        record: "E311",
        source: { source: "LANCAMENTO_MANUAL", table: "fiscal_sped_ajuste_apuracao", id: adjustment.id },
      });
    }
    const difalAdjustments = taxAdjustments("DIFAL");
    const fcpAdjustments = taxAdjustments("FCP");
    const outsideDebits = (rows: SpedAssessmentAdjustment[]) => cents(
      sumAdjustments(rows, "DEBITO") + sumAdjustments(rows, "ESTORNO_CREDITO"),
    );
    const outsideCredits = (rows: SpedAssessmentAdjustment[]) => cents(
      sumAdjustments(rows, "CREDITO") + sumAdjustments(rows, "ESTORNO_DEBITO"),
    );
    const difalOtherDebits = outsideDebits(difalAdjustments);
    const difalOtherCredits = outsideCredits(difalAdjustments);
    const difalDeductions = sumAdjustments(difalAdjustments, "DEDUCAO");
    const difalSpecialDebits = sumAdjustments(difalAdjustments, "DEBITO_ESPECIAL");
    const difalDebitSide = cents(totals.difal + difalOtherDebits);
    const difalCreditSide = cents(previousDifal + difalOtherCredits);
    const difalDue = cents(Math.max(0, difalDebitSide - difalCreditSide - difalDeductions));
    const difalCarry = cents(Math.max(0, difalCreditSide - difalDebitSide));
    const fcpOtherDebits = outsideDebits(fcpAdjustments);
    const fcpOtherCredits = outsideCredits(fcpAdjustments);
    const fcpDeductions = sumAdjustments(fcpAdjustments, "DEDUCAO");
    const fcpSpecialDebits = sumAdjustments(fcpAdjustments, "DEBITO_ESPECIAL");
    const fcpDebitSide = cents(totals.fcp + fcpOtherDebits);
    const fcpCreditSide = cents(previousFcp + fcpOtherCredits);
    const fcpDue = cents(Math.max(0, fcpDebitSide - fcpCreditSide - fcpDeductions));
    const fcpCarry = cents(Math.max(0, fcpCreditSide - fcpDebitSide));
    const e316Adjustments = ufAdjustments.filter((item) => item.destination === "E316");
    const e316 = e316Adjustments.map(adjustmentRecord).filter(Boolean) as EfdRecord[];
    const expectedDue = cents(difalDue + fcpDue);
    const informedDue = cents(e316Adjustments.reduce((sum, item) => sum + item.value, 0));
    if (expectedDue > 0 && e316.length === 0) diagnostics.push({
      code: "E316_RECOLHIMENTO_AUSENTE",
      severity: "BLOQUEIO",
      message: `Há R$ ${expectedDue.toFixed(2)} de DIFAL/FCP a recolher para ${uf}, mas não há E316 revisado.`,
      record: "E316",
      source: { source: "CALCULO" },
    });
    if (e316.length > 0 && informedDue !== expectedDue) diagnostics.push({
      code: "E316_VALOR_DIVERGENTE",
      severity: "BLOQUEIO",
      message: `Os E316 de ${uf} totalizam R$ ${informedDue.toFixed(2)}, mas o valor calculado é R$ ${expectedDue.toFixed(2)}.`,
      record: "E316",
      source: { source: "LANCAMENTO_MANUAL", table: "fiscal_sped_ajuste_apuracao" },
    });
    blockERecords.push(
      { code: "E300", values: { UF: uf }, source: { source: "CALCULO" } },
      {
        code: "E310",
        values: {
          IND_MOV_FCP_DIFAL: "0",
          VL_SLD_CRED_ANT_DIFAL: previousDifal,
          VL_TOT_DEBITOS_DIFAL: totals.difal,
          VL_OUT_DEB_DIFAL: difalOtherDebits,
          VL_TOT_CREDITOS_DIFAL: 0,
          VL_OUT_CRED_DIFAL: difalOtherCredits,
          VL_SLD_DEV_ANT_DIFAL: 0,
          VL_DEDUCOES_DIFAL: difalDeductions,
          VL_RECOL_DIFAL: difalDue,
          VL_SLD_CRED_TRANSPORTAR_DIFAL: difalCarry,
          DEB_ESP_DIFAL: difalSpecialDebits,
          VL_SLD_CRED_ANT_FCP: previousFcp,
          VL_TOT_DEB_FCP: totals.fcp,
          VL_OUT_DEB_FCP: fcpOtherDebits,
          VL_TOT_CRED_FCP: 0,
          VL_OUT_CRED_FCP: fcpOtherCredits,
          VL_SLD_DEV_ANT_FCP: 0,
          VL_DEDUCOES_FCP: fcpDeductions,
          VL_RECOL_FCP: fcpDue,
          VL_SLD_CRED_TRANSPORTAR_FCP: fcpCarry,
          DEB_ESP_FCP: fcpSpecialDebits,
        },
        source: { source: "CALCULO" },
      },
      ...(e311Adjustments.map(adjustmentRecord).filter(Boolean) as EfdRecord[]),
      ...e316,
    );
    snapshots.push({
      type: "DIFAL",
      uf,
      periodStart: start,
      periodEnd: end,
      payload: { totalDebitosDifal: totals.difal, totalDebitosFcp: totals.fcp, difalRecolher: difalDue, fcpRecolher: fcpDue },
    });
  }

  return { blockERecords, snapshots, diagnostics };
}
