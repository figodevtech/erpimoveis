import { timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  CHECKLIST_DECLARACAO,
  CHECKLIST_QUALIDADE_LABEL,
  documentoFiscalValido,
  onlyDigits,
  type ChecklistConviteAssinaturaResumo,
  type ChecklistConviteStatus,
  type ChecklistSignatarioQualidade,
  type ChecklistSnapshotV1,
} from "./checklist-documento";
import { sha256, stableJson } from "./checklist-documento-hash";
import { preserveChecklistSignature } from "./checklist-documento-assinatura-server";
import { ensureChecklistOfficialPdf } from "./checklist-documento-pdf";
import {
  ChecklistDocumentoError,
  downloadChecklistAsset,
  loadChecklistDocumento,
  registerChecklistDocumentoEvent,
  type ChecklistDocumentoCompleto,
} from "./checklist-documentos-server";
import {
  checklistAssetKey,
  checklistInvitationStatus,
  checklistInvitationPasswordValid,
  checklistSigningPublicUrl,
  cpfInvitationHmac,
  createChecklistInvitationToken,
  createChecklistSigningSession,
  decryptInvitationCpf,
  encryptInvitationCpf,
  hashChecklistInvitationPassword,
  verifyChecklistInvitationPassword,
  verifyChecklistInvitationToken,
  verifyChecklistSigningSession,
} from "./checklist-signing-security";

export const CHECKLIST_SIGNING_SESSION_COOKIE = "checklist_signing_session";
export const CHECKLIST_SIGNING_SESSION_SECONDS = 60 * 60;

const INVITATION_DURATIONS = new Set([24, 48, 72, 24 * 7]);
const QUALITIES = new Set<ChecklistSignatarioQualidade>([
  "CLIENTE",
  "PROPRIETARIO",
  "RECEBEDOR",
  "OUTRO",
]);

type Audit = { ip: string | null; userAgent: string | null };

type InvitationRow = {
  id: number;
  public_id: string;
  documento_id: number;
  cpf_hmac: string;
  cpf_cifrado: string;
  senha_hash: string;
  senha_salt: string;
  senha_parametros: unknown;
  expira_em: string;
  criado_em: string;
  revogado_em: string | null;
  motivo_revogacao: string | null;
  consumido_em: string | null;
  ultimo_acesso_em: string | null;
};

type ResolvedInvitation = {
  row: InvitationRow;
  document: ChecklistDocumentoCompleto;
  status: ChecklistConviteStatus;
  token: string;
};

function equalText(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function invitationStatus(row: InvitationRow, document: ChecklistDocumentoCompleto): ChecklistConviteStatus {
  return checklistInvitationStatus({
    consumedAt: row.consumido_em,
    revokedAt: row.revogado_em,
    revocationReason: row.motivo_revogacao,
    expiresAt: row.expira_em,
    hasNewerVersion: !document.maisRecente,
    documentSigned: Boolean(document.assinatura),
  });
}

function buildInvitationSummary(
  row: InvitationRow,
  document: ChecklistDocumentoCompleto,
  origin?: string,
): ChecklistConviteAssinaturaResumo {
  const status = invitationStatus(row, document);
  const token = createChecklistInvitationToken({
    invitationPublicId: row.public_id,
    documentPublicId: document.publicId,
    expiresAt: row.expira_em,
  });
  return {
    publicId: row.public_id,
    status,
    criadoEm: row.criado_em,
    expiraEm: row.expira_em,
    ultimoAcessoEm: row.ultimo_acesso_em,
    revogadoEm: row.revogado_em,
    consumidoEm: row.consumido_em,
    motivoRevogacao: row.motivo_revogacao,
    url: origin && status === "ATIVO" ? checklistSigningPublicUrl(origin, token) : null,
  };
}

async function latestInvitationForDocument(documentId: number) {
  const result = await supabaseAdmin
    .from("checklist_documento_convite_assinatura")
    .select("*")
    .eq("documento_id", documentId)
    .order("criado_em", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as InvitationRow | null;
}

function publicOrigin(requestOrigin: string) {
  for (const candidate of [requestOrigin, process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL, process.env.NEXTAUTH_URL]) {
    if (!candidate) continue;
    try { return new URL(candidate).origin; } catch { /* tenta o próximo */ }
  }
  throw new Error("A URL pública da aplicação não foi configurada.");
}

export async function getChecklistSigningInvitation(publicId: string, requestOrigin: string) {
  const document = await loadChecklistDocumento(publicId, { checkCurrentContent: false });
  const row = await latestInvitationForDocument(document.id);
  return row ? buildInvitationSummary(row, document, publicOrigin(requestOrigin)) : null;
}

export async function createChecklistSigningInvitation(args: {
  documentPublicId: string;
  cpf: unknown;
  password: unknown;
  passwordConfirmation: unknown;
  durationHours: unknown;
  userId: string;
  audit: Audit;
  requestOrigin: string;
}) {
  const cpf = onlyDigits(args.cpf);
  if (cpf.length !== 11 || !documentoFiscalValido(cpf)) {
    throw new ChecklistDocumentoError("Informe um CPF válido do responsável.", 400, "CPF_INVALIDO");
  }
  const password = String(args.password ?? "");
  if (!checklistInvitationPasswordValid(password)) {
    throw new ChecklistDocumentoError("A senha deve conter somente 4 a 8 números.", 400, "SENHA_INVALIDA");
  }
  if (password !== String(args.passwordConfirmation ?? "")) {
    throw new ChecklistDocumentoError("A confirmação da senha não confere.", 400, "SENHA_DIVERGENTE");
  }
  const durationHours = Number(args.durationHours);
  if (!INVITATION_DURATIONS.has(durationHours)) {
    throw new ChecklistDocumentoError("Selecione uma validade permitida para o convite.", 400, "VALIDADE_INVALIDA");
  }

  const passwordData = await hashChecklistInvitationPassword(password);
  const invitationPublicId = randomUUID();
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1_000).toISOString();
  const result = await supabaseAdmin.rpc("criar_convite_assinatura_checklist", {
    p_documento_public_id: args.documentPublicId,
    p_convite_public_id: invitationPublicId,
    p_cpf_hmac: cpfInvitationHmac(cpf),
    p_cpf_cifrado: encryptInvitationCpf(cpf),
    p_senha_hash: passwordData.hash,
    p_senha_salt: passwordData.salt,
    p_senha_parametros: passwordData.parameters,
    p_expira_em: expiresAt,
    p_criado_por: args.userId,
    p_request_ip: args.audit.ip,
    p_user_agent: args.audit.userAgent,
  });
  if (result.error) {
    const conflict = result.error.code === "55000" || result.error.code === "23505";
    throw new ChecklistDocumentoError(
      conflict ? result.error.message : "Não foi possível criar o convite de assinatura.",
      conflict ? 409 : 500,
      conflict ? "CONVITE_CONFLITO" : "CONVITE_FALHOU",
    );
  }
  const document = await loadChecklistDocumento(args.documentPublicId, { checkCurrentContent: false });
  const row = await latestInvitationForDocument(document.id);
  if (!row || row.public_id !== invitationPublicId) throw new Error("O convite criado não pôde ser confirmado.");
  return buildInvitationSummary(row, document, publicOrigin(args.requestOrigin));
}

export async function revokeChecklistSigningInvitation(args: {
  documentPublicId: string;
  userId: string;
  audit: Audit;
}) {
  const result = await supabaseAdmin.rpc("revogar_convite_assinatura_checklist", {
    p_documento_public_id: args.documentPublicId,
    p_revogado_por: args.userId,
    p_request_ip: args.audit.ip,
    p_user_agent: args.audit.userAgent,
  });
  if (result.error) throw result.error;
  return Boolean(result.data);
}

export async function resolveChecklistSigningInvitation(token: string): Promise<ResolvedInvitation | null> {
  const payload = verifyChecklistInvitationToken(token);
  if (!payload) return null;
  const result = await supabaseAdmin
    .from("checklist_documento_convite_assinatura")
    .select("*")
    .eq("public_id", payload.i)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const row = result.data as InvitationRow;
  const document = await loadChecklistDocumento(payload.d, { checkCurrentContent: false });
  if (
    row.documento_id !== document.id ||
    Math.floor(new Date(row.expira_em).getTime() / 1_000) !== payload.e
  ) return null;
  return { row, document, status: invitationStatus(row, document), token };
}

export async function authenticateChecklistSigningInvitation(args: {
  invitation: ResolvedInvitation;
  cpf: unknown;
  password: unknown;
  audit: Audit;
}) {
  if (args.invitation.status !== "ATIVO") return null;
  const cpf = onlyDigits(args.cpf);
  const suppliedCpfHmac = cpfInvitationHmac(cpf);
  const passwordMatches = await verifyChecklistInvitationPassword({
    password: String(args.password ?? ""),
    hash: args.invitation.row.senha_hash,
    salt: args.invitation.row.senha_salt,
    parameters: args.invitation.row.senha_parametros,
  });
  if (
    cpf.length !== 11 || !documentoFiscalValido(cpf) ||
    !equalText(suppliedCpfHmac, args.invitation.row.cpf_hmac) || !passwordMatches
  ) return null;

  const accessedAt = new Date().toISOString();
  const update = await supabaseAdmin
    .from("checklist_documento_convite_assinatura")
    .update({ ultimo_acesso_em: accessedAt })
    .eq("id", args.invitation.row.id)
    .is("revogado_em", null)
    .is("consumido_em", null)
    .gt("expira_em", accessedAt)
    .select("id")
    .maybeSingle();
  if (update.error) throw update.error;
  if (!update.data) return null;
  await registerChecklistDocumentoEvent({
    documentoId: args.invitation.document.id,
    tipo: "CONVITE_ASSINATURA_ACESSO_AUTENTICADO",
    audit: args.audit,
    metadata: { convitePublicId: args.invitation.row.public_id, autenticacao: "LINK_CPF_SENHA" },
  });
  return createChecklistSigningSession({
    invitationPublicId: args.invitation.row.public_id,
    documentPublicId: args.invitation.document.publicId,
    cpfHmac: args.invitation.row.cpf_hmac,
    durationSeconds: CHECKLIST_SIGNING_SESSION_SECONDS,
  });
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function hasChecklistSigningSession(request: Request, invitation: ResolvedInvitation) {
  const value = cookieValue(request, CHECKLIST_SIGNING_SESSION_COOKIE);
  const session = value ? verifyChecklistSigningSession(value) : null;
  return Boolean(
    session && session.i === invitation.row.public_id &&
    session.d === invitation.document.publicId &&
    equalText(session.c, invitation.row.cpf_hmac),
  );
}

type PublicAsset = {
  key: string;
  sha256: string;
  mimeType: string;
  tamanhoBytes: number;
  descricao: string | null;
  registradoEm: string | null;
};

function publicAsset(invitationPublicId: string, asset: ChecklistSnapshotV1["empresa"]["logo"]): PublicAsset | null {
  if (!asset) return null;
  return {
    key: checklistAssetKey(invitationPublicId, asset.storagePath),
    sha256: asset.sha256,
    mimeType: asset.mimeType,
    tamanhoBytes: asset.tamanhoBytes,
    descricao: asset.descricao,
    registradoEm: asset.registradoEm,
  };
}

export function buildChecklistSigningPublicContent(invitation: ResolvedInvitation) {
  const snapshot = invitation.document.snapshot;
  return {
    documento: {
      codigo: snapshot.documento.codigo,
      tipo: snapshot.documento.tipo,
      versao: snapshot.documento.versao,
      criadoEm: snapshot.documento.criadoEm,
      snapshotHash: invitation.document.snapshotHash,
      conteudoHash: invitation.document.conteudoHash,
    },
    empresa: {
      nome: snapshot.empresa.nome,
      campos: snapshot.empresa.campos,
      cores: snapshot.empresa.cores,
      logo: publicAsset(invitation.row.public_id, snapshot.empresa.logo),
    },
    ordemServico: {
      numero: snapshot.ordemServico.id,
      campos: snapshot.ordemServico.campos,
      cliente: snapshot.ordemServico.cliente,
      objeto: snapshot.ordemServico.objeto,
    },
    checklist: {
      modelo: snapshot.checklist.modelo,
      descricaoModelo: snapshot.checklist.descricaoModelo,
      inspecionadoEm: snapshot.checklist.inspecionadoEm,
      responsaveis: snapshot.checklist.responsaveis,
      retiradoPor: snapshot.checklist.retiradoPor,
      observacaoDocumento: snapshot.checklist.observacaoDocumento,
      itens: snapshot.checklist.itens.map((item) => ({
        titulo: item.titulo,
        descricao: item.descricao,
        categoria: item.categoria,
        ordem: item.ordem,
        resposta: item.resposta,
        observacao: item.observacao,
        registradoEm: item.registradoEm,
        responsavel: item.responsavel,
        fotos: item.fotos.map((asset) => publicAsset(invitation.row.public_id, asset)),
      })),
    },
    declaracao: snapshot.declaracao,
    assinatura: invitation.document.assinatura ? {
      nome: invitation.document.assinatura.signatarioNome,
      qualidade: invitation.document.assinatura.qualidadeOutro ||
        CHECKLIST_QUALIDADE_LABEL[invitation.document.assinatura.signatarioQualidade as ChecklistSignatarioQualidade],
      metodo: invitation.document.assinatura.metodo,
      assinadoEm: invitation.document.assinatura.assinadoEm,
    } : null,
  };
}

function signingAssetCandidates(document: ChecklistDocumentoCompleto) {
  return [
    ...(document.snapshot.empresa.logo ? [document.snapshot.empresa.logo] : []),
    ...document.snapshot.checklist.itens.flatMap((item) => item.fotos),
  ];
}

export async function loadChecklistSigningAsset(invitation: ResolvedInvitation, key: string) {
  const asset = signingAssetCandidates(invitation.document).find((candidate) =>
    equalText(checklistAssetKey(invitation.row.public_id, candidate.storagePath), key),
  );
  if (!asset) throw new ChecklistDocumentoError("Ativo não encontrado.", 404, "ATIVO_NAO_ENCONTRADO");
  const bytes = await downloadChecklistAsset(asset.storagePath);
  if (sha256(bytes) !== asset.sha256) {
    throw new ChecklistDocumentoError("O ativo falhou na verificação de integridade.", 409, "ATIVO_INVALIDO");
  }
  return { bytes, mimeType: asset.mimeType };
}

function validateRemoteSigner(args: {
  nome: unknown;
  qualidade: unknown;
  qualidadeOutro: unknown;
  declaracaoCiente: unknown;
}) {
  const nome = String(args.nome ?? "").trim().replace(/\s+/g, " ");
  if (nome.length < 3 || nome.length > 160) {
    throw new ChecklistDocumentoError("Informe o nome completo do responsável.", 400, "NOME_INVALIDO");
  }
  const qualidade = String(args.qualidade ?? "").toUpperCase() as ChecklistSignatarioQualidade;
  if (!QUALITIES.has(qualidade)) {
    throw new ChecklistDocumentoError("Selecione a função do signatário.", 400, "QUALIDADE_INVALIDA");
  }
  const qualidadeOutro = String(args.qualidadeOutro ?? "").trim();
  if (qualidade === "OUTRO" && (qualidadeOutro.length < 2 || qualidadeOutro.length > 80)) {
    throw new ChecklistDocumentoError("Descreva a função do signatário.", 400, "QUALIDADE_INVALIDA");
  }
  if (args.declaracaoCiente !== true) {
    throw new ChecklistDocumentoError("Confirme a ciência do conteúdo do checklist.", 400, "CIENCIA_NAO_CONFIRMADA");
  }
  return { nome, qualidade, qualidadeOutro: qualidade === "OUTRO" ? qualidadeOutro : null };
}

export async function signChecklistRemotely(args: {
  invitation: ResolvedInvitation;
  nome: unknown;
  qualidade: unknown;
  qualidadeOutro: unknown;
  declaracaoCiente: unknown;
  assinaturaDataUrl: unknown;
  audit: Audit;
}) {
  if (args.invitation.status !== "ATIVO") {
    throw new ChecklistDocumentoError("Este convite não está mais disponível.", 409, "CONVITE_INDISPONIVEL");
  }
  const signer = validateRemoteSigner(args);
  const cpf = decryptInvitationCpf(args.invitation.row.cpf_cifrado);
  if (!equalText(cpfInvitationHmac(cpf), args.invitation.row.cpf_hmac)) {
    throw new ChecklistDocumentoError("A identificação protegida do convite é inválida.", 409, "CONVITE_INVALIDO");
  }
  const signature = await preserveChecklistSignature(args.assinaturaDataUrl);
  const declarationHash = sha256(CHECKLIST_DECLARACAO);
  const linkHash = sha256(stableJson({
    snapshotHash: args.invitation.document.snapshotHash,
    signatureHash: signature.hash,
    signatarioDocumento: cpf,
    signatarioNome: signer.nome,
    signatarioQualidade: signer.qualidade,
    qualidadeOutro: signer.qualidadeOutro,
    declaracaoHash: declarationHash,
    metodo: "REMOTA_DESENHADA",
    convitePublicId: args.invitation.row.public_id,
  }));
  const result = await supabaseAdmin.rpc("assinar_checklist_remotamente", {
    p_convite_public_id: args.invitation.row.public_id,
    p_snapshot_hash: args.invitation.document.snapshotHash,
    p_signatario_nome: signer.nome,
    p_signatario_documento: cpf,
    p_signatario_qualidade: signer.qualidade,
    p_qualidade_outro: signer.qualidadeOutro,
    p_declaracao: CHECKLIST_DECLARACAO,
    p_declaracao_hash: declarationHash,
    p_assinatura_path: signature.path,
    p_assinatura_hash: signature.hash,
    p_assinatura_vinculo_hash: linkHash,
    p_request_ip: args.audit.ip,
    p_user_agent: args.audit.userAgent,
  });
  if (result.error) {
    const conflict = ["23505", "55000", "P0002"].includes(result.error.code);
    throw new ChecklistDocumentoError(
      conflict ? "Este convite não está mais disponível ou a versão já foi assinada." : "Não foi possível registrar a assinatura.",
      conflict ? 409 : 500,
      conflict ? "ASSINATURA_CONFLITO" : "ASSINATURA_FALHOU",
    );
  }

  const signed = await loadChecklistDocumento(args.invitation.document.publicId, { checkCurrentContent: false });
  try {
    const document = await ensureChecklistOfficialPdf({
      publicId: signed.publicId,
      userId: null,
      audit: args.audit,
    });
    return { document, pdfPendente: false };
  } catch {
    return { document: signed, pdfPendente: true };
  }
}

export function checklistSigningVerificationUrl(document: ChecklistDocumentoCompleto, origin: string) {
  return `${origin.replace(/\/$/, "")}/verificar/checklist/${document.tokenVerificacao}`;
}

export type { ResolvedInvitation };
