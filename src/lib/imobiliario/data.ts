import "server-only";
import { randomUUID } from "node:crypto";
import { db, identifier, ImobError, one, rpc } from "./server";
import { IMOBILIARIO_BUCKET_DOCUMENTOS, IMOBILIARIO_BUCKET_FOTOS, statusReservaPublico } from "./types";

export async function enrich(items: Record<string, any>[]): Promise<Record<string, any>[]> {
  if (!items.length) return items;
  const ids = (key: string) => [...new Set(items.map((r) => r[key]).filter(Boolean))];
  const imovelIds = [...new Set([...ids("imovel_id"), ...items.filter((r) => r.titulo && r.id).map((r) => r.id)])];

  const [imoveis, clientes, proprietarios, fotos] = await Promise.all([
    ids("imovel_id").length ? db.from("imovel_resumo").select("id,titulo,slug,codigo,modalidades,tipo,capacidade,quartos,banheiros,vagas,area,diaria,valor_locacao,valor_venda,endereco,endereco_publico,situacao_operacional,ativo").in("id", ids("imovel_id")) : Promise.resolve({ data: [], error: null }),
    [...ids("cliente_id"), ...ids("comprador_id")].length ? db.from("cliente").select("id,nomerazaosocial,cpfcnpj,telefone,email,cidade,estado,tipopessoa,status").in("id", [...ids("cliente_id"), ...ids("comprador_id")]) : Promise.resolve({ data: [], error: null }),
    ids("proprietario_id").length ? db.from("proprietario").select("id,nomerazaosocial,cpfcnpj,telefone,email,tipopessoa,ativo").in("id", ids("proprietario_id")) : Promise.resolve({ data: [], error: null }),
    imovelIds.length ? db.from("imovel_arquivo").select("imovel_id,path,ordem").in("imovel_id", imovelIds).eq("tipo", "FOTO").eq("bucket", IMOBILIARIO_BUCKET_FOTOS).eq("publico", true).order("ordem").order("id") : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [imoveis, clientes, proprietarios, fotos]) if (result.error) throw result.error;

  const getCoverPhoto = (targetId?: number | null) => {
    if (!targetId) return null;
    const file = fotos.data?.find((f) => f.imovel_id === targetId);
    if (!file) return null;
    return db.storage.from(IMOBILIARIO_BUCKET_FOTOS).getPublicUrl(file.path).data.publicUrl;
  };

  return items.map((r) => {
    const imovelObj = imoveis.data?.find((i) => i.id === r.imovel_id);
    const targetImovelId = r.imovel_id ?? (r.titulo && r.id ? r.id : null);
    const cover = getCoverPhoto(targetImovelId);

    return {
      ...r,
      foto_capa: r.foto_capa ?? cover,
      imovel: imovelObj ? { ...imovelObj, foto_capa: getCoverPhoto(imovelObj.id) } : undefined,
      cliente: clientes.data?.find((i) => i.id === (r.cliente_id ?? r.comprador_id)),
      proprietario: proprietarios.data?.find((i) => i.id === r.proprietario_id),
    };
  });
}

export async function publicFlats(rows: Record<string, any>[]) {
  if (!rows.length) return [];
  const { data: files, error } = await db.from("imovel_arquivo").select("imovel_id,path,ordem").in("imovel_id", rows.map((r) => r.id)).eq("tipo", "FOTO").eq("bucket", IMOBILIARIO_BUCKET_FOTOS).eq("publico", true).is("reserva_id", null).is("locacao_id", null).is("venda_id", null).is("proprietario_id", null).order("ordem").order("id");
  if (error) throw error;
  return rows.map((r) => {
    const gallery = (files ?? []).filter((f) => f.imovel_id === r.id).map((f) => db.storage.from(IMOBILIARIO_BUCKET_FOTOS).getPublicUrl(f.path).data.publicUrl);
    const address = r.endereco_publico ?? {};
    return {
      id: String(r.id), slug: r.slug, title: r.titulo, neighborhood: address.bairro ?? "", city: address.cidade ?? "", state: address.estado ?? "",
      description: r.descricao ?? "", coverImage: gallery[0] ?? "", gallery, realPhotos: Boolean(r.fotos_reais) && gallery.length > 0,
      maxGuests: Number(r.capacidade ?? 1), bedrooms: Number(r.quartos ?? 0), bathrooms: Number(r.banheiros ?? 0), areaSqm: Number(r.area ?? 0), amenities: r.comodidades ?? [],
      active: r.ativo, published: r.publicado, fromPrice: Number(r.diaria ?? 0), tag: r.selo_anuncio ?? "",
      modalities: r.modalidades, prices: { nightly: r.modalidades?.includes("TEMPORADA") ? Number(r.diaria ?? 0) : null, monthly: r.modalidades?.includes("LOCACAO") ? Number(r.valor_locacao ?? 0) : null, sale: r.modalidades?.includes("VENDA") ? Number(r.valor_venda ?? 0) : null },
      occupancyStatus: r.situacao_comercial === "VENDIDO" ? "VENDIDO" : r.situacao_operacional ?? "DISPONIVEL", rules: r.regras ?? "", checkinTime: r.horario_checkin, checkoutTime: r.horario_checkout, minNights: r.min_noites, maxNights: r.max_noites,
      publicLocation: { latitude: address.latitude ?? null, longitude: address.longitude ?? null },
    };
  });
}

export function publicBooking(row: Record<string, any>) {
  return {
    id: String(row.id), flatTitle: row.imovel?.titulo ?? "Imóvel", slug: row.imovel?.slug ?? "", checkin: row.inicio, checkout: row.fim,
    guests: row.hospedes, total: Number(row.valor_total), status: statusReservaPublico(row.status),
    paymentStatus: ({ PENDENTE: "PENDING", PARCIAL: "PARTIAL", PAGO: "PAID", ESTORNADO: "REFUNDED" } as Record<string, string>)[row.financeiro_status] ?? "PENDING", createdAt: row.created_at
  };
}

export async function activeOperations(imovelId: number, start: string) {
  const [reservas, locacoes] = await Promise.all([
    db.from("reserva_imovel").select("*").eq("imovel_id", imovelId).in("status", ["CONFIRMADA", "EM_ANDAMENTO"]).gt("fim", start),
    db.from("locacao_imovel").select("*").eq("imovel_id", imovelId).eq("status", "ATIVA").or(`fim.is.null,fim.gt.${start}`),
  ]);
  if (reservas.error) throw reservas.error;
  if (locacoes.error) throw locacoes.error;
  return enrich([...(reservas.data ?? []).map((r) => ({ ...r, tipo: "RESERVA" })), ...(locacoes.data ?? []).map((r) => ({ ...r, tipo: "LOCACAO" }))]);
}

export async function publicationValid(row: Record<string, any>, id?: number) {
  if (!row.publicado) return;
  const owner = await one("proprietario", row.proprietario_id);
  if (!row.ativo || !owner.ativo) throw new ImobError(409, "Imóvel e proprietário precisam estar ativos para publicar.");
  if (!row.descricao?.trim() || !row.endereco_publico?.cidade || !row.endereco_publico?.estado) throw new ImobError(400, "Preencha descrição, cidade e estado públicos antes de publicar.");
  for (const [mode, price] of [["TEMPORADA", row.diaria], ["LOCACAO", row.valor_locacao], ["VENDA", row.valor_venda]]) {
    if (row.modalidades.includes(mode) && Number(price) <= 0) throw new ImobError(400, `Informe o valor da modalidade ${mode}.`);
  }
  if (!id) throw new ImobError(400, "Salve o imóvel e adicione as fotos antes de publicar.");
  const { count, error } = await db.from("imovel_arquivo").select("id", { count: "exact", head: true }).eq("imovel_id", id).eq("tipo", "FOTO").eq("bucket", IMOBILIARIO_BUCKET_FOTOS).eq("publico", true).is("proprietario_id", null).is("reserva_id", null).is("locacao_id", null).is("venda_id", null);
  if (error) throw error;
  if (!count) throw new ImobError(400, "Adicione pelo menos uma foto antes de publicar.");
}

export async function fileScope(resource: string, id: number) {
  if (resource === "proprietarios") return { proprietario_id: (await one("proprietario", id)).id, imovel_id: null, reserva_id: null, locacao_id: null, venda_id: null };
  if (resource === "imoveis") return { imovel_id: (await one("imovel", id)).id, reserva_id: null, locacao_id: null, venda_id: null };
  const table = ({ reservas: "reserva_imovel", "locacoes-imobiliarias": "locacao_imovel", "vendas-imobiliarias": "venda_imovel" } as Record<string, string>)[resource];
  if (!table) throw new ImobError(400, "Documentos devem estar vinculados a um imóvel ou operação.");
  const row = await one(table, id);
  return { imovel_id: row.imovel_id, proprietario_id: row.proprietario_id, [resource === "reservas" ? "reserva_id" : resource === "locacoes-imobiliarias" ? "locacao_id" : "venda_id"]: id };
}

const isGalleryRow = (r: Record<string, any>) => r.publico && r.bucket === IMOBILIARIO_BUCKET_FOTOS && r.tipo === "FOTO";

export async function filesFor(scope: Record<string, unknown>) {
  let query = db.from("imovel_arquivo").select("*");
  for (const [k, v] of Object.entries(scope)) query = v === null ? query.is(k, null) : query.eq(k, v);
  const { data, error } = await query.order("ordem").order("id");
  if (error) throw error;
  return Promise.all((data ?? []).map(async (r) => ({ ...r, url: isGalleryRow(r) ? db.storage.from(r.bucket).getPublicUrl(r.path).data.publicUrl : (await db.storage.from(r.bucket).createSignedUrl(r.path, 120)).data?.signedUrl ?? null })));
}

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
// Formatos de escritório só se distinguem pela extensão; a assinatura confirma o contêiner.
const OFFICE: Record<string, { mime: string; container: Buffer }> = {
  doc: { mime: "application/msword", container: OLE },
  xls: { mime: "application/vnd.ms-excel", container: OLE },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", container: ZIP },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", container: ZIP },
  odt: { mime: "application/vnd.oasis.opendocument.text", container: ZIP },
  ods: { mime: "application/vnd.oasis.opendocument.spreadsheet", container: ZIP },
};

function detectFile(bytes: Buffer, name: string): { mime: string; ext: string; image: boolean } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", image: true };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: "image/png", ext: "png", image: true };
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", image: true };
  if (bytes.toString("ascii", 0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf", image: false };
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const office = OFFICE[ext];
  if (office && bytes.subarray(0, office.container.length).equals(office.container)) return { mime: office.mime, ext, image: false };
  if ((ext === "txt" || ext === "csv") && !bytes.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { mime: ext === "csv" ? "text/csv" : "text/plain", ext, image: false };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Foto do anúncio sai do ERP já pronta para o site: orientação aplicada, no
 * máximo 2000px e em WebP. A recodificação também descarta o EXIF, que em foto
 * de celular costuma trazer a localização GPS de quem fotografou.
 */
async function galleryImage(bytes: Buffer) {
  const { default: sharp } = await import("sharp");
  try {
    return await sharp(bytes).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new ImobError(400, "Imagem inválida ou formato não suportado.");
  }
}

function galleryQuery(imovelId: number) {
  return db.from("imovel_arquivo").select("*").eq("imovel_id", imovelId).eq("tipo", "FOTO").eq("bucket", IMOBILIARIO_BUCKET_FOTOS).eq("publico", true).is("proprietario_id", null);
}

export async function uploadFile(request: Request, scope: Record<string, unknown>, actor: string) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new ImobError(400, "Selecione um arquivo.");
  const tipo = String(form.get("tipo") ?? "DOCUMENTO").toUpperCase();
  if (!["FOTO", "DOCUMENTO"].includes(tipo)) throw new ImobError(400, "Tipo de arquivo inválido.");
  if (file.size > (tipo === "FOTO" ? 10 : 50) * 1024 * 1024) throw new ImobError(400, "O arquivo ultrapassa o limite permitido.");
  let bytes = Buffer.from(await file.arrayBuffer());
  const detected = detectFile(bytes, file.name);
  if (!detected || (tipo === "FOTO" && !detected.image)) {
    throw new ImobError(400, tipo === "FOTO" ? "Use fotos JPG, PNG ou WebP." : "Formato não aceito. Use PDF, imagem, Word, Excel, OpenDocument, TXT ou CSV.");
  }
  const publicPhoto = tipo === "FOTO" && !!scope.imovel_id && !scope.proprietario_id && !scope.reserva_id && !scope.locacao_id && !scope.venda_id;
  let { mime, ext } = detected;
  let ordem = 0;
  if (publicPhoto) {
    bytes = await galleryImage(bytes);
    mime = "image/webp";
    ext = "webp";
    // Foto nova entra no fim da galeria; a posição final vem da ordenação salva pelo ERP.
    const last = await galleryQuery(Number(scope.imovel_id)).order("ordem", { ascending: false }).limit(1).maybeSingle();
    if (last.error) throw last.error;
    ordem = last.data ? Number(last.data.ordem) + 1 : 0;
  }
  const bucket = publicPhoto ? IMOBILIARIO_BUCKET_FOTOS : IMOBILIARIO_BUCKET_DOCUMENTOS;
  const path = `${scope.imovel_id ? `imoveis/${scope.imovel_id}` : `proprietarios/${scope.proprietario_id}`}/${randomUUID()}.${ext}`;
  const upload = await db.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
  if (upload.error) throw upload.error;
  const { data, error } = await db.from("imovel_arquivo").insert({ ...scope, bucket, path, tipo, nome: String(form.get("titulo") || file.name).slice(0, 250), mime, tamanho: bytes.length, publico: publicPhoto, ordem, created_by: actor }).select().single();
  if (error) { await db.storage.from(bucket).remove([path]); throw error; }
  return { ...data, url: publicPhoto ? db.storage.from(bucket).getPublicUrl(path).data.publicUrl : null };
}

/** Grava a sequência inteira da galeria; a primeira foto é a capa do anúncio no site. */
export async function reorderGallery(imovelId: number, ids: number[], actor: string) {
  await rpc("imob_ordenar_galeria", { p_imovel_id: imovelId, p_ids: ids, p_actor: actor });
  const { data, error } = await galleryQuery(imovelId).order("ordem").order("id");
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, url: db.storage.from(r.bucket).getPublicUrl(r.path).data.publicUrl }));
}

/** Link novo a cada clique: o assinado da listagem expira em dois minutos. */
export async function fileUrl(scope: Record<string, unknown>, fileId: unknown, download: boolean) {
  const row = await one("imovel_arquivo", identifier(fileId));
  if (Object.entries(scope).some(([k, v]) => row[k] !== v)) throw new ImobError(404, "Arquivo não encontrado.");
  if (isGalleryRow(row)) return db.storage.from(row.bucket).getPublicUrl(row.path, download ? { download: row.nome } : undefined).data.publicUrl;
  const { data, error } = await db.storage.from(row.bucket).createSignedUrl(row.path, 300, download ? { download: row.nome } : undefined);
  if (error || !data?.signedUrl) throw error ?? new ImobError(404, "Arquivo não encontrado.");
  return data.signedUrl;
}

/**
 * Limpa do storage os arquivos de um registro já apagado no banco. Roda depois do
 * commit: falha aqui deixa só arquivo órfão no bucket, nunca registro sem arquivo.
 */
export async function removeStoredFiles(files: { bucket: string; path: string }[]) {
  const byBucket = new Map<string, string[]>();
  for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) console.error("[imobiliario] arquivos órfãos no storage:", bucket, error.message);
    }
  }
}

export async function deleteFile(scope: Record<string, unknown>, fileId: unknown) {
  const row = await one("imovel_arquivo", identifier(fileId));
  if (Object.entries(scope).some(([k, v]) => row[k] !== v)) throw new ImobError(404, "Arquivo não encontrado.");
  const { error } = await db.storage.from(row.bucket).remove([row.path]);
  if (error) throw error;
  const removal = await db.from("imovel_arquivo").delete().eq("id", row.id);
  if (removal.error) throw removal.error;
}
