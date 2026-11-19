import "server-only";
import { z } from "zod";
import { getCurrentUserAccess } from "@/app/api/_authz/perms";
import { PERMS, permissionSetHas, type Permission } from "@/app/api/_authz/permission-constants";
import { bodyOf, db, identifier, ImobError, json, one, pagination, rpc } from "./server";
import { enrich } from "./data";
import { hojeImobiliario } from "./types";

/**
 * Limpezas pedidas no check-out (imovel_limpeza, 20261118120000), na página Execução.
 *
 * Qualquer usuário ativo vê as limpezas sob a responsabilidade dele. Quem tem
 * limpezas:gerenciar vê todas (inclusive sem responsável), reatribui e conclui. Quem edita
 * imóveis também conclui, como no botão do cadastro do imóvel.
 */

// O imóvel (título, endereço e foto de capa) vem de `enrich`, como nas listas de imóveis e reservas.
const LIMPEZA_SELECT = [
  "id,imovel_id,reserva_id,responsavel_id,descricao,status,solicitada_em,concluida_em,observacoes,updated_at",
  "reserva:reserva_id(id,inicio,fim,checkout_em,hospedes,cliente:cliente_id(id,nomerazaosocial))",
  "responsavel:responsavel_id(id,nome,email)",
  "solicitante:solicitada_por(id,nome)",
  "concluinte:concluida_por(id,nome)",
].join(",");

const uuidOuNulo = z.union([z.string().uuid(), z.literal(""), z.null()]).transform((v) => v || null);

async function sessao() {
  const access = await getCurrentUserAccess();
  if (!access?.ativo) throw new ImobError(401, "Entre no ERP para continuar.");
  const pode = (perm: Permission) => permissionSetHas(access.permissoes, perm);
  return { id: access.id as string, gerencia: pode(PERMS.LIMPEZAS_GERENCIAR), editaImoveis: pode(PERMS.IMOVEIS_EDITAR) };
}

type Sessao = Awaited<ReturnType<typeof sessao>>;

async function listar(url: URL, usuario: Sessao) {
  const { page, pageSize, from, to } = pagination(url);
  const status = (url.searchParams.get("status") ?? "PENDENTE").toUpperCase();
  if (!["PENDENTE", "CONCLUIDA"].includes(status)) throw new ImobError(400, "Situação de limpeza inválida.");
  // Sem a permissão de gerenciar, o escopo é sempre o das próprias limpezas.
  const pedido = (url.searchParams.get("escopo") ?? "minhas").toLowerCase();
  const escopo = usuario.gerencia && ["todas", "sem_responsavel"].includes(pedido) ? pedido : "minhas";

  let query = db.from("imovel_limpeza").select(LIMPEZA_SELECT, { count: "exact" }).eq("status", status);
  if (escopo === "minhas") query = query.eq("responsavel_id", usuario.id);
  if (escopo === "sem_responsavel") query = query.is("responsavel_id", null);
  // Pendentes: a mais antiga primeiro. Concluídas: as mais recentes.
  query = status === "PENDENTE"
    ? query.order("solicitada_em", { ascending: true })
    : query.order("concluida_em", { ascending: false });
  const { data, count, error } = await query.order("id").range(from, to);
  if (error) throw error;
  return {
    items: await montarItens(data),
    total: count ?? 0,
    page,
    pageSize,
    escopo,
    podeGerenciar: usuario.gerencia,
  };
}

/** Imóvel (foto, endereço) e próximo check-in de cada limpeza, como a Execução e a aba Serviços mostram. */
async function montarItens(data: unknown[] | null) {
  const items = await enrich((data ?? []) as unknown as Record<string, any>[]);
  const proximos = await proximosCheckins(items.map((item) => Number(item.imovel_id)));
  return items.map((item) => ({ ...item, proximo_checkin: proximos.get(Number(item.imovel_id)) ?? null }));
}

/**
 * Aba Serviços do cadastro do imóvel: todas as limpezas dele (pendentes, concluídas e canceladas),
 * das mais recentes para as mais antigas. Quem vê o imóvel vê o histórico; agir sobre cada uma
 * segue as regras de concluir/reabrir/atribuir.
 */
export async function servicosDoImovel(imovelId: number, url: URL) {
  const { page, pageSize, from, to } = pagination(url);
  const status = (url.searchParams.get("status") ?? "TODOS").toUpperCase();
  if (!["TODOS", "PENDENTE", "CONCLUIDA", "CANCELADA"].includes(status)) throw new ImobError(400, "Situação de serviço inválida.");
  let query = db.from("imovel_limpeza").select(LIMPEZA_SELECT, { count: "exact" }).eq("imovel_id", imovelId);
  if (status !== "TODOS") query = query.eq("status", status);
  const { data, count, error } = await query.order("solicitada_em", { ascending: false }).order("id", { ascending: false }).range(from, to);
  // Sem a migration da limpeza, o imóvel simplesmente não tem serviços.
  if (error && ["42P01", "PGRST205"].includes(String(error.code))) return { items: [], total: 0, page, pageSize };
  if (error) throw error;
  return { items: await montarItens(data), total: count ?? 0, page, pageSize };
}

/**
 * Próxima entrada de cada imóvel: a reserva confirmada (ainda sem check-in) que começa primeiro,
 * entre as que não terminaram. Uma entrada prevista que já passou continua sendo a próxima: o
 * hóspede pode estar chegando com o imóvel ainda por limpar.
 */
async function proximosCheckins(imovelIds: number[]) {
  const proximos = new Map<number, { reserva_id: number; inicio: string; horario_checkin: string | null; hospedes: number; hospede: string | null }>();
  const ids = [...new Set(imovelIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return proximos;
  const { data, error } = await db
    .from("reserva_imovel")
    .select("id,imovel_id,inicio,horario_checkin,hospedes,cliente:cliente_id(nomerazaosocial)")
    .in("imovel_id", ids)
    .eq("status", "CONFIRMADA")
    .gt("fim", hojeImobiliario())
    .order("inicio")
    .order("horario_checkin")
    .order("id");
  if (error) throw error;
  for (const row of (data ?? []) as Record<string, any>[]) {
    const imovelId = Number(row.imovel_id);
    if (proximos.has(imovelId)) continue;
    proximos.set(imovelId, {
      reserva_id: Number(row.id),
      inicio: String(row.inicio),
      horario_checkin: row.horario_checkin ? String(row.horario_checkin).slice(0, 5) : null,
      hospedes: Number(row.hospedes ?? 1),
      hospede: row.cliente?.nomerazaosocial ?? null,
    });
  }
  return proximos;
}

async function concluir(id: number, body: Record<string, unknown>, usuario: Sessao) {
  const limpeza = await one("imovel_limpeza", id, "id,responsavel_id");
  if (limpeza.responsavel_id !== usuario.id && !usuario.gerencia && !usuario.editaImoveis) {
    throw new ImobError(403, "Só o responsável ou quem gerencia limpezas pode concluir esta limpeza.");
  }
  const observacoes = typeof body.observacoes === "string" ? body.observacoes.trim().slice(0, 2000) : "";
  return rpc("imob_acao_limpeza", { p_id: id, p_acao: "CONCLUIR", p_payload: { observacoes }, p_actor: usuario.id });
}

// Só o que vier muda: um campo ausente fica como está (imob_acao_limpeza, ação EDITAR).
const edicaoSchema = z.object({
  descricao: z.string().trim().max(500, "A descrição da limpeza deve ter até 500 caracteres.").nullable().optional(),
  responsavel_id: uuidOuNulo.optional(),
  observacoes: z.string().trim().max(2000, "As observações da conclusão devem ter até 2000 caracteres.").nullable().optional(),
  data_conclusao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data da conclusão inválida.").optional(),
  hora_conclusao: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora da conclusão inválida.").optional(),
});

/** Editar os dados do serviço (aba Serviços do imóvel): quem edita imóveis ou gerencia limpezas. */
async function editar(id: number, body: Record<string, unknown>, usuario: Sessao) {
  if (!usuario.gerencia && !usuario.editaImoveis) throw new ImobError(403, "Você não tem permissão para editar este serviço.");
  const dados = edicaoSchema.parse(body);
  if (dados.data_conclusao && !dados.hora_conclusao) throw new ImobError(400, "Informe a hora da conclusão.");
  const payload = Object.fromEntries(Object.entries(dados).filter(([, valor]) => valor !== undefined));
  return rpc("imob_acao_limpeza", { p_id: id, p_acao: "EDITAR", p_payload: payload, p_actor: usuario.id });
}

/** "Voltar para pendente": quem concluiria a limpeza também pode reabri-la. */
async function reabrir(id: number, usuario: Sessao) {
  const limpeza = await one("imovel_limpeza", id, "id,responsavel_id");
  if (limpeza.responsavel_id !== usuario.id && !usuario.gerencia && !usuario.editaImoveis) {
    throw new ImobError(403, "Só o responsável, quem gerencia limpezas ou quem edita imóveis pode reabrir esta limpeza.");
  }
  return rpc("imob_acao_limpeza", { p_id: id, p_acao: "REABRIR", p_payload: {}, p_actor: usuario.id });
}

async function atribuir(id: number, body: Record<string, unknown>, usuario: Sessao) {
  if (!usuario.gerencia) throw new ImobError(403, "Você não tem permissão para atribuir limpezas.");
  const parsed = uuidOuNulo.safeParse(body.responsavel_id ?? null);
  if (!parsed.success) throw new ImobError(400, "Responsável pela limpeza inválido.");
  return rpc("imob_acao_limpeza", { p_id: id, p_acao: "ATRIBUIR", p_payload: { responsavel_id: parsed.data }, p_actor: usuario.id });
}

/** GET /api/execucao/limpezas · POST /api/execucao/limpezas/:id/concluir · …/atribuir · …/reabrir · …/editar */
export async function limpezasResource(request: Request, path: string[]) {
  const usuario = await sessao();
  const method = request.method;
  if (!path.length && method === "GET") return json(await listar(new URL(request.url), usuario));
  if (path.length === 2 && method === "POST") {
    const id = identifier(path[0]);
    const body = await bodyOf(request).catch(() => ({}));
    if (path[1] === "concluir") return json({ item: await concluir(id, body, usuario) });
    if (path[1] === "reabrir") return json({ item: await reabrir(id, usuario) });
    if (path[1] === "editar") return json({ item: await editar(id, body, usuario) });
    if (path[1] === "atribuir") return json({ item: await atribuir(id, body, usuario) });
  }
  throw new ImobError(404, "Rota de limpeza não encontrada.");
}

/** Botão "Concluir limpeza" do cadastro do imóvel: conclui a limpeza pendente dele. */
export async function concluirLimpezaDoImovel(imovelId: number, actorId: string) {
  const pendente = await db.from("imovel_limpeza").select("id").eq("imovel_id", imovelId).eq("status", "PENDENTE").maybeSingle();
  if (pendente.error) throw pendente.error;
  if (!pendente.data) throw new ImobError(404, "Este imóvel não tem limpeza pendente.");
  return rpc("imob_acao_limpeza", { p_id: pendente.data.id, p_acao: "CONCLUIR", p_payload: {}, p_actor: actorId });
}
