import { SpedServiceError } from "./errors";

export type SpedFileKind = "PREVIA" | "FINAL";

export interface StoredSpedFileRecord {
  id?: string | number;
  versao_id: number | string;
  sequencia: number;
  tipo: SpedFileKind;
  storage_bucket?: string;
  storage_path?: string;
  arquivo_sha256: string;
}

export function buildSpedStoragePath(
  empresaId: number | string,
  competencia: string,
  versaoNumero: number | string,
  tipo: SpedFileKind,
  hash: string
): string {
  const comp = competencia.slice(0, 7);
  return `${empresaId}/${comp}/v${versaoNumero}/${tipo.toLowerCase()}-${hash}.txt`;
}

export function validateSpedFileGenerationPreconditions(input: {
  tipo: unknown;
  competenceStatus?: string | null;
  versionStatus?: string | null;
  hasVersion?: boolean;
}): { tipo: SpedFileKind } {
  const rawTipo = input.tipo ?? "FINAL";
  if (rawTipo !== "PREVIA" && rawTipo !== "FINAL") {
    throw new SpedServiceError("Tipo de arquivo inválido. Utilize PREVIA ou FINAL.", 400, "INVALID_FILE_KIND");
  }
  const tipo = rawTipo as SpedFileKind;

  if (input.hasVersion === false) {
    throw new SpedServiceError("Versão SPED não encontrada.", 404, "VERSION_NOT_FOUND");
  }

  if (tipo === "FINAL" && (input.versionStatus !== "FECHADA" || input.competenceStatus !== "FECHADA")) {
    throw new SpedServiceError("O TXT final só pode ser gerado de uma versão fechada.", 422, "VERSION_NOT_CLOSED");
  }

  return { tipo };
}

export function shouldCreateNewSpedFile(
  existingFiles: StoredSpedFileRecord[],
  target: { versao_id: number | string; tipo: SpedFileKind; arquivo_sha256: string }
): boolean {
  return !existingFiles.some(
    (f) =>
      String(f.versao_id) === String(target.versao_id) &&
      f.tipo === target.tipo &&
      f.arquivo_sha256 === target.arquivo_sha256
  );
}

export function recordSpedFileRegistry(
  existingFiles: StoredSpedFileRecord[],
  file: {
    versao_id: number | string;
    tipo: SpedFileKind;
    arquivo_sha256: string;
    storage_path?: string;
    storage_bucket?: string;
  }
): { created: boolean; record: StoredSpedFileRecord; files: StoredSpedFileRecord[] } {
  const existing = existingFiles.find(
    (f) =>
      String(f.versao_id) === String(file.versao_id) &&
      f.tipo === file.tipo &&
      f.arquivo_sha256 === file.arquivo_sha256
  );

  if (existing) {
    return { created: false, record: existing, files: existingFiles };
  }

  const nextSeq = existingFiles.reduce((max, f) => Math.max(max, f.sequencia), 0) + 1;
  const newRecord: StoredSpedFileRecord = {
    ...file,
    sequencia: nextSeq,
    id: nextSeq,
  };
  return { created: true, record: newRecord, files: [...existingFiles, newRecord] };
}

/**
 * Avalia erro de banco de dados para evitar mascarar conflito de sequência como se fosse duplicidade de hash.
 */
export function classifySpedDbInsertError(error: { code?: string; message?: string; constraint?: string }): {
  isHashDuplicate: boolean;
  isSequenceConflict: boolean;
  isFatal: boolean;
} {
  const code = error?.code;
  const message = String(error?.message || "");
  const constraint = String(error?.constraint || "");

  if (code === "23505") {
    if (constraint.includes("tipo_hash") || message.includes("tipo_hash") || message.includes("arquivo_versao_tipo_hash_uk")) {
      return { isHashDuplicate: true, isSequenceConflict: false, isFatal: false };
    }
    if (constraint.includes("sequencia") || message.includes("sequencia") || message.includes("versao_id_sequencia")) {
      return { isHashDuplicate: false, isSequenceConflict: true, isFatal: true };
    }
  }

  return { isHashDuplicate: false, isSequenceConflict: false, isFatal: true };
}
