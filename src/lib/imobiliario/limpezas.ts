import "server-only";
import { z } from "zod";
import { getCurrentUserAccess } from "@/app/api/_authz/perms";
import { PERMS, permissionSetHas, type Permission } from "@/app/api/_authz/permission-constants";
import { bodyOf, db, identifier, ImobError, json, one, pagination, rpc } from "./server";
import { enrich } from "./data";

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
  const items = await enrich((data ?? []) as unknown as Record<string, any>[]);
  return { items, total: count ?? 0, page, pageSize, escopo, podeGerenciar: usuario.gerencia };
}

async function concluir(id: number, body: Record<string, unknown>, usuario: Sessao) {
  const limpeza = await one("imovel_limpeza", id, "id,responsavel_id");
  if (limpeza.responsavel_id !== usuario.id && !usuario.gerencia && !usuario.editaImoveis) {
    throw new ImobError(403, "Só o responsável ou quem gerencia limpezas pode concluir esta limpeza.");
  }
  const observacoes = typeof body.observacoes === "string" ? body.observacoes.trim().slice(0, 2000) : "";
  return rpc("imob_acao_limpeza", { p_id: id, p_acao: "CONCLUIR", p_payload: { observacoes }, p_actor: usuario.id });
}

async function atribuir(id: number, body: Record<string, unknown>, usuario: Sessao) {
  if (!usuario.gerencia) throw new ImobError(403, "Você não tem permissão para atribuir limpezas.");
  const parsed = uuidOuNulo.safeParse(body.responsavel_id ?? null);
  if (!parsed.success) throw new ImobError(400, "Responsável pela limpeza inválido.");
  return rpc("imob_acao_limpeza", { p_id: id, p_acao: "ATRIBUIR", p_payload: { responsavel_id: parsed.data }, p_actor: usuario.id });
}

/** GET /api/execucao/limpezas · POST /api/execucao/limpezas/:id/concluir · POST …/:id/atribuir */
export async function limpezasResource(request: Request, path: string[]) {
  const usuario = await sessao();
  const method = request.method;
  if (!path.length && method === "GET") return json(await listar(new URL(request.url), usuario));
  if (path.length === 2 && method === "POST") {
    const id = identifier(path[0]);
    const body = await bodyOf(request).catch(() => ({}));
    if (path[1] === "concluir") return json({ item: await concluir(id, body, usuario) });
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
