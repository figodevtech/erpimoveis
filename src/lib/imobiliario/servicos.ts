import "server-only";
import { z } from "zod";
import { getCurrentUserAccess } from "@/app/api/_authz/perms";
import { PERMS, permissionSetHas, type Permission } from "@/app/api/_authz/permission-constants";
import { bodyOf, db, identifier, ImobError, json, one, pagination, rpc } from "./server";
import { enrich } from "./data";
import { prazoDoServico, solicitacaoServicoSchema } from "./schemas";
import { hojeImobiliario } from "./types";

/**
 * Serviços do imóvel (imovel_servico, 20261119160000): a limpeza pedida no check-out e os outros
 * tipos do catálogo (Configurações > Tipos > Serviços), na Execução e na aba Serviços do imóvel.
 *
 * Execução: com execucao:visualizar, cada um vê os serviços sob a sua responsabilidade (o perfil
 * do prestador de serviço). execucao:ver_todas mostra os de todos os executores, inclusive sem
 * responsável; execucao:trocar_realizador passa a tarefa para outra pessoa. Quem edita imóveis
 * pede, edita, conclui e reabre pela aba Serviços do imóvel.
 */

// O imóvel (título, endereço e foto de capa) vem de `enrich`, como nas listas de imóveis e reservas.
const SERVICO_SELECT = [
  "id,imovel_id,servico_id,reserva_id,responsavel_id,descricao,status,prazo_em,solicitada_em,concluida_em,observacoes,updated_at",
  "servico:servico_id(id,codigo,descricao,chave_sistema)",
  "reserva:reserva_id(id,inicio,fim,checkout_em,hospedes,cliente:cliente_id(id,nomerazaosocial))",
  "responsavel:responsavel_id(id,nome,email)",
  "solicitante:solicitada_por(id,nome)",
  "concluinte:concluida_por(id,nome)",
].join(",");

const uuidOuNulo = z.union([z.string().uuid(), z.literal(""), z.null()]).transform((v) => v || null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sessao() {
  const access = await getCurrentUserAccess();
  if (!access?.ativo) throw new ImobError(401, "Entre no ERP para continuar.");
  const pode = (perm: Permission) => permissionSetHas(access.permissoes, perm);
  return {
    id: access.id as string,
    visualiza: pode(PERMS.EXECUCAO),
    verTodas: pode(PERMS.EXECUCAO_VER_TODAS),
    trocarRealizador: pode(PERMS.EXECUCAO_TROCAR_REALIZADOR),
    editaImoveis: pode(PERMS.IMOVEIS_EDITAR),
  };
}

type Sessao = Awaited<ReturnType<typeof sessao>>;

/** Id do serviço de limpeza do sistema (o que o check-out pede). */
async function limpezaId() {
  const { data, error } = await db.from("servico").select("id").eq("chave_sistema", "LIMPEZA").maybeSingle();
  if (error) throw error;
  if (!data) throw new ImobError(409, "O serviço de limpeza do sistema não está cadastrado. Aplique a migration dos serviços do imóvel.");
  return Number(data.id);
}

function servicoIdDoFiltro(url: URL) {
  const valor = url.searchParams.get("servico_id");
  return valor ? identifier(valor) : null;
}

/** Lista da Execução: pendentes (prazo mais curto primeiro) ou concluídos (mais recentes primeiro). */
async function listar(url: URL, usuario: Sessao) {
  if (!usuario.visualiza) throw new ImobError(403, "Você não tem acesso à Execução.");
  const { page, pageSize, from, to } = pagination(url);
  const status = (url.searchParams.get("status") ?? "PENDENTE").toUpperCase();
  if (!["PENDENTE", "CONCLUIDA"].includes(status)) throw new ImobError(400, "Situação de serviço inválida.");
  // Sem ver_todas, o escopo é sempre o dos próprios serviços. Com ela: todos, sem responsável ou
  // os de um executor (o id dele).
  const pedido = (url.searchParams.get("escopo") ?? "minhas").trim().toLowerCase();
  const escopo = usuario.verTodas && (["todas", "sem_responsavel"].includes(pedido) || UUID.test(pedido)) ? pedido : "minhas";
  const servicoId = servicoIdDoFiltro(url);

  let query = db.from("imovel_servico").select(SERVICO_SELECT, { count: "exact" }).eq("status", status);
  if (escopo === "minhas") query = query.eq("responsavel_id", usuario.id);
  else if (escopo === "sem_responsavel") query = query.is("responsavel_id", null);
  else if (escopo !== "todas") query = query.eq("responsavel_id", escopo);
  if (servicoId) query = query.eq("servico_id", servicoId);
  query = status === "PENDENTE"
    ? query.order("prazo_em", { ascending: true, nullsFirst: false }).order("solicitada_em", { ascending: true })
    : query.order("concluida_em", { ascending: false });
  const { data, count, error } = await query.order("id").range(from, to);
  if (error) throw error;
  return {
    items: await montarItens(data),
    total: count ?? 0,
    page,
    pageSize,
    escopo,
    permissoes: { verTodas: usuario.verTodas, trocarRealizador: usuario.trocarRealizador },
  };
}

/** Imóvel (foto, endereço) e próximo check-in de cada serviço, como a Execução e a aba Serviços mostram. */
async function montarItens(data: unknown[] | null) {
  const items = await enrich((data ?? []) as unknown as Record<string, any>[]);
  const proximos = await proximosCheckins(items.map((item) => Number(item.imovel_id)));
  return items.map((item) => ({ ...item, proximo_checkin: proximos.get(Number(item.imovel_id)) ?? null }));
}

/**
 * Aba Serviços do cadastro do imóvel: todos os serviços dele (pendentes, concluídos e cancelados),
 * dos mais recentes para os mais antigos. Quem vê o imóvel vê o histórico; agir sobre cada um
 * segue as regras de concluir/reabrir/editar.
 */
export async function servicosDoImovel(imovelId: number, url: URL) {
  const { page, pageSize, from, to } = pagination(url);
  const status = (url.searchParams.get("status") ?? "TODOS").toUpperCase();
  if (!["TODOS", "PENDENTE", "CONCLUIDA", "CANCELADA"].includes(status)) throw new ImobError(400, "Situação de serviço inválida.");
  const servicoId = servicoIdDoFiltro(url);
  let query = db.from("imovel_servico").select(SERVICO_SELECT, { count: "exact" }).eq("imovel_id", imovelId);
  if (status !== "TODOS") query = query.eq("status", status);
  if (servicoId) query = query.eq("servico_id", servicoId);
  const { data, count, error } = await query.order("solicitada_em", { ascending: false }).order("id", { ascending: false }).range(from, to);
  // Sem a migration dos serviços, o imóvel simplesmente não tem serviços.
  if (error && ["42P01", "PGRST205"].includes(String(error.code))) return { items: [], total: 0, page, pageSize };
  if (error) throw error;
  return { items: await montarItens(data), total: count ?? 0, page, pageSize };
}

/** "Solicitar serviço" da aba Serviços do imóvel (a permissão, imoveis:editar, é conferida antes). */
export async function solicitarServico(imovelId: number, body: Record<string, unknown>, actorId: string) {
  const dados = solicitacaoServicoSchema.parse(body);
  return rpc("imob_solicitar_servico", {
    p_imovel_id: imovelId,
    p_servico_id: dados.servico_id,
    p_reserva_id: null,
    p_responsavel: dados.responsavel_id,
    p_actor: actorId,
    p_descricao: dados.descricao,
    p_prazo: prazoDoServico(dados.prazo_data, dados.prazo_hora),
  });
}

/**
 * Próxima entrada de cada imóvel: a reserva confirmada (ainda sem check-in) que começa primeiro,
 * entre as que não terminaram. Uma entrada prevista que já passou continua sendo a próxima: o
 * hóspede pode estar chegando com o imóvel ainda por preparar.
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

/** Concluir e voltar para pendente: o responsável, quem vê as tarefas de todos ou quem edita imóveis. */
function podeMexer(servico: Record<string, any>, usuario: Sessao) {
  return servico.responsavel_id === usuario.id || usuario.verTodas || usuario.editaImoveis;
}

async function concluir(id: number, body: Record<string, unknown>, usuario: Sessao) {
  const servico = await one("imovel_servico", id, "id,responsavel_id");
  if (!podeMexer(servico, usuario)) {
    throw new ImobError(403, "Só o responsável ou quem vê as tarefas de todos pode concluir este serviço.");
  }
  const observacoes = typeof body.observacoes === "string" ? body.observacoes.trim().slice(0, 2000) : "";
  return rpc("imob_acao_servico", { p_id: id, p_acao: "CONCLUIR", p_payload: { observacoes }, p_actor: usuario.id });
}

// Só o que vier muda: um campo ausente fica como está (imob_acao_servico, ação EDITAR).
const edicaoSchema = z.object({
  descricao: z.string().trim().max(500, "A descrição do serviço deve ter até 500 caracteres.").nullable().optional(),
  responsavel_id: uuidOuNulo.optional(),
  prazo_data: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dia do prazo inválido."), z.literal(""), z.null()]).optional(),
  prazo_hora: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora do prazo inválida."), z.literal(""), z.null()]).optional(),
  observacoes: z.string().trim().max(2000, "As observações da conclusão devem ter até 2000 caracteres.").nullable().optional(),
  data_conclusao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data da conclusão inválida.").optional(),
  hora_conclusao: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora da conclusão inválida.").optional(),
});

/** Editar os dados do serviço (aba Serviços do imóvel): quem edita imóveis. */
async function editar(id: number, body: Record<string, unknown>, usuario: Sessao) {
  if (!usuario.editaImoveis) throw new ImobError(403, "Você não tem permissão para editar este serviço.");
  const { prazo_data, prazo_hora, ...dados } = edicaoSchema.parse(body);
  if (dados.data_conclusao && !dados.hora_conclusao) throw new ImobError(400, "Informe a hora da conclusão.");
  if (prazo_hora && !prazo_data) throw new ImobError(400, "Informe o dia do prazo.");
  const payload: Record<string, unknown> = Object.fromEntries(Object.entries(dados).filter(([, valor]) => valor !== undefined));
  // O prazo só muda quando o dia vem no corpo; vazio ou nulo tira o prazo.
  if (prazo_data !== undefined) payload.prazo_em = prazoDoServico(prazo_data, prazo_hora) ?? "";
  return rpc("imob_acao_servico", { p_id: id, p_acao: "EDITAR", p_payload: payload, p_actor: usuario.id });
}

/** "Voltar para pendente": quem concluiria o serviço também pode reabri-lo. */
async function reabrir(id: number, usuario: Sessao) {
  const servico = await one("imovel_servico", id, "id,responsavel_id");
  if (!podeMexer(servico, usuario)) {
    throw new ImobError(403, "Só o responsável, quem vê as tarefas de todos ou quem edita imóveis pode reabrir este serviço.");
  }
  return rpc("imob_acao_servico", { p_id: id, p_acao: "REABRIR", p_payload: {}, p_actor: usuario.id });
}

/** "Trocar realizador": quem tem a permissão, nas próprias tarefas ou, com ver_todas, em qualquer uma. */
async function atribuir(id: number, body: Record<string, unknown>, usuario: Sessao) {
  if (!usuario.trocarRealizador) throw new ImobError(403, "Você não tem permissão para trocar o realizador.");
  const servico = await one("imovel_servico", id, "id,responsavel_id");
  if (servico.responsavel_id !== usuario.id && !usuario.verTodas) {
    throw new ImobError(403, "Você só pode trocar o realizador das suas próprias tarefas.");
  }
  const parsed = uuidOuNulo.safeParse(body.responsavel_id ?? null);
  if (!parsed.success) throw new ImobError(400, "Realizador inválido.");
  return rpc("imob_acao_servico", { p_id: id, p_acao: "ATRIBUIR", p_payload: { responsavel_id: parsed.data }, p_actor: usuario.id });
}

/** GET /api/execucao/servicos · POST /api/execucao/servicos/:id/concluir · …/atribuir · …/reabrir · …/editar */
export async function servicosResource(request: Request, path: string[]) {
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
  throw new ImobError(404, "Rota de serviço não encontrada.");
}

/** Botão "Concluir limpeza" do cadastro do imóvel: conclui a limpeza pendente dele (não os outros serviços). */
export async function concluirLimpezaDoImovel(imovelId: number, actorId: string) {
  const pendente = await db
    .from("imovel_servico")
    .select("id")
    .eq("imovel_id", imovelId)
    .eq("servico_id", await limpezaId())
    .eq("status", "PENDENTE")
    .maybeSingle();
  if (pendente.error) throw pendente.error;
  if (!pendente.data) throw new ImobError(404, "Este imóvel não tem limpeza pendente.");
  return rpc("imob_acao_servico", { p_id: pendente.data.id, p_acao: "CONCLUIR", p_payload: {}, p_actor: actorId });
}
