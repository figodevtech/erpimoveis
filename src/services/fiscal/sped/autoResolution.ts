import type { SpedDiagnostic } from "@/lib/sped/efd-icms-ipi";

/**
 * Resolução automática do que o ERP já sabe e o SPED exige.
 *
 * Só decide quando a resposta decorre dos dados de forma determinística. Tudo
 * o que depende de julgamento fiscal sai como pendência única e objetiva. Os
 * planos são puros: quem persiste é o serviço, numa transação que revalida.
 */

export type SpedAutoProduct = {
  id: number;
  description: string | null;
  unit: string | null;
  ncm: string | null;
  cest: string | null;
  barcode: string | null;
  internalIcmsRate: number | null;
  deleted: boolean;
};

export type SpedProductUsage = {
  productId: number;
  /** Direção do documento na escrituração do declarante. */
  operation: "ENTRADA" | "SAIDA";
  ownIssued: boolean;
  /** CFOP como está no XML (do emitente). */
  cfop: string;
  documentKey: string;
  itemNumber: number;
};

export type SpedExistingItemConfig = {
  id: number;
  productId: number | null;
  code: string;
  itemType: string;
  start: string;
  end: string | null;
};

export type SpedPlannedItemConfig = {
  productId: number;
  code: string;
  itemType: string;
  start: string;
  end: string | null;
  evidence: string;
};

export type SpedItemResolutionPlan = {
  create: SpedPlannedItemConfig[];
  diagnostics: SpedDiagnostic[];
};

/** Saídas de produção do estabelecimento: o item é produto acabado, não revenda. */
const OWN_PRODUCTION_SUFFIXES = new Set(["101", "103", "105", "107", "109", "111", "113", "116", "118", "122", "124", "125", "401", "402"]);

const suffix = (cfop: string) => String(cfop ?? "").replace(/\D/g, "").slice(1, 4);

function overlaps(config: { start: string; end: string | null }, start: string, end: string): boolean {
  return config.start <= end && (!config.end || config.end >= start);
}

function previousDay(civilDate: string): string {
  const [year, month, day] = civilDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Produto mora no estoque de venda: é o que vai para ordem de serviço ou é
 * vendido, portanto mercadoria para revenda. Uso e consumo e o estoque geral
 * têm cadastro próprio e não passam por aqui. A exceção é a saída com CFOP de
 * produção, que indica indústria e pede classificação fiscal.
 */
function deriveItemType(usages: SpedProductUsage[]):
  | { itemType: string; evidence: string }
  | { itemType: null; reason: string } {
  const production = usages.find((usage) => usage.ownIssued && OWN_PRODUCTION_SUFFIXES.has(suffix(usage.cfop)));
  if (production) {
    return { itemType: null, reason: `saída com CFOP ${production.cfop} indica produção própria; o tipo do item (produto acabado, em processo etc.) depende de classificação fiscal` };
  }
  const entry = usages.find((usage) => !usage.ownIssued);
  const sample = entry ?? usages[0];
  const where = entry
    ? `entrada da NF-e ${sample.documentKey} item ${sample.itemNumber} (CFOP ${sample.cfop})`
    : `NF-e própria ${sample.documentKey} item ${sample.itemNumber} com CFOP ${sample.cfop}`;
  return { itemType: "00", evidence: `Produto do estoque de venda (usado em OS ou vendido): ${where}` };
}

export function planSpedItemResolution(input: {
  competenceStart: string;
  competenceEnd: string;
  products: ReadonlyMap<number, SpedAutoProduct>;
  usages: readonly SpedProductUsage[];
  configs: readonly SpedExistingItemConfig[];
}): SpedItemResolutionPlan {
  const { competenceStart: start, competenceEnd: end } = input;
  const create: SpedPlannedItemConfig[] = [];
  const diagnostics: SpedDiagnostic[] = [];
  const usagesByProduct = new Map<number, SpedProductUsage[]>();
  for (const usage of input.usages) {
    if (!usage.productId) continue;
    usagesByProduct.set(usage.productId, [...(usagesByProduct.get(usage.productId) ?? []), usage]);
  }
  const configsByProduct = new Map<number, SpedExistingItemConfig[]>();
  const productsByCode = new Map<string, Set<number | null>>();
  for (const config of input.configs) {
    if (config.productId) configsByProduct.set(config.productId, [...(configsByProduct.get(config.productId) ?? []), config]);
    const owners = productsByCode.get(config.code) ?? new Set<number | null>();
    owners.add(config.productId);
    productsByCode.set(config.code, owners);
  }

  // Um código canônico pertence a um único produto. Dois produtos com o mesmo
  // código vigente na competência fundiriam itens diferentes num só 0200.
  const sharedCodes = new Map<string, SpedExistingItemConfig[]>();
  for (const config of input.configs) {
    if (!config.productId || !overlaps(config, start, end)) continue;
    sharedCodes.set(config.code, [...(sharedCodes.get(config.code) ?? []), config]);
  }
  for (const [code, configs] of sharedCodes) {
    const products = Array.from(new Set(configs.map((config) => config.productId)));
    if (products.length < 2) continue;
    diagnostics.push({
      code: "CODIGO_ITEM_COMPARTILHADO",
      severity: "BLOQUEIO",
      message: `O código ${code} está vigente para os produtos ${products.join(", ")}. Cada produto precisa de um código próprio no 0200.`,
      record: "0200",
      source: { source: "CONFIGURACAO", table: "fiscal_sped_item_config", id: configs[0].id },
      context: { code, productIds: products },
    });
  }

  const reserved = new Set(input.configs.map((config) => config.code));
  for (const [productId, usages] of Array.from(usagesByProduct.entries()).sort(([left], [right]) => left - right)) {
    const configs = configsByProduct.get(productId) ?? [];
    if (configs.some((config) => overlaps(config, start, end))) continue;

    const product = input.products.get(productId);
    const sample = usages[0];
    if (!product || product.deleted) {
      diagnostics.push({
        code: "PRODUTO_DOCUMENTO_INEXISTENTE",
        severity: "BLOQUEIO",
        message: `O produto ${productId}, vinculado ao item ${sample.itemNumber} da NF-e ${sample.documentKey}, não existe mais no cadastro. Vincule o item a um produto ativo.`,
        record: "0200",
        source: { source: "BANCO", table: "produto", id: productId, documentKey: sample.documentKey },
      });
      continue;
    }

    const later = configs.filter((config) => config.start > end).sort((left, right) => left.start.localeCompare(right.start))[0];
    if (later) {
      // A classificação já confirmada para meses seguintes vale para trás com o
      // mesmo código e tipo: é a mesma identidade fiscal do produto.
      create.push({
        productId,
        code: later.code,
        itemType: later.itemType,
        start,
        end: previousDay(later.start),
        evidence: `Mesmo código e tipo da configuração ${later.id}, vigente a partir de ${later.start}`,
      });
      continue;
    }
    if (configs.length > 0) {
      diagnostics.push({
        code: "CONFIG_ITEM_ENCERRADA",
        severity: "BLOQUEIO",
        message: `O produto ${productId} (${product.description ?? "sem descrição"}) teve a configuração do 0200 encerrada antes desta competência. Confirme o código e o tipo vigentes.`,
        record: "0200",
        source: { source: "CONFIGURACAO", table: "fiscal_sped_item_config", id: configs[0].id },
        context: { productId },
      });
      continue;
    }

    const derived = deriveItemType(usages);
    if (derived.itemType == null) {
      diagnostics.push({
        code: "TIPO_ITEM_NAO_DERIVAVEL",
        severity: "BLOQUEIO",
        message: `Classifique o tipo do item do produto ${productId} (${product.description ?? "sem descrição"}): ${derived.reason}.`,
        record: "0200",
        field: "TIPO_ITEM",
        source: { source: "BANCO", table: "produto", id: productId, documentKey: sample.documentKey },
        context: { productId },
      });
      continue;
    }

    // O id do produto é a identidade estável no ERP: não muda com descrição,
    // referência ou código de barras, e nunca é reaproveitado.
    const code = [String(productId), `PROD${productId}`].find((candidate) => {
      const owners = productsByCode.get(candidate);
      return !reserved.has(candidate) || (owners?.size === 1 && owners.has(productId));
    });
    if (!code) {
      diagnostics.push({
        code: "CODIGO_ITEM_INDISPONIVEL",
        severity: "BLOQUEIO",
        message: `Os códigos ${productId} e PROD${productId} já pertencem a outros itens. Defina manualmente o código do produto ${productId}.`,
        record: "0200",
        source: { source: "BANCO", table: "produto", id: productId },
        context: { productId },
      });
      continue;
    }
    reserved.add(code);
    create.push({ productId, code, itemType: derived.itemType, start, end: null, evidence: derived.evidence });
  }
  return { create, diagnostics };
}

export type SpedCreditCandidate = {
  dfeId: number;
  itemNumber: number;
  documentKey: string;
  itemType: string | null;
  /** ICMS próprio destacado no item do XML. */
  xmlIcms: number;
  /** Crédito do Simples Nacional informado pelo fornecedor (vCredICMSSN). */
  xmlSimplesCredit: number;
  cst: string | null;
};

export type SpedPlannedCreditDecision = {
  dfeId: number;
  itemNumber: number;
  treatment: "CREDITAVEL" | "SEM_CREDITO" | "USO_CONSUMO" | "ATIVO_IMOBILIZADO";
  evidence: string;
};

export type SpedCreditPolicy = {
  /** Contador confirmou que compras para revenda com ICMS destacado geram crédito. */
  resaleCreditConfirmed: boolean;
  /** False: o regime não apropria crédito (Simples Nacional). Null/ausente: não decidido. */
  resaleCredit?: boolean | null;
};

export function planSpedCreditResolution(input: {
  candidates: readonly SpedCreditCandidate[];
  policy: SpedCreditPolicy;
}): { create: SpedPlannedCreditDecision[]; diagnostics: SpedDiagnostic[] } {
  const create: SpedPlannedCreditDecision[] = [];
  const diagnostics: SpedDiagnostic[] = [];
  let policyMissing = 0;
  for (const candidate of input.candidates) {
    const where = `item ${candidate.itemNumber} da NF-e ${candidate.documentKey}`;
    if (candidate.xmlIcms <= 0 && candidate.xmlSimplesCredit <= 0) {
      create.push({ dfeId: candidate.dfeId, itemNumber: candidate.itemNumber, treatment: "SEM_CREDITO", evidence: `XML sem ICMS destacado nem crédito do Simples no ${where}` });
      continue;
    }
    if (candidate.itemType === "07") {
      create.push({ dfeId: candidate.dfeId, itemNumber: candidate.itemNumber, treatment: "USO_CONSUMO", evidence: `Item classificado como material de uso e consumo (0200 tipo 07) no ${where}` });
      continue;
    }
    if (candidate.itemType === "08") {
      // O crédito do ativo é apropriado em 1/48 por mês no CIAP (Bloco G), fora do C170.
      create.push({ dfeId: candidate.dfeId, itemNumber: candidate.itemNumber, treatment: "ATIVO_IMOBILIZADO", evidence: `Item classificado como ativo imobilizado (0200 tipo 08) no ${where}; o crédito em 1/48 (CIAP) não é calculado pelo ERP` });
      continue;
    }
    if (input.policy.resaleCredit === false) {
      create.push({ dfeId: candidate.dfeId, itemNumber: candidate.itemNumber, treatment: "SEM_CREDITO", evidence: `Regime da empresa não apropria crédito de ICMS (LC 123/2006, art. 23) no ${where}` });
      continue;
    }
    // Fornecedor do Simples não destaca ICMS: informa o crédito que o comprador
    // pode aproveitar (vCredICMSSN). Para revenda, o comprador do regime normal
    // credita esse valor (LC 123/2006, art. 23, §1º).
    if (candidate.itemType === "00" && candidate.xmlIcms <= 0 && candidate.xmlSimplesCredit > 0) {
      if (input.policy.resaleCreditConfirmed) {
        create.push({ dfeId: candidate.dfeId, itemNumber: candidate.itemNumber, treatment: "CREDITAVEL", evidence: `Crédito do Simples Nacional de R$ ${candidate.xmlSimplesCredit.toFixed(2)} informado pelo fornecedor (LC 123/2006, art. 23) na compra para revenda do ${where}` });
      } else {
        policyMissing += 1;
      }
      continue;
    }
    const cstSuffix = String(candidate.cst ?? "").slice(-2);
    if (candidate.itemType === "00" && candidate.xmlIcms > 0 && cstSuffix !== "60" && input.policy.resaleCreditConfirmed) {
      create.push({ dfeId: candidate.dfeId, itemNumber: candidate.itemNumber, treatment: "CREDITAVEL", evidence: `Política confirmada de crédito nas compras para revenda; ICMS destacado de R$ ${candidate.xmlIcms.toFixed(2)} no ${where}` });
      continue;
    }
    if (candidate.itemType === "00" && candidate.xmlIcms > 0 && !input.policy.resaleCreditConfirmed) {
      policyMissing += 1;
      continue;
    }
    diagnostics.push({
      code: "TRATAMENTO_CREDITO_PENDENTE",
      severity: "BLOQUEIO",
      message: `Defina o tratamento de crédito do ${where}: o ICMS destacado depende de decisão fiscal (destinação ${candidate.itemType ?? "não classificada"}, CST ${candidate.cst ?? "não informado"}).`,
      record: "C170",
      source: { source: "XML", table: "fiscal_dfe_documento", id: candidate.dfeId, documentKey: candidate.documentKey },
      context: { itemNumber: candidate.itemNumber },
    });
  }
  if (policyMissing > 0) diagnostics.push({
    code: "POLITICA_CREDITO_REVENDA_PENDENTE",
    severity: "BLOQUEIO",
    message: `${policyMissing} item(ns) de compra para revenda com ICMS destacado aguardam a política de crédito. Confirme uma vez na configuração fiscal se essas compras geram crédito; as próximas competências usam a mesma decisão.`,
    record: "C170",
    source: { source: "CONFIGURACAO", table: "fiscal_sped_config" },
    context: { items: policyMissing },
  });
  return { create, diagnostics };
}
