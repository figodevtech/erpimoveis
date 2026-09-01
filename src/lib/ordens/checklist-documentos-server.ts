import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { fetchLogoEmpresaDataUrl } from "@/lib/empresa-logo";
import { fetchPrintColors } from "@/lib/print-config";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveOrdemCustomer } from "./customer-snapshot";
import { buildChecklistObjectSnapshot } from "./checklist-snapshot";
import {
  CHECKLIST_DECLARACAO,
  checklistPublicIdValido,
  statusChecklistDocumento,
  type ChecklistCampo,
  type ChecklistDocumentoMudancas,
  type ChecklistDocumentoResumo,
  type ChecklistSnapshotAsset,
  type ChecklistSnapshotItem,
  type ChecklistSnapshotV1,
  type ChecklistTipo,
} from "./checklist-documento";
import {
  conteudoHash,
  resumirMudancas,
  sha256,
  snapshotHash,
  stableJson,
} from "./checklist-documento-hash";

export const CHECKLIST_DOCUMENTOS_BUCKET = "checklist_documentos";

type RequestAudit = {
  ip: string | null;
  userAgent: string | null;
};

type LiveSource = {
  os: any;
  empresa: any;
  modelo: any;
  checklist: any[];
  saida: any | null;
  usuarios: Map<string, string>;
  cores: { primary: string; secondary: string; text: string };
  logoSource: string | null;
};

export type ChecklistDocumentoCompleto = {
  id: number;
  publicId: string;
  codigo: string;
  tokenVerificacao: string;
  ordemServicoId: number;
  tipo: ChecklistTipo;
  versao: number;
  snapshot: ChecklistSnapshotV1;
  snapshotHash: string;
  conteudoHash: string;
  sourceFingerprint: string;
  criadoEm: string;
  criadoPor: string | null;
  maisRecente: boolean;
  conteudoAtualDivergente: boolean;
  assinatura: {
    id: number;
    signatarioNome: string;
    signatarioDocumento: string;
    signatarioQualidade: string;
    qualidadeOutro: string | null;
    declaracao: string;
    metodo: "PRESENCIAL_DESENHADA";
    assinaturaPath: string;
    assinaturaHash: string;
    assinaturaVinculoHash: string;
    operadorNome: string | null;
    assinadoEm: string;
  } | null;
  arquivo: {
    storagePath: string;
    pdfHash: string;
    tamanhoBytes: number;
    geradorVersao: string;
    criadoEm: string;
  } | null;
};

export class ChecklistDocumentoError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = "CHECKLIST_DOCUMENTO_INVALIDO") {
    super(message);
    this.name = "ChecklistDocumentoError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function field(rotulo: string, value: unknown): ChecklistCampo | null {
  const valor = text(value);
  return valor ? { rotulo, valor } : null;
}

function fields(...values: Array<ChecklistCampo | null>) {
  return values.filter((value): value is ChecklistCampo => Boolean(value));
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function asIso(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatAddress(record: any) {
  return [record?.endereco, record?.numero, record?.complemento, record?.bairro, record?.cidade, record?.uf, record?.cep]
    .map(text)
    .filter(Boolean)
    .join(", ");
}

function parseDataUrl(source: string) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(source);
  if (!match) return null;
  const bytes = match[2]
    ? Buffer.from(match[3], "base64")
    : Buffer.from(decodeURIComponent(match[3]), "utf8");
  return { bytes, mimeType: match[1] || "application/octet-stream" };
}

async function downloadImage(source: string) {
  const inline = parseDataUrl(source);
  if (inline) return inline;

  const response = await fetch(source, { cache: "no-store" });
  if (!response.ok) {
    throw new ChecklistDocumentoError(
      `Não foi possível preservar a imagem (${response.status}).`,
      409,
      "FOTO_INDISPONIVEL",
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    throw new ChecklistDocumentoError("Uma imagem do checklist está vazia.", 409, "FOTO_INDISPONIVEL");
  }
  return { bytes, mimeType: response.headers.get("content-type") || "application/octet-stream" };
}

async function normalizeImage(source: string, kind: "logo" | "foto") {
  const downloaded = await downloadImage(source);
  try {
    const pipeline = sharp(downloaded.bytes, { failOn: "error", limitInputPixels: 100_000_000 })
      .rotate()
      .resize({
        width: kind === "logo" ? 1600 : 2400,
        height: kind === "logo" ? 1000 : 2400,
        fit: "inside",
        withoutEnlargement: true,
      });
    if (kind === "logo") {
      return { bytes: await pipeline.png({ compressionLevel: 9 }).toBuffer(), mimeType: "image/png", extension: "png" };
    }
    return {
      bytes: await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer(),
      mimeType: "image/jpeg",
      extension: "jpg",
    };
  } catch (error) {
    throw new ChecklistDocumentoError(
      `Não foi possível normalizar uma imagem do checklist: ${error instanceof Error ? error.message : "formato inválido"}.`,
      409,
      "FOTO_INDISPONIVEL",
    );
  }
}

async function ensureBucket() {
  const storage = supabaseAdmin.storage as any;
  const current = await storage.getBucket(CHECKLIST_DOCUMENTOS_BUCKET);
  if (current.error) {
    const created = await storage.createBucket(CHECKLIST_DOCUMENTOS_BUCKET, {
      public: false,
      fileSizeLimit: 52_428_800,
      allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
    });
    if (created.error && !/already exists|duplicate/i.test(String(created.error.message ?? ""))) {
      throw created.error;
    }
    return;
  }
  if (current.data?.public === true) {
    const updated = await storage.updateBucket(CHECKLIST_DOCUMENTOS_BUCKET, { public: false });
    if (updated.error) throw updated.error;
  }
}

async function preserveAsset(args: {
  source: string;
  kind: "logo" | "foto";
  origemId: string;
  descricao?: string | null;
  registradoEm?: string | null;
  persist: boolean;
}): Promise<ChecklistSnapshotAsset> {
  const normalized = await normalizeImage(args.source, args.kind);
  const hash = sha256(normalized.bytes);
  const storagePath = `assets/${args.kind === "logo" ? "logos" : "fotos"}/${hash}.${normalized.extension}`;

  if (args.persist) {
    const upload = await supabaseAdmin.storage
      .from(CHECKLIST_DOCUMENTOS_BUCKET)
      .upload(storagePath, normalized.bytes, {
        contentType: normalized.mimeType,
        cacheControl: "31536000",
        upsert: false,
      });
    if (upload.error) {
      const duplicate = /already exists|duplicate|resource exists/i.test(String(upload.error.message ?? ""));
      if (!duplicate) throw upload.error;
      const existing = await supabaseAdmin.storage.from(CHECKLIST_DOCUMENTOS_BUCKET).download(storagePath);
      if (existing.error || !existing.data) throw existing.error ?? new Error("Ativo preservado não pôde ser validado.");
      const existingHash = sha256(Buffer.from(await existing.data.arrayBuffer()));
      if (existingHash !== hash) throw new Error("Colisão de hash ao preservar imagem do checklist.");
    }
  }

  return {
    origemId: args.origemId,
    storagePath,
    sha256: hash,
    mimeType: normalized.mimeType,
    tamanhoBytes: normalized.bytes.byteLength,
    descricao: text(args.descricao),
    registradoEm: asIso(args.registradoEm),
  };
}

async function loadLiveSource(ordemServicoId: number, tipo: ChecklistTipo): Promise<LiveSource> {
  const osResult = await supabaseAdmin
    .from("ordemservico")
    .select("*, cliente:clienteid(*), veiculo:veiculoid(*), peca:pecaid(*), setor:setorid(id,nome)")
    .eq("id", ordemServicoId)
    .maybeSingle();
  if (osResult.error) throw osResult.error;
  if (!osResult.data) throw new ChecklistDocumentoError("Ordem de serviço não encontrada.", 404, "OS_NAO_ENCONTRADA");
  const os = osResult.data as any;

  const [empresaResult, cores, logoSource] = await Promise.all([
    supabaseAdmin.from("empresa").select("*").order("id", { ascending: true }).limit(1).maybeSingle(),
    fetchPrintColors(),
    fetchLogoEmpresaDataUrl(),
  ]);
  if (empresaResult.error) throw empresaResult.error;

  let checklist: any[] = [];
  let saida: any | null = null;
  let modeloId = os.checklist_modelo_id ?? null;
  if (tipo === "ENTRADA") {
    const items = await supabaseAdmin
      .from("checklist")
      .select("id,item,status,observacao,createdat,created_by")
      .eq("ordemservicoid", ordemServicoId)
      .order("id", { ascending: true });
    if (items.error) throw items.error;
    checklist = items.data ?? [];
    if (checklist.length) {
      const images = await supabaseAdmin
        .from("imagemvistoria")
        .select("id,checklistid,url,descricao,createdat")
        .in("checklistid", checklist.map((item) => item.id))
        .order("id", { ascending: true });
      if (images.error) throw images.error;
      const byItem = new Map<number, any[]>();
      for (const image of images.data ?? []) {
        const group = byItem.get(Number(image.checklistid)) ?? [];
        group.push(image);
        byItem.set(Number(image.checklistid), group);
      }
      checklist = checklist.map((item) => ({ ...item, imagens: byItem.get(Number(item.id)) ?? [] }));
    }
  } else {
    const exit = await supabaseAdmin.from("os_saida").select("*").eq("ordemservico_id", ordemServicoId).maybeSingle();
    if (exit.error) throw exit.error;
    saida = exit.data ?? null;
    modeloId = saida?.checklist_modelo_id ?? null;
    if (saida) {
      const items = await supabaseAdmin
        .from("os_saida_checklist_item")
        .select("id,modelo_item_id,titulo,descricao,categoria,status,observacao,ordem,created_by,created_at")
        .eq("os_saida_id", saida.id)
        .order("ordem", { ascending: true })
        .order("id", { ascending: true });
      if (items.error) throw items.error;
      checklist = items.data ?? [];
      if (checklist.length) {
        const images = await supabaseAdmin
          .from("os_saida_checklist_imagem")
          .select("id,checklist_item_id,url,descricao,created_at")
          .in("checklist_item_id", checklist.map((item) => item.id))
          .order("id", { ascending: true });
        if (images.error) throw images.error;
        const byItem = new Map<number, any[]>();
        for (const image of images.data ?? []) {
          const group = byItem.get(Number(image.checklist_item_id)) ?? [];
          group.push(image);
          byItem.set(Number(image.checklist_item_id), group);
        }
        checklist = checklist.map((item) => ({ ...item, imagens: byItem.get(Number(item.id)) ?? [] }));
      }
    }
  }

  if (!checklist.length) {
    throw new ChecklistDocumentoError(
      `O checklist de ${tipo === "ENTRADA" ? "entrada" : "saída"} não possui itens preenchidos.`,
      409,
      "CHECKLIST_VAZIO",
    );
  }

  let modelo: any | null = null;
  if (modeloId) {
    const modelResult = await supabaseAdmin.from("checklist_modelo").select("*").eq("id", modeloId).maybeSingle();
    if (modelResult.error) throw modelResult.error;
    modelo = modelResult.data ?? null;
    if (tipo === "ENTRADA" && modelo) {
      const modelItems = await supabaseAdmin
        .from("checklist_modelo_item")
        .select("id,titulo,descricao,categoria,ordem")
        .eq("modelo_id", modelo.id)
        .order("ordem", { ascending: true });
      if (modelItems.error) throw modelItems.error;
      const byTitle = new Map((modelItems.data ?? []).map((item) => [String(item.titulo).trim(), item]));
      checklist = checklist.map((item, index) => ({
        ...item,
        modeloItem: byTitle.get(String(item.item ?? "").trim()) ?? null,
        ordem: byTitle.get(String(item.item ?? "").trim())?.ordem ?? index,
      }));
      checklist.sort((a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0) || Number(a.id) - Number(b.id));
    }
  }

  const userIds = new Set<string>();
  for (const item of checklist) if (item.created_by) userIds.add(String(item.created_by));
  if (saida?.registrado_por) userIds.add(String(saida.registrado_por));
  const usuarios = new Map<string, string>();
  if (userIds.size) {
    const users = await supabaseAdmin.from("usuario").select("id,nome").in("id", Array.from(userIds));
    if (users.error) throw users.error;
    for (const user of users.data ?? []) usuarios.set(String(user.id), text(user.nome) ?? "Usuário");
  }

  return {
    os,
    empresa: empresaResult.data ?? null,
    modelo,
    checklist,
    saida,
    usuarios,
    cores,
    logoSource,
  };
}

async function buildSnapshot(args: {
  ordemServicoId: number;
  tipo: ChecklistTipo;
  publicId: string;
  codigo: string;
  versao: number;
  criadoEm: string;
  persistAssets: boolean;
}) {
  const source = await loadLiveSource(args.ordemServicoId, args.tipo);
  if (args.persistAssets) await ensureBucket();

  const company = source.empresa;
  const logo = source.logoSource
    ? await preserveAsset({
        source: source.logoSource,
        kind: "logo",
        origemId: `empresa:${company?.id ?? "atual"}`,
        descricao: "Logomarca da empresa",
        persist: args.persistAssets,
      })
    : null;

  const snapshotItems: ChecklistSnapshotItem[] = [];
  for (let itemIndex = 0; itemIndex < source.checklist.length; itemIndex += 1) {
    const item = source.checklist[itemIndex];
    const photos: ChecklistSnapshotAsset[] = [];
    for (const image of item.imagens ?? []) {
      if (!text(image.url)) {
        throw new ChecklistDocumentoError("Uma fotografia do checklist não possui origem.", 409, "FOTO_INDISPONIVEL");
      }
      photos.push(await preserveAsset({
        source: String(image.url),
        kind: "foto",
        origemId: String(image.id),
        descricao: image.descricao,
        registradoEm: image.createdat ?? image.created_at,
        persist: args.persistAssets,
      }));
    }
    const creatorId = text(item.created_by);
    snapshotItems.push({
      origemId: String(item.id),
      titulo: text(item.item ?? item.titulo) ?? `Item ${itemIndex + 1}`,
      descricao: text(item.descricao ?? item.modeloItem?.descricao),
      categoria: text(item.categoria ?? item.modeloItem?.categoria),
      ordem: Number.isFinite(Number(item.ordem)) ? Number(item.ordem) : itemIndex,
      resposta: text(item.status) ?? "Não informado",
      observacao: text(item.observacao),
      registradoEm: asIso(item.createdat ?? item.created_at),
      responsavel: creatorId ? source.usuarios.get(creatorId) ?? null : null,
      fotos: photos,
    });
  }

  const os = source.os;
  const customer = resolveOrdemCustomer(first<any>(os.cliente), os.cliente_snapshot) as any;
  const responsaveis = Array.from(new Set([
    ...snapshotItems.map((item) => item.responsavel).filter((value): value is string => Boolean(value)),
    ...(source.saida?.registrado_por ? [source.usuarios.get(String(source.saida.registrado_por))] : []),
  ].filter((value): value is string => Boolean(value))));
  const address = customer ? [customer.endereco, customer.endereconumero, customer.enderecocomplemento, customer.bairro, customer.cidade, customer.estado, customer.cep].map(text).filter(Boolean).join(", ") : null;

  const snapshot: ChecklistSnapshotV1 = {
    schemaVersion: 1,
    documento: {
      publicId: args.publicId,
      codigo: args.codigo,
      tipo: args.tipo,
      versao: args.versao,
      criadoEm: args.criadoEm,
    },
    empresa: {
      nome: text(company?.nomefantasia ?? company?.razaosocial) ?? "Empresa",
      campos: fields(
        field("Razão social", company?.razaosocial),
        field("CNPJ", company?.cnpj),
        field("Inscrição estadual", company?.inscricaoestadual),
        field("Endereço", formatAddress(company)),
        field("Telefone", company?.telefone),
      ),
      logo,
      cores: {
        primaria: source.cores.primary,
        secundaria: source.cores.secondary,
        texto: source.cores.text,
      },
    },
    ordemServico: {
      id: Number(os.id),
      campos: fields(
        field("OS", `#${os.id}`),
        field("Status", os.status),
        field("Entrada", asIso(os.dataentrada)),
        field("Saída", asIso(os.datasaida)),
        field("Setor", first<any>(os.setor)?.nome),
        field("Descrição", os.descricao),
        field("Observações", os.observacoes),
      ),
      cliente: fields(
        field("Cliente", customer?.nome ?? customer?.nomerazaosocial),
        field("CPF/CNPJ", customer?.cpfcnpj ?? customer?.documento),
        field("Telefone", customer?.telefone),
        field("E-mail", customer?.email),
        field("Endereço", address),
      ),
      objeto: buildChecklistObjectSnapshot(os),
    },
    checklist: {
      modelo: text(source.modelo?.nome),
      descricaoModelo: text(source.modelo?.descricao),
      inspecionadoEm: args.tipo === "SAIDA"
        ? asIso(source.saida?.saida_em ?? source.saida?.created_at)
        : snapshotItems.map((item) => item.registradoEm).filter(Boolean).sort().at(-1) ?? null,
      responsaveis,
      retiradoPor: args.tipo === "SAIDA" ? text(source.saida?.retirado_por) : null,
      observacaoDocumento: args.tipo === "SAIDA" ? text(source.saida?.documento_observacao) : null,
      itens: snapshotItems,
    },
    declaracao: CHECKLIST_DECLARACAO,
  };

  const fingerprintPayload = {
    ordemServicoId: args.ordemServicoId,
    tipo: args.tipo,
    conteudo: conteudoHash(snapshot),
    origens: snapshotItems.map((item) => ({
      id: item.origemId,
      registradoEm: item.registradoEm,
      fotos: item.fotos.map((photo) => ({ id: photo.origemId, sha256: photo.sha256 })),
    })),
  };

  return { snapshot, sourceFingerprint: sha256(stableJson(fingerprintPayload)) };
}

function documentCode(ordemServicoId: number, tipo: ChecklistTipo, versao: number) {
  return `CHK-${tipo === "ENTRADA" ? "E" : "S"}-OS${String(ordemServicoId).padStart(8, "0")}-V${String(versao).padStart(4, "0")}`;
}

export async function createChecklistDocumento(args: {
  ordemServicoId: number;
  tipo: ChecklistTipo;
  userId: string;
  audit: RequestAudit;
}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latestResult = await supabaseAdmin
      .from("checklist_documento")
      .select("id,versao,snapshot,conteudo_hash")
      .eq("ordemservico_id", args.ordemServicoId)
      .eq("tipo", args.tipo)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestResult.error) throw latestResult.error;
    const latest = latestResult.data as any | null;
    const versao = Number(latest?.versao ?? 0) + 1;
    const publicId = randomUUID();
    const criadoEm = new Date().toISOString();
    const codigo = documentCode(args.ordemServicoId, args.tipo, versao);
    const built = await buildSnapshot({
      ordemServicoId: args.ordemServicoId,
      tipo: args.tipo,
      publicId,
      codigo,
      versao,
      criadoEm,
      persistAssets: true,
    });
    const exactHash = snapshotHash(built.snapshot);
    const semanticHash = conteudoHash(built.snapshot);
    const changes = resumirMudancas(built.snapshot, (latest?.snapshot as ChecklistSnapshotV1 | null) ?? null);
    const insert = await supabaseAdmin
      .from("checklist_documento")
      .insert({
        public_id: publicId,
        codigo,
        ordemservico_id: args.ordemServicoId,
        tipo: args.tipo,
        versao,
        versao_anterior_id: latest?.id ?? null,
        schema_version: 1,
        snapshot: built.snapshot,
        snapshot_hash: exactHash,
        conteudo_hash: semanticHash,
        source_fingerprint: built.sourceFingerprint,
        mudancas_resumo: changes,
        criado_por: args.userId,
        criado_em: criadoEm,
      })
      .select("id")
      .single();
    if (insert.error) {
      if (insert.error.code === "23505" && attempt < 3) continue;
      throw insert.error;
    }

    await registerChecklistDocumentoEvent({
      documentoId: Number(insert.data.id),
      tipo: "VERSAO_CRIADA",
      userId: args.userId,
      audit: args.audit,
      metadata: { versao, conteudoIdentico: changes.conteudoIdentico },
    });
    return loadChecklistDocumento(publicId, { checkCurrentContent: false });
  }
  throw new ChecklistDocumentoError("Não foi possível reservar a próxima versão do checklist.", 409, "VERSAO_CONCORRENTE");
}

export async function registerChecklistDocumentoEvent(args: {
  documentoId: number;
  tipo: string;
  userId?: string | null;
  audit?: RequestAudit;
  metadata?: Record<string, unknown>;
}) {
  const result = await supabaseAdmin.from("checklist_documento_evento").insert({
    documento_id: args.documentoId,
    tipo: args.tipo,
    usuario_id: args.userId ?? null,
    request_ip: args.audit?.ip ?? null,
    user_agent: args.audit?.userAgent ?? null,
    metadados: args.metadata ?? {},
  });
  if (result.error) throw result.error;
}

async function loadNames(ids: Array<string | null | undefined>) {
  const valid = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const names = new Map<string, string>();
  if (!valid.length) return names;
  const users = await supabaseAdmin.from("usuario").select("id,nome").in("id", valid);
  if (users.error) throw users.error;
  for (const user of users.data ?? []) names.set(String(user.id), text(user.nome) ?? "Usuário");
  return names;
}

export async function listChecklistDocumentos(args: { ordemServicoId: number; tipo?: ChecklistTipo }) {
  let query = supabaseAdmin
    .from("checklist_documento")
    .select("id,public_id,codigo,ordemservico_id,tipo,versao,criado_em,criado_por,snapshot_hash,conteudo_hash,mudancas_resumo")
    .eq("ordemservico_id", args.ordemServicoId)
    .order("tipo", { ascending: true })
    .order("versao", { ascending: false });
  if (args.tipo) query = query.eq("tipo", args.tipo);
  const documents = await query;
  if (documents.error) throw documents.error;
  const rows = (documents.data ?? []) as any[];
  if (!rows.length) return [] as ChecklistDocumentoResumo[];
  const ids = rows.map((row) => Number(row.id));
  const [signatures, files, names] = await Promise.all([
    supabaseAdmin.from("checklist_documento_assinatura").select("documento_id").in("documento_id", ids),
    supabaseAdmin.from("checklist_documento_arquivo").select("documento_id,pdf_hash").in("documento_id", ids),
    loadNames(rows.map((row) => row.criado_por)),
  ]);
  if (signatures.error) throw signatures.error;
  if (files.error) throw files.error;
  const signed = new Set((signatures.data ?? []).map((row: any) => Number(row.documento_id)));
  const fileByDocument = new Map((files.data ?? []).map((row: any) => [Number(row.documento_id), String(row.pdf_hash)]));
  const latest = new Map<ChecklistTipo, number>();
  for (const row of rows) {
    const type = row.tipo as ChecklistTipo;
    latest.set(type, Math.max(latest.get(type) ?? 0, Number(row.versao)));
  }
  return rows.map((row): ChecklistDocumentoResumo => ({
    publicId: String(row.public_id),
    codigo: String(row.codigo),
    ordemServicoId: Number(row.ordemservico_id),
    tipo: row.tipo as ChecklistTipo,
    versao: Number(row.versao),
    criadoEm: String(row.criado_em),
    criadoPor: row.criado_por ? names.get(String(row.criado_por)) ?? null : null,
    snapshotHash: String(row.snapshot_hash),
    conteudoHash: String(row.conteudo_hash),
    pdfHash: fileByDocument.get(Number(row.id)) ?? null,
    mudancas: row.mudancas_resumo as ChecklistDocumentoMudancas,
    status: statusChecklistDocumento(signed.has(Number(row.id)), fileByDocument.has(Number(row.id))),
    maisRecente: latest.get(row.tipo as ChecklistTipo) === Number(row.versao),
    conteudoAtualDivergente: null,
  }));
}

export async function loadChecklistDocumento(
  publicId: string,
  options: { checkCurrentContent?: boolean } = {},
): Promise<ChecklistDocumentoCompleto> {
  if (!checklistPublicIdValido(publicId)) {
    throw new ChecklistDocumentoError("Versão do checklist não encontrada.", 404, "DOCUMENTO_NAO_ENCONTRADO");
  }
  const documentResult = await supabaseAdmin
    .from("checklist_documento")
    .select("*")
    .eq("public_id", publicId)
    .maybeSingle();
  if (documentResult.error) throw documentResult.error;
  if (!documentResult.data) throw new ChecklistDocumentoError("Versão do checklist não encontrada.", 404, "DOCUMENTO_NAO_ENCONTRADO");
  const row = documentResult.data as any;
  const snapshot = row.snapshot as ChecklistSnapshotV1;
  if (
    snapshotHash(snapshot) !== String(row.snapshot_hash) ||
    conteudoHash(snapshot) !== String(row.conteudo_hash)
  ) {
    throw new ChecklistDocumentoError("O snapshot armazenado falhou na verificação de integridade.", 409, "SNAPSHOT_INVALIDO");
  }

  const [latest, signatureResult, fileResult] = await Promise.all([
    supabaseAdmin
      .from("checklist_documento")
      .select("id,versao")
      .eq("ordemservico_id", row.ordemservico_id)
      .eq("tipo", row.tipo)
      .order("versao", { ascending: false })
      .limit(1)
      .single(),
    supabaseAdmin.from("checklist_documento_assinatura").select("*").eq("documento_id", row.id).maybeSingle(),
    supabaseAdmin.from("checklist_documento_arquivo").select("*").eq("documento_id", row.id).maybeSingle(),
  ]);
  if (latest.error) throw latest.error;
  if (signatureResult.error) throw signatureResult.error;
  if (fileResult.error) throw fileResult.error;
  const signature = signatureResult.data as any | null;
  const file = fileResult.data as any | null;
  const names = await loadNames([row.criado_por, signature?.operador_usuario_id]);

  let diverged = false;
  if (options.checkCurrentContent !== false) {
    try {
      const current = await buildSnapshot({
        ordemServicoId: Number(row.ordemservico_id),
        tipo: row.tipo as ChecklistTipo,
        publicId: String(row.public_id),
        codigo: String(row.codigo),
        versao: Number(row.versao),
        criadoEm: String(row.criado_em),
        persistAssets: false,
      });
      diverged = conteudoHash(current.snapshot) !== String(row.conteudo_hash);
    } catch (error) {
      // A indisponibilidade ou remoção da fonte atual é, por si só, uma
      // divergência. Nunca deve impedir a leitura do snapshot já preservado.
      console.warn("Não foi possível recompor o checklist atual para comparação:", error);
      diverged = true;
    }
  }

  return {
    id: Number(row.id),
    publicId: String(row.public_id),
    codigo: String(row.codigo),
    tokenVerificacao: String(row.token_verificacao),
    ordemServicoId: Number(row.ordemservico_id),
    tipo: row.tipo as ChecklistTipo,
    versao: Number(row.versao),
    snapshot,
    snapshotHash: String(row.snapshot_hash),
    conteudoHash: String(row.conteudo_hash),
    sourceFingerprint: String(row.source_fingerprint),
    criadoEm: String(row.criado_em),
    criadoPor: row.criado_por ? names.get(String(row.criado_por)) ?? null : null,
    maisRecente: Number(latest.data.versao) === Number(row.versao),
    conteudoAtualDivergente: diverged,
    assinatura: signature ? {
      id: Number(signature.id),
      signatarioNome: String(signature.signatario_nome),
      signatarioDocumento: String(signature.signatario_documento),
      signatarioQualidade: String(signature.signatario_qualidade),
      qualidadeOutro: text(signature.qualidade_outro),
      declaracao: String(signature.declaracao),
      metodo: "PRESENCIAL_DESENHADA",
      assinaturaPath: String(signature.assinatura_path),
      assinaturaHash: String(signature.assinatura_hash),
      assinaturaVinculoHash: String(signature.assinatura_vinculo_hash),
      operadorNome: signature.operador_usuario_id ? names.get(String(signature.operador_usuario_id)) ?? null : null,
      assinadoEm: String(signature.assinado_em),
    } : null,
    arquivo: file ? {
      storagePath: String(file.storage_path),
      pdfHash: String(file.pdf_hash),
      tamanhoBytes: Number(file.tamanho_bytes),
      geradorVersao: String(file.gerador_versao),
      criadoEm: String(file.criado_em),
    } : null,
  };
}

export async function downloadChecklistAsset(storagePath: string) {
  const result = await supabaseAdmin.storage.from(CHECKLIST_DOCUMENTOS_BUCKET).download(storagePath);
  if (result.error || !result.data) throw result.error ?? new Error("Arquivo documental não encontrado.");
  return Buffer.from(await result.data.arrayBuffer());
}

export type ChecklistDocumentoExcluido = {
  documentoId: number;
  codigo: string;
  versao: number;
  tipo: ChecklistTipo;
  ordemServicoId: number;
  assinado: boolean;
};

/**
 * Remove uma versao do checklist.
 *
 * A exclusao passa pela funcao `excluir_checklist_documento`, unica com
 * privilegio para apagar a linha: ela religa a cadeia de versoes e recusa um
 * documento assinado sem `permitirAssinado`. Quem decide se o usuario pode usar
 * essa intencao e a rota, que conhece as permissoes.
 */
export async function deleteChecklistDocumento(args: {
  publicId: string;
  permitirAssinado: boolean;
}): Promise<ChecklistDocumentoExcluido> {
  if (!checklistPublicIdValido(args.publicId)) {
    throw new ChecklistDocumentoError("Versão do checklist não encontrada.", 404, "DOCUMENTO_NAO_ENCONTRADO");
  }

  const result = await supabaseAdmin.rpc("excluir_checklist_documento", {
    p_public_id: args.publicId,
    p_permitir_assinado: args.permitirAssinado,
  });

  if (result.error) {
    const message = String(result.error.message ?? "");
    if (/nao encontrada|não encontrada/i.test(message)) {
      throw new ChecklistDocumentoError("Versão do checklist não encontrada.", 404, "DOCUMENTO_NAO_ENCONTRADO");
    }
    if (/assinado/i.test(message)) {
      throw new ChecklistDocumentoError(
        "Esta versão está assinada. Excluí-la exige a permissão ordens:excluir_checklist_assinado.",
        403,
        "DOCUMENTO_ASSINADO",
      );
    }
    throw result.error;
  }

  const row = first(result.data as any);
  if (!row) {
    throw new ChecklistDocumentoError("Versão do checklist não encontrada.", 404, "DOCUMENTO_NAO_ENCONTRADO");
  }

  // Só o PDF oficial sai do storage: ele vive em `documentos/<id>/` e pertence a
  // esta versão. As fotos são endereçadas por hash e compartilhadas entre as
  // versões da OS — apagá-las cegaria versões que continuam vivas.
  const arquivoPath = text(row.arquivo_path);
  if (arquivoPath) {
    const removal = await supabaseAdmin.storage.from(CHECKLIST_DOCUMENTOS_BUCKET).remove([arquivoPath]);
    if (removal.error) {
      console.error("Falha ao remover o PDF oficial do checklist excluído", arquivoPath, removal.error);
    }
  }

  return {
    documentoId: Number(row.documento_id),
    codigo: String(row.codigo),
    versao: Number(row.versao),
    tipo: String(row.tipo) as ChecklistTipo,
    ordemServicoId: Number(row.ordemservico_id),
    assinado: row.assinado === true,
  };
}
