import { SpedServiceError } from "./errors";

export type SpedFileKind = "PREVIA" | "FINAL";

export interface StoredSpedFileRecord {
  id?: string | number;
  versao_id: number | string;
  tipo: SpedFileKind;
  arquivo_sha256: string;
  sequencia: number;
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
  file: { versao_id: number | string; tipo: SpedFileKind; arquivo_sha256: string }
): { created: boolean; files: StoredSpedFileRecord[] } {
  if (!shouldCreateNewSpedFile(existingFiles, file)) {
    return { created: false, files: existingFiles };
  }
  const nextSeq = existingFiles.reduce((max, f) => Math.max(max, f.sequencia), 0) + 1;
  const newRecord: StoredSpedFileRecord = {
    ...file,
    sequencia: nextSeq,
    id: nextSeq,
  };
  return { created: true, files: [...existingFiles, newRecord] };
}
