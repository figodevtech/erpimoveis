import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { db, identifier, ImobError, internal, internalAny, json, bodyOf, one, pagination, rpc, filterText } from "./server";
import { civilDate, imovelSchema, locacaoSchema, proprietarioSchema, reservaSchema, tarifaSchema, vendaImovelSchema, visitaSchema } from "./schemas";
import { activeOperations, deleteFile, enrich, filesFor, fileScope, fileUrl, publicationValid, removeStoredFiles, reorderGallery, uploadFile } from "./data";
import { cotacaoPublica, hojeImobiliario } from "./types";
import { financeAccess, financeReport, payCharge, scopeFromUrl, type FinanceScope } from "./finance";

const resources = {
  proprietarios: { table: "proprietario", perm: "proprietarios", schema: proprietarioSchema },
  imoveis: { table: "imovel", perm: "imoveis", schema: imovelSchema },
  reservas: { table: "reserva_imovel", perm: "reservas", schema: reservaSchema },
  "locacoes-imobiliarias": { table: "locacao_imovel", perm: "locacoes_imobiliarias", schema: locacaoSchema },
  "vendas-imobiliarias": { table: "venda_imovel", perm: "vendas_imobiliarias", schema: vendaImovelSchema },
} as const;
type Resource = keyof typeof resources;

async function list(resource: Resource, url: URL, extra: Record<string, unknown> = {}) {
  const config = resources[resource];
  const { page, pageSize, from, to } = pagination(url);
  let query = db.from(resource === "imoveis" ? "imovel_resumo" : config.table).select("*", { count: "exact" });
  for (const [key, val] of Object.entries(extra)) query = query.eq(key, val);
  const search = filterText(url.searchParams.get("q") ?? url.searchParams.get("busca") ?? url.searchParams.get("search"));
  if (search) {
    if (resource === "imoveis") {
      const idMatch = search.match(/^#?(\d+)$/);
      query = query.or(`titulo.ilike.%${search}%,codigo.ilike.%${search}%,slug.ilike.%${search}%,endereco_publico->>bairro.ilike.%${search}%,endereco_publico->>cidade.ilike.%${search}%${idMatch ? `,id.eq.${idMatch[1]}` : ""}`);
    }
    else if (resource === "proprietarios") {
      const idMatch = search.match(/^#?(\d+)$/);
      if (idMatch) {
        query = query.or(`id.eq.${idMatch[1]},nomerazaosocial.ilike.%${search}%,cpfcnpj.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%`);
      } else {
        query = query.or(`nomerazaosocial.ilike.%${search}%,cpfcnpj.ilike.%${search}%,email.ilike.%${search}%,telefone.ilike.%${search}%`);
      }
    }
    else if (/^\d+$/.test(search)) query = query.eq("id", Number(search));
    else {
      const clients = await db.from("cliente").select("id").ilike("nomerazaosocial", `%${search}%`).limit(200);
      if (clients.error) throw clients.error;
      query = query.in(resource === "vendas-imobiliarias" ? "comprador_id" : "cliente_id", clients.data.map((r) => r.id));
    }
  }
  for (const key of ["proprietario_id", "imovel_id", "cliente_id"]) if (url.searchParams.get(key)) query = query.eq(key, identifier(url.searchParams.get(key)));
  for (const key of ["ativo", "publicado"]) if (url.searchParams.has(key) && url.searchParams.get(key) !== "") query = query.eq(key, url.searchParams.get(key) === "true");
  const statusParam = url.searchParams.get("status");
  if (statusParam && statusParam !== "TODOS") {
    if (resource === "proprietarios") {
      query = query.eq("ativo", statusParam === "ATIVO");
    } else if (resource === "reservas" && (statusParam === "ABERTAS" || statusParam === "ATIVAS")) {
      query = query.in("status", ["CONFIRMADA", "EM_ANDAMENTO"]);
    } else if (resource === "reservas" && (statusParam === "FINALIZADAS" || statusParam === "ENCERRADAS")) {
      query = query.in("status", ["CONCLUIDA", "CANCELADA"]);
    } else if (statusParam.includes(",")) {
      query = query.in("status", statusParam.split(",").map((s) => s.trim()));
    } else {
      query = query.eq("status", statusParam);
    }
  }
  if (resource === "proprietarios") {
    const tipo = url.searchParams.get("tipopessoa");
    if (tipo && tipo !== "TODOS") query = query.eq("tipopessoa", tipo);
  }
  if (resource === "imoveis") {
    const modalidade = url.searchParams.get("modalidade"), situacao = url.searchParams.get("situacao");
    if (modalidade && modalidade !== "TODAS") query = query.contains("modalidades", [modalidade]);
    if (situacao && situacao !== "TODOS") query = query.eq("situacao_operacional", situacao);
    if (url.searchParams.get("cidade")) query = query.ilike("endereco_publico->>cidade", `%${filterText(url.searchParams.get("cidade"))}%`);
  }
  if (["reservas", "locacoes-imobiliarias"].includes(resource)) {
    const inicio = url.searchParams.get("inicio"), fim = url.searchParams.get("fim");
    if (inicio) { civilDate.parse(inicio); query = query.or(`fim.is.null,fim.gt.${inicio}`); }
    if (fim) { civilDate.parse(fim); query = query.lt("inicio", fim); }
  }
  const { data, count, error } = await query.order(resource === "proprietarios" ? "nomerazaosocial" : resource === "imoveis" ? "titulo" : "created_at", { ascending: ["proprietarios", "imoveis"].includes(resource) }).order("id").range(from, to);
  if (error) throw error;
  return { items: await enrich(data ?? []), total: count ?? 0, page, pageSize };
}

function stripPrivateFinance(items: Record<string, any>[], allowed: boolean) {
  if (allowed) return items;
  return items.map((item) => {
    const row = { ...item };
    for (const key of ["percentual_admin", "cotacao_snapshot", "beneficiario_futuro_id"]) delete row[key];
    return row;
  });
}

export async function customerReservations(request: Request, customerId: number) {
  await internal(PERMS.RESERVAS);
  const url = new URL(request.url);
  const result = await list("reservas", url, { cliente_id: customerId });
  const access = await internal(PERMS.RESERVAS);
  return json({ ...result, items: stripPrivateFinance(result.items, permissionSetHas(access.permissoes, PERMS.RESERVAS_FINANCEIRO)) });
}

/** Conta do site exibida e conferida no próprio cadastro do cliente; não existe fila separada. */
export async function customerSiteAccess(request: Request, customerId: number) {
  const account = async () => { const r = await db.from("site_usuario").select("user_id,email,status,motivo_pendencia,created_at,updated_at").eq("cliente_id", customerId).eq("tipo", "CLIENTE").maybeSingle(); if (r.error) throw r.error; return r.data; };
  const reply = async () => { const item = await account(); return json({ item: item && { email: item.email, status: item.status, motivo_pendencia: item.motivo_pendencia, created_at: item.created_at, updated_at: item.updated_at } }); };
  if (request.method === "GET") { await internal(PERMS.CLIENTES); return reply(); }
  if (request.method !== "POST") throw new ImobError(405, "Método não suportado.");
  const access = await internal(PERMS.CLIENTES_EDITAR); const action = String((await bodyOf(request)).acao ?? "").toUpperCase(); const current = await account();
  if (!current) throw new ImobError(404, "Este cliente não possui conta no site.");
  if (action === "LIBERAR") await rpc("imob_liberar_cadastro_site", { p_cliente_id: customerId, p_actor: access.id });
  else if (action === "BLOQUEAR") { const r = await db.from("site_usuario").update({ status: "BLOQUEADO", motivo_pendencia: "BLOQUEADO_PELO_ERP", updated_at: new Date().toISOString() }).eq("user_id", current.user_id); if (r.error) throw r.error; }
  else if (action === "DESBLOQUEAR") {
    if (current.status !== "BLOQUEADO") throw new ImobError(409, "A conta do site não está bloqueada.");
    const r = await db.from("site_usuario").update({ status: "PENDENTE", motivo_pendencia: null, updated_at: new Date().toISOString() }).eq("user_id", current.user_id); if (r.error) throw r.error;
    await rpc("imob_sincronizar_cliente_site", { p_auth_id: current.user_id });
  } else throw new ImobError(400, "Ação de acesso inválida.");
  return reply();
}

async function ownerAccess(request: Request, id: number, actor: string) {
  const owner = await one("proprietario", id);
  const body = await bodyOf(request);
  const action = String(body.acao ?? "").toUpperCase();
  const { data: existing, error } = await db.from("site_usuario").select("*").eq("proprietario_id", id).maybeSingle();
  if (error) throw error;
  if (["BLOQUEAR", "REVOGAR"].includes(action)) {
    if (!existing) throw new ImobError(404, "O proprietário ainda não tem acesso.");
    const updated = await db.from("site_usuario").update({ status: "BLOQUEADO", motivo_pendencia: action === "REVOGAR" ? "REVOGADO_PELO_ERP" : "BLOQUEADO_PELO_ERP", updated_at: new Date().toISOString() }).eq("user_id", existing.user_id).select().single();
    if (updated.error) throw updated.error;
    return json({ item: updated.data });
  }
  if (!["CRIAR", "REENVIAR", "DESBLOQUEAR"].includes(action)) throw new ImobError(400, "Ação de acesso inválida.");
  if (!owner.ativo) throw new ImobError(409, "Ative o proprietário antes de conceder acesso.");
  const email = z.string().trim().email().transform((v) => v.toLowerCase()).parse(body.email ?? existing?.email ?? owner.email);
  if (existing && existing.email !== email) throw new ImobError(409, "Revise o vínculo existente antes de alterar o e-mail de acesso.");
  const redirectTo = `${(process.env.SITE_URL ?? "http://localhost:3001").replace(/\/$/, "")}/auth/confirm?next=/definir-senha`;
  if (existing) {
    const authUser = await db.auth.admin.getUserById(existing.user_id);
    if (authUser.error || !authUser.data.user) throw new ImobError(409, "A identidade do convite não foi encontrada.");
    if (action === "DESBLOQUEAR") {
      const result = await db.from("site_usuario").update({ status: authUser.data.user.email_confirmed_at ? "ATIVO" : "PENDENTE", motivo_pendencia: null, updated_at: new Date().toISOString() }).eq("user_id", existing.user_id).select().single();
      if (result.error) throw result.error;
      return json({ item: result.data });
    }
    const sent = await db.auth.resetPasswordForEmail(email, { redirectTo });
    if (sent.error) throw new ImobError(502, "Não foi possível reenviar o e-mail de ativação. Confira o serviço de e-mail.");
    return json({ item: existing, inviteSent: true });
  }
  const conflict = await db.from("site_usuario").select("user_id").eq("email", email).maybeSingle();
  if (conflict.error) throw conflict.error;
  if (conflict.data) throw new ImobError(409, "Use um e-mail exclusivo para a conta de proprietário.");
  const invited = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: { nome: owner.nomerazaosocial, origem: "CONVITE_ERP" } });
  if (invited.error || !invited.data.user) throw new ImobError(409, invited.error?.message.includes("registered") ? "Este e-mail já está em uso. Use outro e-mail exclusivo para o proprietário." : "Não foi possível enviar o convite. Confira o e-mail e a configuração de envio.");
  const userId = invited.data.user.id;
  const linked = await db.from("proprietario").update({ user_id: userId, updated_by: actor }).eq("id", id);
  if (linked.error) { await db.auth.admin.deleteUser(userId); throw linked.error; }
  const account = await db.from("site_usuario").insert({ user_id: userId, tipo: "PROPRIETARIO", proprietario_id: id, email, status: "PENDENTE", motivo_pendencia: "CONVITE_ENVIADO", created_by: actor }).select().single();
  if (account.error) { await db.from("proprietario").update({ user_id: null }).eq("id", id); await db.auth.admin.deleteUser(userId); throw account.error; }
  return json({ item: account.data, inviteSent: true }, 201);
}

async function statusCounter(resource: Resource) {
  if (resource === "proprietarios") {
    const [total, ativos, inativos] = await Promise.all([
      db.from("proprietario").select("*", { count: "exact", head: true }),
      db.from("proprietario").select("*", { count: "exact", head: true }).eq("ativo", true),
      db.from("proprietario").select("*", { count: "exact", head: true }).eq("ativo", false),
    ]);
    return {
      total: total.count ?? 0,
      countsByStatus: {
        ATIVO: ativos.count ?? 0,
        INATIVO: inativos.count ?? 0,
      },
    };
  }

  if (resource === "imoveis") {
    const [total, disponiveis, reservados, alugados, outros] = await Promise.all([
      db.from("imovel").select("*", { count: "exact", head: true }),
      db.from("imovel_resumo").select("*", { count: "exact", head: true }).eq("situacao_operacional", "DISPONIVEL"),
      db.from("imovel_resumo").select("*", { count: "exact", head: true }).eq("situacao_operacional", "RESERVADO"),
      db.from("imovel_resumo").select("*", { count: "exact", head: true }).eq("situacao_operacional", "ALUGADO"),
      db.from("imovel_resumo").select("*", { count: "exact", head: true }).not("situacao_operacional", "in", '("DISPONIVEL","RESERVADO","ALUGADO")'),
    ]);
    const ocupados = (total.count ?? 0) - (disponiveis.count ?? 0);
    return {
      total: total.count ?? 0,
      disponiveis: disponiveis.count ?? 0,
      ocupados,
      countsByStatus: {
        DISPONIVEL: disponiveis.count ?? 0,
        RESERVADO: reservados.count ?? 0,
        ALUGADO: alugados.count ?? 0,
        OUTROS: outros.count ?? 0,
      },
    };
  }

  if (resource === "reservas") {
    const [total, confirmadas, emAndamento, concluidas, canceladas] = await Promise.all([
      db.from("reserva_imovel").select("*", { count: "exact", head: true }),
      db.from("reserva_imovel").select("*", { count: "exact", head: true }).eq("status", "CONFIRMADA"),
      db.from("reserva_imovel").select("*", { count: "exact", head: true }).eq("status", "EM_ANDAMENTO"),
      db.from("reserva_imovel").select("*", { count: "exact", head: true }).eq("status", "CONCLUIDA"),
      db.from("reserva_imovel").select("*", { count: "exact", head: true }).eq("status", "CANCELADA"),
    ]);
    const ativas = (confirmadas.count ?? 0) + (emAndamento.count ?? 0);
    const finalizadas = (concluidas.count ?? 0) + (canceladas.count ?? 0);
    return {
      total: total.count ?? 0,
      ativas,
      finalizadas,
      countsByStatus: {
        CONFIRMADA: confirmadas.count ?? 0,
        EM_ANDAMENTO: emAndamento.count ?? 0,
        CONCLUIDA: concluidas.count ?? 0,
        CANCELADA: canceladas.count ?? 0,
      },
    };
  }

  return { total: 0, countsByStatus: {} };
}

export async function internalResource(request: Request, resource: Resource, path: string[]) {
  const config = resources[resource];
  const url = new URL(request.url), method = request.method;
  const access = await internal(`${config.perm}:visualizar`);
  if (path[0] === "status-counter" && method === "GET") {
    return json(await statusCounter(resource));
  }
  const id = path[0] ? identifier(path[0]) : null;
  const segment = path[1];
  if (!id && method === "GET") return json(await list(resource, url));
  if (id && segment === "acesso" && resource === "proprietarios") {
    await internal(PERMS.PROPRIETARIOS_ACESSO_PORTAL);
    if (method === "GET") {
      const result = await db.from("site_usuario").select("user_id,email,status,motivo_pendencia,created_at,updated_at").eq("proprietario_id", id).maybeSingle();
      if (result.error) throw result.error;
      return json({ item: result.data });
    }
    if (method === "POST") return ownerAccess(request, id, access.id);
  }
  if (id && segment === "relacionamento" && resource === "proprietarios" && method === "GET") {
    const tab = url.searchParams.get("tab");
    if (tab === "financeiro") { await internal(PERMS.PROPRIETARIOS_FINANCEIRO); return json(await financeReport({ proprietario_id: id }, url)); }
    if (tab === "imoveis") { await internal(PERMS.IMOVEIS); return json(await list("imoveis", url, { proprietario_id: id })); }
    if (tab === "reservas") {
      await internal(PERMS.RESERVAS);
      // Histórico segue o beneficiário da operação; imóveis atuais têm consulta própria.
      return json(await list("reservas", url, { proprietario_id: id }));
    }
    throw new ImobError(400, "Aba inválida.");
  }
  if (id && segment === "arquivos") {
    const scope = await fileScope(resource, id);
    if (method === "GET" && path[2]) return json({ url: await fileUrl(scope, path[2], url.searchParams.get("download") === "1") });
    if (method === "GET") {
      const tipo = url.searchParams.get("tipo")?.toUpperCase();
      if (tipo && !["FOTO", "DOCUMENTO"].includes(tipo)) throw new ImobError(400, "Tipo de arquivo inválido.");
      return json({ items: await filesFor(tipo ? { ...scope, tipo } : scope) });
    }
    await internal(`${config.perm}:editar`);
    if (method === "POST") return json({ item: await uploadFile(request, scope, access.id) }, 201);
    if (method === "PATCH" && resource === "imoveis" && !path[2]) {
      const { ids } = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(500) }).parse(await bodyOf(request));
      return json({ items: await reorderGallery(id, ids, access.id) });
    }
    if (method === "DELETE") { await deleteFile(scope, path[2] ?? url.searchParams.get("id")); return json({ ok: true }); }
  }
  if (id && resource === "imoveis") {
    const property = await one("imovel", id);
    if (segment === "cotacao" && method === "GET") {
      await internal(PERMS.RESERVAS_CRIAR);
      const quote = await rpc("imob_cotar_reserva", { p_imovel_id: id, p_inicio: civilDate.parse(url.searchParams.get("inicio")), p_fim: civilDate.parse(url.searchParams.get("fim")), p_hospedes: identifier(url.searchParams.get("hospedes")) });
      return json({ ...cotacaoPublica(quote), ...quote });
    }
    if (segment === "disponibilidade" && method === "GET") {
      let query = db.from("imovel_ocupacao").select("*").eq("imovel_id", id).eq("ativo", true).order("inicio");
      if (url.searchParams.get("inicio")) query = query.or(`fim.is.null,fim.gt.${civilDate.parse(url.searchParams.get("inicio"))}`);
      if (url.searchParams.get("fim")) query = query.lt("inicio", civilDate.parse(url.searchParams.get("fim")));
      const result = await query;
      if (result.error) throw result.error;
      return json({ items: result.data.map((r) => ({ ...r, operacao_id: r.reserva_id ?? r.locacao_id ?? r.id })) });
    }
    if (segment === "tarifas") {
      if (method === "GET") { const r = await db.from("imovel_tarifa").select("*").eq("imovel_id", id).order("inicio"); if (r.error) throw r.error; return json({ items: r.data }); }
      await internal(PERMS.IMOVEIS_EDITAR);
      if (method === "POST") { const data = tarifaSchema.parse(await bodyOf(request)); const r = await db.from("imovel_tarifa").insert({ ...data, imovel_id: id, created_by: access.id }).select().single(); if (r.error) throw r.error; return json({ item: r.data }, 201); }
      if (method === "DELETE") { const r = await db.from("imovel_tarifa").delete().eq("imovel_id", id).eq("id", identifier(path[2] ?? url.searchParams.get("id"))); if (r.error) throw r.error; return json({ ok: true }); }
    }
    if (segment === "bloqueios") {
      await internal(PERMS.IMOVEIS_EDITAR);
      if (method === "POST") {
        const body = z.object({ inicio: civilDate, fim: civilDate, motivo: z.string().trim().min(3).max(2000), tipo: z.enum(["BLOQUEIO", "MANUTENCAO"]).default("BLOQUEIO") }).refine((r) => r.fim > r.inicio).parse(await bodyOf(request));
        const result = await db.from("imovel_ocupacao").insert({ ...body, imovel_id: id, created_by: access.id }).select().single();
        if (result.error) throw result.error;
        return json({ item: result.data }, 201);
      }
      if (method === "DELETE") {
        const result = await db.from("imovel_ocupacao").update({ ativo: false, updated_at: new Date().toISOString() }).eq("id", identifier(path[2] ?? url.searchParams.get("id"))).eq("imovel_id", id).in("tipo", ["BLOQUEIO", "MANUTENCAO"]).select().maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new ImobError(404, "Bloqueio não encontrado.");
        return json({ item: result.data });
      }
    }
    if (segment === "publicacao" && ["POST", "PATCH"].includes(method)) {
      await internal(PERMS.IMOVEIS_PUBLICAR);
      const { publicado } = z.object({ publicado: z.boolean() }).parse(await bodyOf(request));
      await publicationValid({ ...property, publicado }, id);
      const result = await db.from("imovel").update({ publicado, updated_by: access.id }).eq("id", id).select().single();
      if (result.error) throw result.error;
      return json({ item: result.data });
    }
    if (["reservas", "locacoes", "vendas", "visitas"].includes(segment ?? "") && method === "GET") {
      if (segment === "visitas") return visits(request, [], { imovel_id: id });
      const linked = ({ reservas: "reservas", locacoes: "locacoes-imobiliarias", vendas: "vendas-imobiliarias" } as const)[segment as "reservas" | "locacoes" | "vendas"];
      await internal(`${resources[linked].perm}:visualizar`);
      return json(await list(linked, url, { imovel_id: id }));
    }
  }
  if (id && segment === "acoes" && method === "POST" && !["imoveis", "proprietarios"].includes(resource)) {
    const body = await bodyOf(request); const action = String(body.acao ?? "").toUpperCase();
    const actionPerm = resource === "reservas" ? (["CHECKIN", "CHECKOUT"].includes(action) ? "checkin_checkout" : action === "CANCELAR" ? "cancelar" : "confirmar") : resource === "vendas-imobiliarias" ? (action === "CONCLUIR" ? "concluir" : "cancelar") : action === "CANCELAR" || action === "ENCERRAR" ? "cancelar" : "editar";
    await internal(`${config.perm}:${actionPerm}`);
    if (resource === "locacoes-imobiliarias" && action === "GERAR_COBRANCAS") await internal(PERMS.LOCACOES_IMOBILIARIAS_FINANCEIRO);
    if (resource === "locacoes-imobiliarias" && action === "REAJUSTAR" && body.valor_mensal == null) {
      const contract = await one(config.table, id);
      const percentage = z.coerce.number().finite().min(-99).max(1000).parse(body.percentual);
      body.valor_mensal = Math.round(Number(contract.valor_mensal) * (1 + percentage / 100) * 100) / 100;
    }
    body.tratamento_financeiro = body.tratamento_recebidos ?? body.tratamento_financeiro;
    const name = resource === "reservas" ? "imob_acao_reserva" : resource === "locacoes-imobiliarias" ? "imob_acao_locacao" : "imob_acao_venda";
    return json({ item: await rpc(name, { p_id: id, p_acao: action, p_payload: body, p_actor: access.id }) });
  }
  if (id && !segment && method === "GET") {
    const item = await one(resource === "imoveis" ? "imovel_resumo" : config.table, id);
    const [enriched] = await enrich([item]);
    const relacionamentos: Record<string, unknown> = {};
    if (resource === "vendas-imobiliarias") relacionamentos.operacoes = await activeOperations(item.imovel_id, item.data_venda);
    if (resource === "proprietarios" && permissionSetHas(access.permissoes, PERMS.PROPRIETARIOS_ACESSO_PORTAL)) {
      const account = await db.from("site_usuario").select("user_id,email,status,motivo_pendencia,created_at,updated_at").eq("proprietario_id", id).maybeSingle();
      if (account.error) throw account.error;
      relacionamentos.acesso = account.data;
    }
    return json({ item: enriched, relacionamentos });
  }
  if (!segment && (method === "POST" && !id || method === "PATCH" && id)) {
    const body = await bodyOf(request);
    const publicationOnly = resource === "imoveis" && id && Object.keys(body).every((k) => ["publicado", "slug", "endereco_publico", "selo_anuncio", "fotos_reais"].includes(k));
    await internal(publicationOnly ? PERMS.IMOVEIS_PUBLICAR : `${config.perm}:${id ? "editar" : "criar"}`);
    const previous = id ? await one(config.table, id) : {};
    if (resource === "imoveis" && (id ? body.publicado !== undefined && body.publicado !== previous.publicado : body.publicado === true)) await internal(PERMS.IMOVEIS_PUBLICAR);
    for (const k of ["email", "estado", "fim", "proximo_reajuste", "indice_reajuste", "responsavel_id"]) if (body[k] === "") body[k] = null;
    if (resource === "imoveis" && !id && !body.slug) body.slug = `${body.titulo ?? "imovel"}-${body.codigo ?? randomUUID().slice(0, 8)}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 180);
    const data = config.schema.parse({ ...previous, ...body, ...(resource === "reservas" ? { idempotency_key: body.idempotency_key ?? previous.idempotency_key ?? randomUUID(), origem: "ERP" } : {}) }) as Record<string, any>;
    if (resource === "proprietarios") data.cpfcnpj = data.cpfcnpj.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (resource === "imoveis") await publicationValid(data, id ?? undefined);
    if (["proprietarios", "imoveis"].includes(resource)) {
      const query = id ? db.from(config.table).update({ ...data, updated_by: access.id }).eq("id", id) : db.from(config.table).insert({ ...data, created_by: access.id });
      const result = await query.select().single();
      if (result.error) throw result.error;
      return json({ item: result.data }, id ? 200 : 201);
    }
    const name = resource === "reservas" ? "imob_salvar_reserva" : resource === "locacoes-imobiliarias" ? "imob_salvar_locacao" : "imob_salvar_venda";
    data.idempotency_key = body.idempotency_key ?? previous.idempotency_key ?? randomUUID();
    return json({ item: await rpc(name, { p_payload: data, p_actor: access.id, p_id: id }) }, id ? 200 : 201);
  }
  if (id && !segment && method === "DELETE") {
    await internal(`${config.perm}:excluir`);
    const row = await one(config.table, id);
    if (!["imoveis", "proprietarios"].includes(resource)) throw new ImobError(409, "Operações com histórico devem ser canceladas pela ação correspondente.");
    if (resource === "proprietarios" && row.user_id) throw new ImobError(409, "Bloqueie ou revogue o acesso e inative este proprietário.");
    if (resource === "imoveis") {
      // O banco decide no ato: sem reserva, locação, venda nem financeiro, exclui de vez.
      const outcome = await rpc("imob_excluir_imovel", { p_id: id, p_actor: access.id });
      if (outcome.excluido) await removeStoredFiles(outcome.arquivos ?? []);
      return json(outcome);
    }
    const result = await db.from(config.table).delete().eq("id", id);
    if (result.error?.code === "23503") {
      const inactive = await db.from(config.table).update({ ativo: false, updated_by: access.id }).eq("id", id).select().single();
      if (inactive.error) throw inactive.error;
      return json({ item: inactive.data, inativado: true });
    }
    if (result.error) throw result.error;
    return json({ ok: true });
  }
  throw new ImobError(404, "Rota imobiliária não encontrada.");
}

async function visits(request: Request, path: string[], extra: Record<string, unknown> = {}) {
  const write = request.method !== "GET";
  const access = await internal(write ? PERMS.IMOVEIS_EDITAR : PERMS.IMOVEIS);
  const table = "imovel_visita", schema = visitaSchema;
  const url = new URL(request.url), id = path[0] ? identifier(path[0]) : null;
  if (request.method === "GET") {
    if (id) return json({ item: await one(table, id) });
    const pg = pagination(url); let query = db.from(table).select("*", { count: "exact" });
    for (const [k, v] of Object.entries(extra)) query = query.eq(k, v);
    if (url.searchParams.get("imovel_id")) query = query.eq("imovel_id", identifier(url.searchParams.get("imovel_id")));
    if (url.searchParams.get("status")) query = query.eq("status", url.searchParams.get("status"));
    const result = await query.order("created_at", { ascending: false }).range(pg.from, pg.to);
    if (result.error) throw result.error;
    return json({ items: await enrich(result.data ?? []), total: result.count ?? 0, page: pg.page, pageSize: pg.pageSize });
  }
  if (["POST", "PATCH"].includes(request.method)) {
    const previous = id ? await one(table, id) : {};
    const data = schema.parse({ ...previous, ...await bodyOf(request), ...extra });
    const result = await (id ? db.from(table).update({ ...data, updated_at: new Date().toISOString() }).eq("id", id) : db.from(table).insert({ ...data, created_by: access.id })).select().single();
    if (result.error) throw result.error;
    return json({ item: result.data }, id ? 200 : 201);
  }
  throw new ImobError(405, "Método não permitido.");
}

export async function internalShared(request: Request, path: string[]) {
  const url = new URL(request.url), method = request.method;
  if (path[0] === "visitas") return visits(request, path.slice(1));
  if (path[0] === "lookup" && method === "GET") {
    const type = url.searchParams.get("tipo");
    await internalAny(type === "bancos" ? [PERMS.FINANCEIRO, PERMS.PROPRIETARIOS_FINANCEIRO, PERMS.IMOVEIS_FINANCEIRO, PERMS.RESERVAS_FINANCEIRO, PERMS.LOCACOES_IMOBILIARIAS_FINANCEIRO, PERMS.VENDAS_IMOBILIARIAS_FINANCEIRO] : type === "proprietarios" ? [PERMS.PROPRIETARIOS, PERMS.IMOVEIS_CRIAR, PERMS.IMOVEIS_EDITAR, PERMS.VENDAS_IMOBILIARIAS_CONCLUIR] : type === "imoveis" ? [PERMS.IMOVEIS, PERMS.RESERVAS_CRIAR, PERMS.RESERVAS_EDITAR, PERMS.LOCACOES_IMOBILIARIAS_CRIAR, PERMS.VENDAS_IMOBILIARIAS_CRIAR, PERMS.PROPRIETARIOS_FINANCEIRO] : [PERMS.CLIENTES, PERMS.RESERVAS_CRIAR, PERMS.LOCACOES_IMOBILIARIAS_CRIAR, PERMS.VENDAS_IMOBILIARIAS_CRIAR]);
    const table = ({ clientes: "cliente", proprietarios: "proprietario", imoveis: "imovel", bancos: "bancoconta" } as Record<string, string>)[String(type)];
    if (!table) throw new ImobError(400, "Consulta inválida.");
    const fields = table === "cliente" ? "id,nomerazaosocial,cpfcnpj" : table === "proprietario" ? "id,nomerazaosocial,cpfcnpj,percentual_admin" : table === "imovel" ? "id,titulo,codigo,modalidades,capacidade,diaria,valor_locacao,valor_venda,percentual_admin,proprietario_id" : "id,titulo";
    let query = db.from(table).select(fields);
    if (table === "cliente") query = query.eq("is_deleted", false);
    if (["imovel", "proprietario"].includes(table)) query = query.eq("ativo", true);
    const term = filterText(url.searchParams.get("q") ?? url.searchParams.get("search"));
    if (term) query = ["cliente", "proprietario"].includes(table) ? query.or(`nomerazaosocial.ilike.%${term}%,cpfcnpj.ilike.%${term}%`) : table === "imovel" ? query.or(`titulo.ilike.%${term}%,codigo.ilike.%${term}%${/^\d+$/.test(term) ? `,id.eq.${term}` : ""}`) : query.ilike("titulo", `%${term}%`);
    const result = await query.order(["imovel", "bancoconta"].includes(table) ? "titulo" : "nomerazaosocial").limit(50);
    if (result.error) throw result.error;
    if (url.searchParams.get("id")) {
      const id = identifier(url.searchParams.get("id"));
      if (!result.data?.some((item: any) => item.id === id)) {
        const selected = await db.from(table).select(fields).eq("id", id).maybeSingle();
        if (selected.error) throw selected.error;
        if (selected.data) result.data?.unshift(selected.data);
      }
    }
    return json({ items: result.data });
  }
  if (path[0] === "financeiro") {
    const scope = scopeFromUrl(url);
    if (method === "GET") { await financeAccess(scope); return json(await financeReport(scope, url)); }
    if (method === "POST") {
      const body = await bodyOf(request);
      const actual: FinanceScope = {};
      for (const k of ["imovel_id", "proprietario_id", "reserva_id", "locacao_id", "venda_id"] as const) if (body[k]) actual[k] = identifier(body[k]);
      const access = await financeAccess(actual, true);
      if (!["DESPESA", "REPASSE"].includes(body.tipo)) throw new ImobError(400, "Tipo de movimento inválido.");
      if (actual.reserva_id || actual.locacao_id || actual.venda_id) {
        const source = await one(actual.reserva_id ? "reserva_imovel" : actual.locacao_id ? "locacao_imovel" : "venda_imovel", actual.reserva_id ?? actual.locacao_id ?? actual.venda_id!);
        actual.imovel_id = source.imovel_id; actual.proprietario_id = source.proprietario_id;
      }
      if (!actual.imovel_id) throw new ImobError(400, "Selecione o imóvel para vincular o movimento.");
      if (!actual.proprietario_id) actual.proprietario_id = (await one("imovel", actual.imovel_id)).proprietario_id;
      const day = civilDate.parse(body.data ?? hojeImobiliario());
      return json({ item: await rpc("imob_registrar_repasse", { p_payload: { ...body, ...actual, vencimento: day, pago_em: `${day}T12:00:00-03:00`, metodopagamento: body.metodo_pagamento ?? body.metodopagamento, idempotency_key: body.idempotency_key ?? randomUUID() }, p_actor: access.id }) }, 201);
    }
  }
  if (path[0] === "cobrancas" && path[2] === "baixar" && method === "POST") {
    const id = identifier(path[1]), row = await one("transacao", id);
    const scope: FinanceScope = row.reserva_imovel_id ? { reserva_id: row.reserva_imovel_id } : row.locacao_imovel_id ? { locacao_id: row.locacao_imovel_id } : row.venda_imovel_id ? { venda_id: row.venda_imovel_id } : { imovel_id: row.imovel_id };
    const access = await financeAccess(scope, "pay");
    return json({ item: await payCharge(id, await bodyOf(request), access.id) });
  }
  throw new ImobError(404, "Rota imobiliária não encontrada.");
}
