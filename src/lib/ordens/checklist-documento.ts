export type ChecklistTipo = "ENTRADA" | "SAIDA";

export const CHECKLIST_TIPO_LABEL: Record<ChecklistTipo, string> = {
  ENTRADA: "ENTRADA",
  SAIDA: "SAÍDA",
};

export const CHECKLIST_PDF_GENERATOR_VERSION = "checklist-pdf-lib-v7";

export type ChecklistDocumentoStatus =
  | "NAO_ASSINADO"
  | "ASSINADO_PENDENTE_PDF"
  | "ASSINADO";

export type ChecklistSignatarioQualidade =
  | "CLIENTE"
  | "PROPRIETARIO"
  | "RECEBEDOR"
  | "OUTRO";

export type ChecklistCampo = {
  rotulo: string;
  valor: string;
};

export type ChecklistSnapshotAsset = {
  origemId: string;
  storagePath: string;
  sha256: string;
  mimeType: string;
  tamanhoBytes: number;
  descricao: string | null;
  registradoEm: string | null;
};

export type ChecklistSnapshotItem = {
  origemId: string;
  titulo: string;
  descricao: string | null;
  categoria: string | null;
  ordem: number;
  resposta: string;
  observacao: string | null;
  registradoEm: string | null;
  responsavel: string | null;
  fotos: ChecklistSnapshotAsset[];
};

export type ChecklistPrintItemEntry<T> = {
  item: T;
  index: number;
};

export type ChecklistPrintItemGroup<T> =
  | { kind: "compact"; entries: ChecklistPrintItemEntry<T>[] }
  | { kind: "full"; entry: ChecklistPrintItemEntry<T> };

export function groupChecklistItemsForPrint<T extends { fotos: readonly unknown[] }>(
  items: readonly T[],
): ChecklistPrintItemGroup<T>[] {
  const groups: ChecklistPrintItemGroup<T>[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const next = items[index + 1];
    if (item.fotos.length !== 1 || next?.fotos.length !== 1) {
      groups.push({ kind: "full", entry: { item, index } });
      continue;
    }

    groups.push({
      kind: "compact",
      entries: [{ item, index }, { item: next, index: index + 1 }],
    });
    index += 1;
  }
  return groups;
}

export type ChecklistSnapshotV1 = {
  schemaVersion: 1;
  documento: {
    publicId: string;
    codigo: string;
    tipo: ChecklistTipo;
    versao: number;
    criadoEm: string;
  };
  empresa: {
    nome: string;
    campos: ChecklistCampo[];
    logo: ChecklistSnapshotAsset | null;
    cores: {
      primaria: string;
      secundaria: string;
      texto: string;
    };
  };
  ordemServico: {
    id: number;
    campos: ChecklistCampo[];
    cliente: ChecklistCampo[];
    objeto: {
      tipo: string;
      titulo: string;
      campos: ChecklistCampo[];
    };
  };
  checklist: {
    modelo: string | null;
    descricaoModelo: string | null;
    inspecionadoEm: string | null;
    responsaveis: string[];
    retiradoPor: string | null;
    observacaoDocumento: string | null;
    itens: ChecklistSnapshotItem[];
  };
  declaracao: string;
};

export type ChecklistDocumentoMudancas = {
  primeiraVersao: boolean;
  conteudoIdentico: boolean;
  adicionados: string[];
  removidos: string[];
  alterados: string[];
  fotosAdicionadas: number;
  fotosRemovidas: number;
};

export type ChecklistDocumentoResumo = {
  publicId: string;
  codigo: string;
  ordemServicoId: number;
  tipo: ChecklistTipo;
  versao: number;
  criadoEm: string;
  criadoPor: string | null;
  snapshotHash: string;
  conteudoHash: string;
  pdfHash: string | null;
  mudancas: ChecklistDocumentoMudancas;
  status: ChecklistDocumentoStatus;
  maisRecente: boolean;
  conteudoAtualDivergente: boolean | null;
};

export type ChecklistAssinaturaPublica = {
  nome: string;
  documento: string;
  qualidade: ChecklistSignatarioQualidade;
  qualidadeOutro: string | null;
  declaracao: string;
  metodo: "PRESENCIAL_DESENHADA";
  assinaturaPath: string;
  assinaturaHash: string;
  assinaturaVinculoHash: string;
  operadorNome: string | null;
  assinadoEm: string;
};

export const CHECKLIST_DECLARACAO =
  "Declaro estar ciente do conteúdo deste checklist, incluindo os itens, respostas, observações, fotografias e condições registradas no momento da inspeção.";

export const CHECKLIST_QUALIDADE_LABEL: Record<ChecklistSignatarioQualidade, string> = {
  CLIENTE: "Cliente",
  PROPRIETARIO: "Proprietário",
  RECEBEDOR: "Recebedor",
  OUTRO: "Outro",
};

export function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatCpfCnpj(value: unknown) {
  const digits = onlyDigits(value);
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return String(value ?? "").trim();
}

function cpfValido(digits: string) {
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  const calculate = (length: number) => {
    let total = 0;
    for (let index = 0; index < length; index += 1) {
      total += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calculate(9) === Number(digits[9]) && calculate(10) === Number(digits[10]);
}

function cnpjValido(digits: string) {
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calculate = (length: 12 | 13) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const total = weights.reduce((sum, weight, index) => sum + Number(digits[index]) * weight, 0);
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13]);
}

export function documentoFiscalValido(value: unknown) {
  const digits = onlyDigits(value);
  return digits.length === 11 ? cpfValido(digits) : cnpjValido(digits);
}

export function statusChecklistDocumento(hasSignature: boolean, hasPdf: boolean): ChecklistDocumentoStatus {
  if (!hasSignature) return "NAO_ASSINADO";
  return hasPdf ? "ASSINADO" : "ASSINADO_PENDENTE_PDF";
}

export function tipoChecklistValido(value: unknown): value is ChecklistTipo {
  return value === "ENTRADA" || value === "SAIDA";
}

export function checklistPublicIdValido(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value ?? ""),
  );
}
