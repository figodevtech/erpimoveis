import "server-only";
import { occupancyCalendar } from "./ical";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, identifier, ImobError, json, bodyOf, pagination, rpc, verifiedIdentity, external, filterText } from "./server";
import { civilDate, reservaSchema } from "./schemas";
import { enrich, publicBooking, publicFlats } from "./data";
import { cotacaoPublica, hojeImobiliario } from "./types";
import { financeReport } from "./finance";

// Limitador por instância para formulários públicos; o banco continua sendo a autoridade
// para identidade, idempotência, preços e ocupação.
const publicAttempts = new Map<string, { count: number; until: number }>();

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/**
 * IP de quem está no site. As chamadas chegam do servidor do site, então o IP da conexão é o
 * mesmo para todos os visitantes; o site repassa o do visitante em x-site-client-ip, e só vale
 * com o segredo compartilhado (SITE_API_SECRET aqui = ERP_API_SECRET no site). Sem segredo
 * configurado, continua como antes: o IP da conexão.
 */
function clientIp(request: Request) {
  const secret = process.env.SITE_API_SECRET;
  const sent = request.headers.get("x-site-secret");
  const visitor = request.headers.get("x-site-client-ip")?.split(",")[0]?.trim();
  if (secret && sent && visitor && sameSecret(sent, secret)) return visitor.slice(0, 64);
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

function publicRate(request: Request, kind: string, max = 30) {
  const ip = clientIp(request);
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

/** Chave de comparação de comodidades: "Wi-Fi", "wi-fi " e "WI-FI" são a mesma. Mesma regra do formulário do imóvel e do site. */
export function amenityKey(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");
}

/** Literal de array do Postgres com cada item entre aspas: nomes podem ter vírgula, aspas ou chaves. */
function pgTextArray(values: string[]) {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

async function inactiveOwnerIds() {
  const ids: number[] = [];
  for (let offset = 0; ; offset += 1000) {
    const owners = await db.from("proprietario").select("id").eq("ativo", false).order("id").range(offset, offset + 999);
    if (owners.error) throw owners.error;
    ids.push(...owners.data.map((owner) => owner.id));
    if (owners.data.length < 1000) break;
  }
  return ids;
}

/** Comodidades dos imóveis visíveis no site: chave normalizada → grafias cadastradas → nº de imóveis. */
async function publishedAmenities(inactiveOwners: number[], modality?: string | null) {
  const groups = new Map<string, Map<string, number>>();
  for (let offset = 0; ; offset += 1000) {
    let query = db.from("imovel_resumo").select("comodidades").eq("ativo", true).eq("publicado", true);
    if (inactiveOwners.length) query = query.not("proprietario_id", "in", `(${inactiveOwners.join(",")})`);
    if (modality) query = query.contains("modalidades", [modality]);
    const result = await query.order("id").range(offset, offset + 999);
    if (result.error) throw result.error;
    for (const row of result.data) {
      const seen = new Set<string>();
      for (const raw of (row.comodidades ?? []) as string[]) {
        const name = String(raw ?? "").trim().replace(/\s+/g, " "), key = amenityKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const spellings = groups.get(key) ?? new Map<string, number>();
        spellings.set(name, (spellings.get(name) ?? 0) + 1);
        groups.set(key, spellings);
      }
    }
    if (result.data.length < 1000) break;
  }
  return groups;
}

const civilPlus = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * O que o hóspede precisa saber antes de escolher as datas (o seletor do site não marca dias):
 * períodos sem disponibilidade (fim = dia de saída, livre para entrada) e pacotes fechados.
 */
async function publicAgenda(property: Record<string, any>) {
  const today = hojeImobiliario(), until = civilPlus(today, 400);
  if (!property.modalidades?.includes("TEMPORADA")) return { ate: until, indisponivel: [], pacotes: [] };
  const [occupied, packages] = await Promise.all([
    db.from("imovel_ocupacao").select("inicio,fim").eq("imovel_id", property.id).eq("ativo", true).lt("inicio", until).or(`fim.is.null,fim.gt.${today}`).order("inicio"),
    db.from("imovel_tarifa").select("descricao,inicio,fim,min_noites").eq("imovel_id", property.id).eq("ativo", true).eq("reserva_exclusiva", true).lt("inicio", until).gt("fim", today).order("inicio"),
  ]);
  if (occupied.error) throw occupied.error;
  if (packages.error) throw packages.error;
  // Reservas e bloqueios encostados viram um período só (o tipo não sai daqui).
  const indisponivel: { inicio: string; fim: string }[] = [];
  for (const row of occupied.data) {
    const inicio = row.inicio < today ? today : row.inicio, fim = row.fim ?? until;
    const last = indisponivel[indisponivel.length - 1];
    if (last && inicio <= last.fim) last.fim = fim > last.fim ? fim : last.fim;
    else indisponivel.push({ inicio, fim });
  }
  return {
    ate: until,
    indisponivel,
    pacotes: packages.data.map((p) => ({ nome: String(p.descricao ?? "").trim() || "Período especial", inicio: p.inicio, fim: p.fim, min_noites: Number(p.min_noites ?? 1) })),
  };
}

export async function publicApi(request: Request, path: string[]) {
  const url = new URL(request.url), method = request.method;
  if (path[0] === "destinos" && method === "GET") {
    // Destinos da busca do site: só cidade/UF com imóvel publicado de proprietário ativo.
    const modality = url.searchParams.get("modality") ?? url.searchParams.get("modalidade");
    const inactiveOwners = await inactiveOwnerIds();
    const groups = new Map<string, { cidade: string; estado: string; total: number }>();
    for (let offset = 0; ; offset += 1000) {
      let query = db.from("imovel_resumo").select("endereco_publico").eq("ativo", true).eq("publicado", true);
      if (inactiveOwners.length) query = query.not("proprietario_id", "in", `(${inactiveOwners.join(",")})`);
      if (modality) query = query.contains("modalidades", [z.enum(["TEMPORADA", "LOCACAO", "VENDA"]).parse(modality)]);
      const result = await query.order("id").range(offset, offset + 999);
      if (result.error) throw result.error;
      for (const row of result.data) {
        const cidade = String(row.endereco_publico?.cidade ?? "").trim(), estado = String(row.endereco_publico?.estado ?? "").trim().toUpperCase();
        if (!cidade || !estado) continue;
        const key = `${amenityKey(cidade)}|${estado}`;
        const group = groups.get(key) ?? { cidade, estado, total: 0 };
        group.total += 1;
        groups.set(key, group);
      }
      if (result.data.length < 1000) break;
    }
    return json({ items: [...groups.values()].sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR") || a.estado.localeCompare(b.estado)) });
  }
  if (path[0] === "comodidades" && method === "GET") {
    // Opções do filtro do site: só o que existe em imóveis publicados, com o nome do tipo cadastrado no ERP quando houver.
    const modality = url.searchParams.get("modality") ?? url.searchParams.get("modalidade");
    const groups = await publishedAmenities(await inactiveOwnerIds(), modality ? z.enum(["TEMPORADA", "LOCACAO", "VENDA"]).parse(modality) : null);
    const tipos = await db.from("tipos_comodidade").select("nome").eq("ativo", true);
    if (tipos.error) throw tipos.error;
    const official = new Map(tipos.data.map((t) => [amenityKey(t.nome), String(t.nome).trim()]));
    const items = [...groups].map(([key, spellings]) => {
      const counts = [...spellings];
      // Sem tipo cadastrado, vale a grafia mais usada (empate: ordem alfabética).
      const name = official.get(key) ?? counts.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0][0];
      return { name, count: counts.reduce((sum, [, count]) => sum + count, 0) };
    }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return json({ items });
  }
  if (["flats", "imoveis"].includes(path[0]) && method === "GET") {
    if (path.length === 3 && path[1] && path[2] === "calendario.ics") {
      publicRate(request, "ical", 60);
      const property = await publishedProperty(/^\d+$/.test(path[1]) ? identifier(path[1]) : path[1]);
      const destination = url.searchParams.has("canal") ? z.enum(["AIRBNB", "BOOKING"]).parse(url.searchParams.get("canal")) : null;
      const source = destination ? await db.from("imovel_canal_calendario").select("id").eq("imovel_id", property.id).eq("canal", destination).maybeSingle() : null;
      if (source?.error) throw source.error;
      const today = hojeImobiliario(), until = civilPlus(today, 730);
      const rows: { id: number; inicio: string; fim: string | null }[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = db.from("imovel_ocupacao").select("id,inicio,fim")
          .eq("imovel_id", property.id).eq("ativo", true).lt("inicio", until)
          .or(`fim.is.null,fim.gt.${today}`).order("id").range(offset, offset + 999);
        // Não devolve ao canal os eventos que vieram dele. O link sem destino exporta só eventos locais.
        if (!destination) query = query.is("canal_calendario_id", null);
        else if (source?.data) query = query.or(`canal_calendario_id.is.null,canal_calendario_id.neq.${source.data.id}`);
        const result = await query;
        if (result.error) throw result.error;
        rows.push(...result.data);
        if (result.data.length < 1000) break;
      }
      return new Response(occupancyCalendar(property.id, rows, until), {
        headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store",
          "Content-Disposition": 'inline; filename="disponibilidade.ics"', "X-Content-Type-Options": "nosniff" },
      });
    }
    if (path[1] && path[2] === "quote") {
      publicRate(request, "quote", 60);
      const property = await publishedProperty(identifier(path[1]));
      if (!property.modalidades.includes("TEMPORADA")) throw new ImobError(409, "Este imóvel não oferece temporada.");
      const start = civilDate.parse(url.searchParams.get("checkin") ?? url.searchParams.get("inicio")), end = civilDate.parse(url.searchParams.get("checkout") ?? url.searchParams.get("fim"));
      if (start < hojeImobiliario() || end <= start) throw new ImobError(400, "Informe um período válido de temporada.");
      const quote = await rpc("imob_cotar_reserva", { p_imovel_id: property.id, p_inicio: start, p_fim: end, p_hospedes: identifier(url.searchParams.get("guests") ?? url.searchParams.get("hospedes")) });
      return json(cotacaoPublica(quote));
    }
    if (path[1] && path[2] === "agenda") {
      // Agenda pública do anúncio: só datas. Sem motivo, sem reserva, sem valores.
      publicRate(request, "agenda", 60);
      const property = await publishedProperty(/^\d+$/.test(path[1]) ? identifier(path[1]) : path[1]);
      return json(await publicAgenda(property));
    }
    if (path[1]) {
      const property = await publishedProperty(path[1]);
      if (path[0] === "flats" && !property.modalidades.includes("TEMPORADA")) throw new ImobError(404, "Imóvel não encontrado.");
      return json((await publicFlats([property]))[0]);
    }
    const { page, pageSize, from, to } = pagination(url);
    let query = db.from("imovel_resumo").select("*", { count: "exact" }).eq("ativo", true).eq("publicado", true);
    const inactiveOwners = await inactiveOwnerIds();
    if (inactiveOwners.length) query = query.not("proprietario_id", "in", `(${inactiveOwners.join(",")})`);
    if (path[0] === "flats") query = query.contains("modalidades", ["TEMPORADA"]);
    const modality = url.searchParams.get("modality") ?? url.searchParams.get("modalidade");
    if (modality) query = query.contains("modalidades", [z.enum(["TEMPORADA", "LOCACAO", "VENDA"]).parse(modality)]);
    const search = filterText(url.searchParams.get("q"));
    if (search) query = query.or(`titulo.ilike.%${search}%,endereco_publico->>cidade.ilike.%${search}%,endereco_publico->>bairro.ilike.%${search}%`);
    const neighborhood = url.searchParams.get("neighborhood");
    if (neighborhood) query = query.eq("endereco_publico->>bairro", z.string().trim().max(120).parse(neighborhood));
    // Destino do site: cidade + UF (as opções vêm de /public/destinos). ilike sem curinga = igual sem caixa.
    const city = filterText(url.searchParams.get("city")), state = url.searchParams.get("state");
    if (city) query = query.ilike("endereco_publico->>cidade", city);
    if (state) query = query.eq("endereco_publico->>estado", z.string().trim().length(2).transform((v) => v.toUpperCase()).parse(state));
    if (url.searchParams.get("guests")) query = query.gte("capacidade", identifier(url.searchParams.get("guests")));
    const priceColumn = modality === "VENDA" ? "valor_venda" : modality === "LOCACAO" ? "valor_locacao" : "diaria";
    const minPrice = url.searchParams.get("minPrice"), maxPrice = url.searchParams.get("maxPrice");
    const priceSchema = z.coerce.number().finite().min(0).max(1e12);
    if (minPrice !== null) query = query.gte(priceColumn, priceSchema.parse(minPrice));
    if (maxPrice !== null) query = query.lte(priceColumn, priceSchema.parse(maxPrice));
    if (minPrice !== null && maxPrice !== null && Number(minPrice) > Number(maxPrice)) throw new ImobError(400, "Faixa de valores inválida.");
    // `amenity` repetido aceita nomes com vírgula; `amenities` separado por vírgula é o formato antigo do site.
    const requested = z.array(z.string().trim().min(1).max(120)).max(100).parse([
      ...url.searchParams.getAll("amenity"),
      ...(url.searchParams.get("amenities")?.split(",") ?? []),
    ].filter((value) => value.trim()));
    if (requested.length) {
      // Cada comodidade pedida casa com qualquer grafia equivalente cadastrada (maiúsculas, acentos, espaços).
      const groups = await publishedAmenities(inactiveOwners);
      for (const amenity of requested) {
        const variants = [...(groups.get(amenityKey(amenity))?.keys() ?? [amenity])];
        query = query.filter("comodidades", "ov", pgTextArray(variants));
      }
    }
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
      // Regras das tarifas do período, as mesmas da cotação (imob_cotar_reserva): o mínimo de noites
      // da tarifa e o pacote fechado (estadia inteira dentro da tarifa). Sem isso o imóvel aparece na
      // busca e só recusa a reserva depois que o hóspede escolhe.
      for (let offset = 0; ; offset += 1000) {
        const rules = await db.from("imovel_tarifa").select("id,imovel_id,inicio,fim,min_noites,reserva_exclusiva").eq("ativo", true).lt("inicio", end).gt("fim", start).order("id").range(offset, offset + 999);
        if (rules.error) throw rules.error;
        for (const tariff of rules.data) {
          if (Number(tariff.min_noites) > nights || (tariff.reserva_exclusiva && (start < tariff.inicio || end > tariff.fim))) unavailable.add(tariff.imovel_id);
        }
        if (rules.data.length < 1000) break;
      }
      if (unavailable.size) query = query.not("id", "in", `(${[...unavailable].join(",")})`);
    }
    const sort = url.searchParams.get("sort");
    query = sort === "price-asc" || sort === "price-desc" ? query.order(priceColumn, { ascending: sort === "price-asc" }) : sort === "guests" ? query.order("capacidade", { ascending: false }) : query.order("titulo");
    const result = await query.order("id").range(from, to);
    if (result.error) throw result.error;
    return json({ items: await publicFlats(result.data ?? []), total: result.count ?? 0, page, pageSize });
  }
  // Contatos de interesse (imóvel, visita, proprietário) vão direto ao WhatsApp pelo site; o ERP não os registra.
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
    // O proprietário vê uma linha por pagamento: ajustes de taxa e edições já vêm somados.
    const report = await financeReport({ proprietario_id: ownerId, ...(selectedId ? { imovel_id: selectedId } : {}) }, url, { consolidar: true });
    if (path[1] === "extratos" && method === "GET") {
      const publicReport = { items: report.items, totais: report.totais, periodo: report.periodo };
      return json({ ...publicReport, imoveis: properties.data.map((p) => ({ id: p.id, titulo: p.titulo })) });
    }
    if (path[1] === "dashboard" && method === "GET") {
      const current = hojeImobiliario();
      let reservationsQuery = db.from("reserva_imovel").select("id,imovel_id,cliente_id,inicio,fim,hospedes,status,valor_total,financeiro_status,created_at").eq("proprietario_id", ownerId);
      if (selectedId) reservationsQuery = reservationsQuery.eq("imovel_id", selectedId);
      const periodStart = url.searchParams.get("inicio"), periodEnd = url.searchParams.get("fim");
      if (periodStart) reservationsQuery = reservationsQuery.gt("fim", civilDate.parse(periodStart));
      if (periodEnd) reservationsQuery = reservationsQuery.lte("inicio", civilDate.parse(periodEnd));
      const [reservations, occupations] = await Promise.all([
        reservationsQuery.order("inicio", { ascending: false }).limit(300),
        selectedProperties.length ? db.from("imovel_ocupacao").select("id,imovel_id,tipo,inicio,fim,motivo").in("imovel_id", selectedProperties.map((p) => p.id)).eq("ativo", true).or(`fim.is.null,fim.gt.${current}`).limit(1000) : Promise.resolve({ data: [], error: null }),
      ]);
      if (reservations.error) throw reservations.error;
      if (occupations.error) throw occupations.error;
      const occupied = selectedProperties.filter((p) => !["DISPONIVEL", "EM_NEGOCIACAO"].includes(p.situacao_operacional)).length;
      const enrichedReservations = await enrich(reservations.data);
      return json({ occupancy: selectedProperties.length ? Math.round(occupied / selectedProperties.length * 100) : 0, revenue: report.totais.recebido, expenses: report.totais.despesas + report.totais.receita_administradora, payout: report.totais.saldo_repassar,
        // Campos novos (flatId, checkin...) são aditivos: o site antigo continua lendo period/flat.
        reservations: enrichedReservations.map((reservation) => {
          const booking = publicBooking(reservation);
          return { id: String(reservation.id), flat: reservation.imovel?.titulo ?? "Imóvel", period: `${reservation.inicio} a ${reservation.fim}`, amount: Number(reservation.valor_total), status: booking.status,
            flatId: String(reservation.imovel_id), checkin: reservation.inicio, checkout: reservation.fim, guests: Number(reservation.hospedes ?? 0), paymentStatus: booking.paymentStatus, createdAt: reservation.created_at ?? null,
            // Titular da reserva: só nome, contato e cidade. Documento (CPF/CNPJ) não sai para o proprietário.
            guest: reservation.cliente ? { name: reservation.cliente.nomerazaosocial ?? null, phone: reservation.cliente.telefone ?? null, email: reservation.cliente.email ?? null,
              city: reservation.cliente.cidade ?? null, state: reservation.cliente.estado ?? null } : null };
        }),
        maintenance: occupations.data.filter((o) => ["MANUTENCAO", "BLOQUEIO"].includes(o.tipo)).map((occupation) => ({ title: occupation.motivo ?? "Bloqueio do imóvel", status: occupation.tipo === "MANUTENCAO" ? "Manutenção" : "Bloqueio", amount: null })), ocupacoes: occupations.data, totais: report.totais, imoveis: await publicFlats(selectedProperties) });
    }
  }
  throw new ImobError(404, "Rota da conta não encontrada.");
}
