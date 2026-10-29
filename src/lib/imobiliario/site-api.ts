import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db, identifier, ImobError, json, bodyOf, pagination, rpc, verifiedIdentity, external, filterText } from "./server";
import { civilDate, leadSchema, reservaSchema } from "./schemas";
import { enrich, publicBooking, publicFlats } from "./data";
import { cotacaoPublica, hojeImobiliario } from "./types";
import { financeReport } from "./finance";

// Limitador por instância para formulários públicos; o banco continua sendo a autoridade
// para identidade, idempotência, preços e ocupação.
const publicAttempts = new Map<string, { count: number; until: number }>();
function publicRate(request: Request, kind: string, max = 30) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = createHash("sha256").update(`${kind}:${ip}`).digest("hex");
  const now = Date.now(), previous = publicAttempts.get(key);
  if (!previous || previous.until < now) publicAttempts.set(key, { count: 1, until: now + 60000 });
  else { previous.count++; if (previous.count > max) throw new ImobError(429, "Muitas solicitações. Tente novamente em um minuto."); }
  if (publicAttempts.size > 5000) for (const [k, v] of publicAttempts) if (v.until < now) publicAttempts.delete(k);
}

async function publishedProperty(value: string | number) {
  let query = db.from("imovel_resumo").select("*").eq("ativo", true).eq("publicado", true);
  query = typeof value === "number" ? query.eq("id", value) : query.eq("slug", value);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ImobError(404, "Imóvel não encontrado.");
  const owner = await db.from("proprietario").select("id").eq("id", result.data.proprietario_id).eq("ativo", true).maybeSingle();
  if (owner.error) throw owner.error;
  if (!owner.data) throw new ImobError(404, "Imóvel não encontrado.");
  return result.data;
}

export async function publicApi(request: Request, path: string[]) {
  const url = new URL(request.url), method = request.method;
  if (["flats", "imoveis"].includes(path[0]) && method === "GET") {
    if (path[1] && path[2] === "quote") {
      publicRate(request, "quote", 60);
      const property = await publishedProperty(identifier(path[1]));
      if (!property.modalidades.includes("TEMPORADA")) throw new ImobError(409, "Este imóvel não oferece temporada.");
      const start = civilDate.parse(url.searchParams.get("checkin") ?? url.searchParams.get("inicio")), end = civilDate.parse(url.searchParams.get("checkout") ?? url.searchParams.get("fim"));
      if (start < hojeImobiliario() || end <= start) throw new ImobError(400, "Informe um período válido de temporada.");
      const quote = await rpc("imob_cotar_reserva", { p_imovel_id: property.id, p_inicio: start, p_fim: end, p_hospedes: identifier(url.searchParams.get("guests") ?? url.searchParams.get("hospedes")) });
      return json(cotacaoPublica(quote));
    }
    if (path[1]) {
      const property = await publishedProperty(path[1]);
      if (path[0] === "flats" && !property.modalidades.includes("TEMPORADA")) throw new ImobError(404, "Imóvel não encontrado.");
      return json((await publicFlats([property]))[0]);
    }
    const { page, pageSize, from, to } = pagination(url);
    let query = db.from("imovel_resumo").select("*", { count: "exact" }).eq("ativo", true).eq("publicado", true);
    const inactiveOwners: number[] = [];
    for (let offset = 0; ; offset += 1000) {
      const owners = await db.from("proprietario").select("id").eq("ativo", false).order("id").range(offset, offset + 999);
      if (owners.error) throw owners.error;
      inactiveOwners.push(...owners.data.map((owner) => owner.id));
      if (owners.data.length < 1000) break;
    }
    if (inactiveOwners.length) query = query.not("proprietario_id", "in", `(${inactiveOwners.join(",")})`);
    if (path[0] === "flats") query = query.contains("modalidades", ["TEMPORADA"]);
    const modality = url.searchParams.get("modality") ?? url.searchParams.get("modalidade");
    if (modality) query = query.contains("modalidades", [z.enum(["TEMPORADA", "LOCACAO", "VENDA"]).parse(modality)]);
    const search = filterText(url.searchParams.get("q"));
    if (search) query = query.or(`titulo.ilike.%${search}%,endereco_publico->>cidade.ilike.%${search}%,endereco_publico->>bairro.ilike.%${search}%`);
    const neighborhood = url.searchParams.get("neighborhood");
    if (neighborhood) query = query.eq("endereco_publico->>bairro", z.string().trim().max(120).parse(neighborhood));
    if (url.searchParams.get("guests")) query = query.gte("capacidade", identifier(url.searchParams.get("guests")));
    const priceColumn = modality === "VENDA" ? "valor_venda" : modality === "LOCACAO" ? "valor_locacao" : "diaria";
    const minPrice = url.searchParams.get("minPrice"), maxPrice = url.searchParams.get("maxPrice");
    const priceSchema = z.coerce.number().finite().min(0).max(1e12);
    if (minPrice !== null) query = query.gte(priceColumn, priceSchema.parse(minPrice));
    if (maxPrice !== null) query = query.lte(priceColumn, priceSchema.parse(maxPrice));
    if (minPrice !== null && maxPrice !== null && Number(minPrice) > Number(maxPrice)) throw new ImobError(400, "Faixa de valores inválida.");
    const amenities = url.searchParams.get("amenities");
    if (amenities) query = query.contains("comodidades", z.array(z.string().trim().min(1).max(120)).max(100).parse(amenities.split(",")));
    const checkin = url.searchParams.get("checkin"), checkout = url.searchParams.get("checkout");
    if (checkin || checkout) {
      publicRate(request, "calendar-search", 60);
      const start = civilDate.parse(checkin), end = civilDate.parse(checkout);
      if (start < hojeImobiliario() || end <= start || (modality && modality !== "TEMPORADA")) throw new ImobError(400, "Informe um período válido de temporada.");
      query = query.contains("modalidades", ["TEMPORADA"]);
      const nights = (Date.parse(end) - Date.parse(start)) / 86400000;
      query = query.lte("min_noites", nights).or(`max_noites.is.null,max_noites.gte.${nights}`);
      const unavailable = new Set<number>();
      for (let offset = 0; ; offset += 1000) {
        const occupied = await db.from("imovel_ocupacao").select("imovel_id").eq("ativo", true).lt("inicio", end).or(`fim.is.null,fim.gt.${start}`).order("id").range(offset, offset + 999);
        if (occupied.error) throw occupied.error;
        for (const item of occupied.data) unavailable.add(item.imovel_id);
        if (occupied.data.length < 1000) break;
      }
      if (unavailable.size) query = query.not("id", "in", `(${[...unavailable].join(",")})`);
    }
    const sort = url.searchParams.get("sort");
    query = sort === "price-asc" || sort === "price-desc" ? query.order(priceColumn, { ascending: sort === "price-asc" }) : sort === "guests" ? query.order("capacidade", { ascending: false }) : query.order("titulo");
    const result = await query.order("id").range(from, to);
    if (result.error) throw result.error;
    return json({ items: await publicFlats(result.data ?? []), total: result.count ?? 0, page, pageSize });
  }
  if (["owner-leads", "leads", "visitas"].includes(path[0]) && method === "POST") {
    publicRate(request, "contact", 5);
    const input = await bodyOf(request);
    if (input.website || input.company_website) throw new ImobError(400, "Solicitação inválida.");
    const imovelId = input.imovelId ?? input.imovel_id ?? input.flatId;
    const property = imovelId ? await publishedProperty(identifier(imovelId)) : null;
    if (path[0] !== "owner-leads" && !property) throw new ImobError(400, "Selecione um imóvel.");
    const parsed = leadSchema.parse({ nome: input.name ?? input.nome, email: input.email, telefone: input.phone ?? input.telefone, mensagem: input.message ?? input.mensagem ?? input.notes ?? "", imovel_id: property?.id, modalidade: input.modality ?? input.modalidade, origem: "SITE" });
    if (parsed.modalidade && !property?.modalidades.includes(parsed.modalidade)) throw new ImobError(400, "Modalidade indisponível neste imóvel.");
    const key = input.idempotencyKey ? z.string().min(8).max(200).parse(input.idempotencyKey) : randomUUID();
    const desired = path[0] === "visitas" ? z.string().datetime({ offset: true }).parse(input.desiredAt ?? input.inicio) : null;
    if (desired && Date.parse(desired) < Date.now()) throw new ImobError(400, "Escolha uma data futura para a visita.");
    const saved = await db.from("imovel_lead").upsert({ ...parsed, modalidade: path[0] === "owner-leads" ? "PROPRIETARIO" : parsed.modalidade, idempotency_key: `SITE:${key}` }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (saved.error) throw saved.error;
    if (path[0] === "visitas" && saved.data) {
      const visit = await db.from("imovel_visita").insert({ imovel_id: property!.id, lead_id: saved.data.id, inicio: desired, fim: new Date(Date.parse(desired!) + 3600000).toISOString(), status: "SOLICITADA", observacoes: parsed.mensagem });
      if (visit.error) throw visit.error;
    }
    return json({ success: true, id: saved.data?.id ?? null }, 201);
  }
  throw new ImobError(404, "Rota pública não encontrada.");
}

async function syncedAccount(request: Request) {
  const user = await verifiedIdentity(request);
  let result = await db.from("site_usuario").select("*").eq("user_id", user.id).maybeSingle();
  if (result.error) throw result.error;
  if (result.data?.tipo === "PROPRIETARIO") {
    // Apenas convites vinculados pelo ERP são ativáveis; bloqueio/revogação permanecem.
    if (result.data.status === "PENDENTE" && result.data.created_by && result.data.proprietario_id) {
      const owner = await db.from("proprietario").select("id,ativo").eq("id", result.data.proprietario_id).eq("user_id", user.id).eq("ativo", true).maybeSingle();
      if (owner.error) throw owner.error;
      if (owner.data) {
        result = await db.from("site_usuario").update({ status: "ATIVO", motivo_pendencia: null, updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("status", "PENDENTE").select().single();
        if (result.error) throw result.error;
      }
    }
  } else {
    const sync = await rpc("imob_sincronizar_cliente_site", { p_auth_id: user.id });
    if (sync.status !== "ATIVO") throw new ImobError(409, "Seu cadastro precisa ser conferido pela equipe. Entre em contato para concluir o acesso.", { pending: true, code: "CADASTRO_PENDENTE" });
    result = await db.from("site_usuario").select("*").eq("user_id", user.id).single();
    if (result.error) throw result.error;
  }
  if (!result.data || result.data.status !== "ATIVO") throw new ImobError(403, "O acesso desta conta está bloqueado ou ainda não foi ativado.");
  return { user, account: result.data };
}

async function profile(account: Record<string, any>, email: string) {
  const owner = account.tipo === "PROPRIETARIO";
  let query = db.from(owner ? "proprietario" : "cliente").select("nomerazaosocial,telefone,cpfcnpj").eq("id", owner ? account.proprietario_id : account.cliente_id).eq("user_id", account.user_id);
  query = owner ? query.eq("ativo", true) : query.eq("is_deleted", false);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ImobError(403, "Cadastro indisponível.");
  return { id: account.user_id, name: result.data.nomerazaosocial, email, phone: result.data.telefone ?? "", cpf: result.data.cpfcnpj, role: owner ? "owner" : "guest" };
}

export async function siteApi(request: Request, path: string[]) {
  const url = new URL(request.url), method = request.method;
  if (path[0] === "me" && (!path[1] || path[1] === "sync")) {
    const { user, account } = await syncedAccount(request);
    if (method === "GET" || method === "POST" && path[1] === "sync") return json(await profile(account, user.email!));
    if (method === "PATCH" && !path[1]) {
      if (account.tipo !== "CLIENTE") throw new ImobError(403, "Alterações de proprietário são realizadas pelo ERP.");
      const body = z.object({ name: z.string().trim().min(2).max(150), phone: z.string().trim().min(8).max(30) }).parse(await bodyOf(request));
      const updated = await rpc("imob_atualizar_perfil_cliente", { p_auth_id: user.id, p_nome: body.name, p_telefone: body.phone });
      void updated;
      return json(await profile(account, user.email!));
    }
  }
  if (path[0] === "me" && path[1] === "reservas" && method === "GET") {
    const { account } = await external(request, "CLIENTE");
    const pg = pagination(url);
    let query = db.from("reserva_imovel").select("*", { count: "exact" }).eq("cliente_id", account.cliente_id);
    if (url.searchParams.get("id")) query = query.eq("id", identifier(url.searchParams.get("id")));
    const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(pg.from, pg.to);
    if (result.error) throw result.error;
    return json({ items: (await enrich(result.data ?? [])).map(publicBooking), total: result.count ?? 0, page: pg.page, pageSize: pg.pageSize });
  }
  if (path[0] === "reservas" && method === "POST") {
    const { user, account } = await external(request, "CLIENTE");
    const body = await bodyOf(request);
    if (body.acceptedTerms !== true) throw new ImobError(400, "Aceite as regras da reserva para continuar.");
    const property = await publishedProperty(identifier(body.flatId));
    const parsed = reservaSchema.parse({ imovel_id: property.id, cliente_id: account.cliente_id, inicio: body.checkin, fim: body.checkout, hospedes: body.guests,
      cotacao_id: z.string().uuid().parse(body.quoteId), expected_total: z.coerce.number().finite().positive().parse(body.expectedTotal), idempotency_key: `SITE:${user.id}:${z.string().min(8).max(120).parse(body.idempotencyKey)}`, origem: "SITE" });
    const row = await rpc("imob_salvar_reserva", { p_payload: parsed, p_actor: user.id, p_id: null });
    return json(publicBooking((await enrich([row]))[0]), 201);
  }
  if (path[0] === "arquivos" && path[1] && method === "GET") {
    const { account } = await external(request);
    const result = await db.from("imovel_arquivo").select("*").eq("id", identifier(path[1])).maybeSingle();
    if (result.error) throw result.error;
    const file = result.data;
    if (!file) throw new ImobError(404, "Arquivo não encontrado.");
    let allowed = false;
    if (account.tipo === "PROPRIETARIO") {
      // Documentos de outro proprietário ou de outra operação nunca são compartilhados por troca de titular.
      allowed = file.proprietario_id === account.proprietario_id;
      if (!file.proprietario_id && file.imovel_id && !file.reserva_id && !file.locacao_id && !file.venda_id) {
        const property = await db.from("imovel").select("id").eq("id", file.imovel_id).eq("proprietario_id", account.proprietario_id).maybeSingle();
        if (property.error) throw property.error;
        allowed = !!property.data;
      }
    } else if (file.reserva_id) {
      const reservation = await db.from("reserva_imovel").select("id").eq("id", file.reserva_id).eq("cliente_id", account.cliente_id).maybeSingle();
      if (reservation.error) throw reservation.error;
      allowed = !!reservation.data;
    }
    if (!allowed) throw new ImobError(404, "Arquivo não encontrado.");
    const signed = await db.storage.from(file.bucket).createSignedUrl(file.path, 120);
    if (signed.error) throw signed.error;
    return json({ url: signed.data.signedUrl, expiresIn: 120 });
  }
  if (path[0] === "proprietario") {
    const { account } = await external(request, "PROPRIETARIO");
    const ownerId = identifier(account.proprietario_id);
    const owner = await db.from("proprietario").select("id").eq("id", ownerId).eq("user_id", account.user_id).eq("ativo", true).maybeSingle();
    if (owner.error) throw owner.error;
    if (!owner.data) throw new ImobError(403, "O acesso deste proprietário foi suspenso.");
    const properties = await db.from("imovel_resumo").select("*").eq("proprietario_id", ownerId).order("titulo");
    if (properties.error) throw properties.error;
    if (path[1] === "imoveis" && method === "GET") return json({ items: await publicFlats(properties.data) });
    const selected = url.searchParams.get("imovelId") ?? url.searchParams.get("imovel_id");
    const selectedId = selected ? identifier(selected) : null;
    const selectedProperties = selectedId ? properties.data.filter((property) => property.id === selectedId) : properties.data;
    // Extrato histórico filtra pelo beneficiário, mesmo se o imóvel já tiver sido transferido.
    const report = await financeReport({ proprietario_id: ownerId, ...(selectedId ? { imovel_id: selectedId } : {}) }, url);
    if (path[1] === "extratos" && method === "GET") {
      const publicReport = { items: report.items, totais: report.totais, periodo: report.periodo };
      return json({ ...publicReport, imoveis: properties.data.map((p) => ({ id: p.id, titulo: p.titulo })) });
    }
    if (path[1] === "dashboard" && method === "GET") {
      const current = hojeImobiliario();
      let reservationsQuery = db.from("reserva_imovel").select("id,imovel_id,inicio,fim,hospedes,status,valor_total,financeiro_status").eq("proprietario_id", ownerId);
      if (selectedId) reservationsQuery = reservationsQuery.eq("imovel_id", selectedId);
      const periodStart = url.searchParams.get("inicio"), periodEnd = url.searchParams.get("fim");
      if (periodStart) reservationsQuery = reservationsQuery.gt("fim", civilDate.parse(periodStart));
      if (periodEnd) reservationsQuery = reservationsQuery.lte("inicio", civilDate.parse(periodEnd));
      const [reservations, occupations] = await Promise.all([
        reservationsQuery.order("inicio", { ascending: false }).limit(100),
        selectedProperties.length ? db.from("imovel_ocupacao").select("id,imovel_id,tipo,inicio,fim,motivo").in("imovel_id", selectedProperties.map((p) => p.id)).eq("ativo", true).or(`fim.is.null,fim.gt.${current}`).limit(1000) : Promise.resolve({ data: [], error: null }),
      ]);
      if (reservations.error) throw reservations.error;
      if (occupations.error) throw occupations.error;
      const occupied = selectedProperties.filter((p) => !["DISPONIVEL", "EM_NEGOCIACAO"].includes(p.situacao_operacional)).length;
      const enrichedReservations = await enrich(reservations.data);
      return json({ occupancy: selectedProperties.length ? Math.round(occupied / selectedProperties.length * 100) : 0, revenue: report.totais.recebido, expenses: report.totais.despesas + report.totais.receita_administradora, payout: report.totais.saldo_repassar,
        reservations: enrichedReservations.map((reservation) => ({ id: String(reservation.id), flat: reservation.imovel?.titulo ?? "Imóvel", period: `${reservation.inicio} a ${reservation.fim}`, amount: Number(reservation.valor_total), status: publicBooking(reservation).status })),
        maintenance: occupations.data.filter((o) => ["MANUTENCAO", "BLOQUEIO"].includes(o.tipo)).map((occupation) => ({ title: occupation.motivo ?? "Bloqueio do imóvel", status: occupation.tipo === "MANUTENCAO" ? "Manutenção" : "Bloqueio", amount: null })), ocupacoes: occupations.data, totais: report.totais, imoveis: await publicFlats(selectedProperties) });
    }
  }
  throw new ImobError(404, "Rota da conta não encontrada.");
}
