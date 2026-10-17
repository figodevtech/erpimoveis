import type { SpedConditionalEvidence } from "@/lib/sped/efd-icms-ipi";

export type SpedEvidenceDocument = {
  key: string;
  xml: string;
  /** Emissão própria. C176/C179 detalham saídas do declarante, nunca a nota do fornecedor. */
  ownIssued: boolean;
  status: string;
};

function tag(block: string, name: string): string {
  return String(new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`, "i").exec(block)?.[1] ?? "").trim();
}

function positive(block: string, names: readonly string[]): boolean {
  return names.some((name) => Array.from(block.matchAll(new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]+?)\\s*</(?:\\w+:)?${name}>`, "gi")))
    .some((match) => {
      const value = Number(String(match[1]).replace(",", "."));
      return Number.isFinite(value) && value > 0;
    }));
}

function items(xml: string): string[] {
  return Array.from(xml.matchAll(/<(?:\w+:)?det\b[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/gi)).map((match) => match[1]);
}

/** Mercadoria que já teve o ICMS retido por substituição tributária na etapa anterior. */
function carriesRetainedSt(item: string): boolean {
  const cst = tag(item, "CST");
  const csosn = tag(item, "CSOSN");
  return cst === "60" || csosn === "500" || positive(item, ["vICMSSTRet", "vBCSTRet", "vICMSSubstituto"]);
}

/**
 * Saída que pode gerar direito a ressarcimento/complemento do ICMS-ST:
 * interestadual (CFOP 6xxx), exportação (7xxx) ou devolução ao fornecedor
 * (finNFe = 4). Venda interna de mercadoria com ST encerrada não gera.
 */
function ressarcimentoOperation(xml: string, item: string): boolean {
  const cfop = tag(item, "CFOP");
  return /^[67]\d{3}$/.test(cfop) || tag(xml, "finNFe") === "4";
}

/**
 * Indício de C176/C179. Exige as duas condições no mesmo item: mercadoria com
 * ST retida anteriormente e operação que pode gerar ressarcimento. CFOP
 * interestadual sozinho, ou ST destacada numa compra, não é indício: o
 * ressarcimento nasce da saída do declarante, não da entrada.
 */
export function detectC176C179Evidence(documents: readonly SpedEvidenceDocument[]): SpedConditionalEvidence {
  const keys = new Set<string>();
  for (const document of documents) {
    if (!document.ownIssued || !document.xml) continue;
    if (/CANCEL|DENEG/i.test(document.status)) continue;
    if (tag(document.xml, "tpNF") !== "1") continue;
    if (items(document.xml).some((item) => carriesRetainedSt(item) && ressarcimentoOperation(document.xml, item))) {
      keys.add(document.key);
    }
  }
  const sorted = Array.from(keys).sort();
  return { hasC176C179Evidence: sorted.length > 0, c176C179DocumentKeys: sorted };
}
