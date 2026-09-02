import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CHECKLIST_DECLARACAO,
  documentoFiscalValido,
  onlyDigits,
  type ChecklistSignatarioQualidade,
} from "./checklist-documento";
import { sha256, stableJson } from "./checklist-documento-hash";
import {
  CHECKLIST_DOCUMENTOS_BUCKET,
  ChecklistDocumentoError,
  loadChecklistDocumento,
  registerChecklistDocumentoEvent,
} from "./checklist-documentos-server";

const QUALIDADES = new Set<ChecklistSignatarioQualidade>([
  "CLIENTE",
  "PROPRIETARIO",
  "RECEBEDOR",
  "OUTRO",
]);

function signatureBytes(dataUrl: unknown) {
  const value = String(dataUrl ?? "");
  if (value.length > 4_000_000) {
    throw new ChecklistDocumentoError("A imagem da assinatura excede o limite permitido.", 413, "ASSINATURA_GRANDE");
  }
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new ChecklistDocumentoError("A assinatura desenhada é inválida.", 400, "ASSINATURA_INVALIDA");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length) throw new ChecklistDocumentoError("Desenhe a assinatura antes de continuar.", 400, "ASSINATURA_VAZIA");
  return bytes;
}

export async function normalizeAndValidateSignature(dataUrl: unknown) {
  const source = signatureBytes(dataUrl);
  let raw: { data: Buffer; info: sharp.OutputInfo };
  try {
    raw = await sharp(source, { failOn: "error", limitInputPixels: 8_000_000 })
      .rotate()
      .resize({ width: 1200, height: 400, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ChecklistDocumentoError("A imagem da assinatura não pôde ser lida.", 400, "ASSINATURA_INVALIDA");
  }

  let inkPixels = 0;
  for (let index = 0; index < raw.data.length; index += raw.info.channels) {
    if (raw.data[index] < 235 || raw.data[index + 1] < 235 || raw.data[index + 2] < 235) inkPixels += 1;
  }
  if (inkPixels < 80) {
    throw new ChecklistDocumentoError("Desenhe uma assinatura visível antes de continuar.", 400, "ASSINATURA_VAZIA");
  }

  return sharp(raw.data, { raw: raw.info }).png({ compressionLevel: 9 }).toBuffer();
}

export async function preserveChecklistSignature(dataUrl: unknown) {
  const png = await normalizeAndValidateSignature(dataUrl);
  const hash = sha256(png);
  const path = `assinaturas/${hash}.png`;
  const upload = await supabaseAdmin.storage.from(CHECKLIST_DOCUMENTOS_BUCKET).upload(path, png, {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upload.error && !/already exists|duplicate|resource exists/i.test(String(upload.error.message ?? ""))) {
    throw upload.error;
  }
  return { png, hash, path };
}

export async function signChecklistDocumento(args: {
  publicId: string;
  userId: string;
  nome: unknown;
  documento: unknown;
  qualidade: unknown;
  qualidadeOutro: unknown;
  assinaturaDataUrl: unknown;
  declaracaoCiente: unknown;
  audit: { ip: string | null; userAgent: string | null };
}) {
  const name = String(args.nome ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 160) {
    throw new ChecklistDocumentoError("Informe o nome completo do cliente ou responsável.", 400, "NOME_INVALIDO");
  }
  const documentNumber = onlyDigits(args.documento);
  if (!documentoFiscalValido(documentNumber)) {
    throw new ChecklistDocumentoError("Informe um CPF ou CNPJ válido.", 400, "DOCUMENTO_INVALIDO");
  }
  const quality = String(args.qualidade ?? "").toUpperCase() as ChecklistSignatarioQualidade;
  if (!QUALIDADES.has(quality)) {
    throw new ChecklistDocumentoError("Selecione a função do signatário.", 400, "QUALIDADE_INVALIDA");
  }
  const qualityOther = String(args.qualidadeOutro ?? "").trim();
  if (quality === "OUTRO" && (qualityOther.length < 2 || qualityOther.length > 80)) {
    throw new ChecklistDocumentoError("Descreva a função do signatário.", 400, "QUALIDADE_INVALIDA");
  }
  if (args.declaracaoCiente !== true) {
    throw new ChecklistDocumentoError("Confirme a ciência do conteúdo do checklist.", 400, "CIENCIA_NAO_CONFIRMADA");
  }

  const document = await loadChecklistDocumento(args.publicId, { checkCurrentContent: false });
  if (!document.maisRecente) {
    throw new ChecklistDocumentoError("Somente a versão mais recente deste checklist pode ser assinada.", 409, "VERSAO_ANTIGA");
  }
  if (document.assinatura) {
    throw new ChecklistDocumentoError("Esta versão já foi assinada.", 409, "ASSINATURA_DUPLICADA");
  }

  const preservedSignature = await preserveChecklistSignature(args.assinaturaDataUrl);
  const signatureHash = preservedSignature.hash;
  const signaturePath = preservedSignature.path;

  const signedAt = new Date().toISOString();
  const declarationHash = sha256(CHECKLIST_DECLARACAO);
  const linkHash = sha256(stableJson({
    snapshotHash: document.snapshotHash,
    signatureHash,
    signatarioDocumento: documentNumber,
    signatarioNome: name,
    signatarioQualidade: quality,
    qualidadeOutro: quality === "OUTRO" ? qualityOther : null,
    declaracaoHash: declarationHash,
    assinadoEm: signedAt,
  }));
  const inserted = await supabaseAdmin.from("checklist_documento_assinatura").insert({
    documento_id: document.id,
    signatario_nome: name,
    signatario_documento: documentNumber,
    signatario_qualidade: quality,
    qualidade_outro: quality === "OUTRO" ? qualityOther : null,
    declaracao: CHECKLIST_DECLARACAO,
    declaracao_hash: declarationHash,
    metodo: "PRESENCIAL_DESENHADA",
    assinatura_path: signaturePath,
    assinatura_hash: signatureHash,
    assinatura_vinculo_hash: linkHash,
    snapshot_hash: document.snapshotHash,
    operador_usuario_id: args.userId,
    request_ip: args.audit.ip,
    user_agent: args.audit.userAgent,
    assinado_em: signedAt,
  });
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      throw new ChecklistDocumentoError("Esta versão já foi assinada.", 409, "ASSINATURA_DUPLICADA");
    }
    if (inserted.error.code === "55000") {
      throw new ChecklistDocumentoError(inserted.error.message, 409, "VERSAO_ANTIGA");
    }
    throw inserted.error;
  }

  await registerChecklistDocumentoEvent({
    documentoId: document.id,
    tipo: "ASSINATURA_REGISTRADA",
    userId: args.userId,
    audit: args.audit,
    metadata: {
      metodo: "PRESENCIAL_DESENHADA",
      assinaturaHash: signatureHash,
      assinaturaVinculoHash: linkHash,
    },
  });
  return loadChecklistDocumento(args.publicId, { checkCurrentContent: false });
}
