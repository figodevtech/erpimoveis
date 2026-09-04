// src/app/api/me/_helpers.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasUsuariosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export {
  parsePeriodo,
  resolverTextosServico,
  STATUS_OS_EM_EXECUCAO,
  STATUS_OS_FINALIZADAS,
  STATUS_VENDAS_REALIZADAS,
} from "@/lib/meu-perfil/regras";
export type { PeriodoConsulta as Periodo, TextosServico } from "@/lib/meu-perfil/regras";

/**
 * Helpers da Central Pessoal (/meu-perfil).
 *
 * As rotas /api/me/* nao aparecem em ROUTE_PERMS do middleware: qualquer usuario
 * autenticado passa. Por padrao, elas devolvem exclusivamente dados do usuario
 * da sessao. A consulta de outro `usuarioId` so e aceita para quem possui a
 * permissao de visualizar usuarios.
 */
export async function getMeUserId(req?: Request): Promise<string | NextResponse> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const sessionUserId = String(userId);
  const requestedUserId = req
    ? (new URL(req.url).searchParams.get("usuarioId") ?? "").trim()
    : "";

  if (!requestedUserId || requestedUserId === sessionUserId) return sessionUserId;

  if (!(await hasUsuariosAccess())) {
    return NextResponse.json(
      { error: "Sem permissao para visualizar o perfil de outro usuario." },
      { status: 403 },
    );
  }

  return requestedUserId;
}

export function isNextResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export type Paginacao = { page: number; limit: number; from: number; to: number };

function inteiroOu(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function parsePaginacao(searchParams: URLSearchParams): Paginacao {
  const limit = Math.min(Math.max(inteiroOu(searchParams.get("limit"), 20), 1), 100);
  const page = Math.max(inteiroOu(searchParams.get("page"), 1), 1);
  const from = (page - 1) * limit;

  return { page, limit, from, to: from + limit - 1 };
}

export function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function texto(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export function totalDePaginas(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / Math.max(limit, 1)));
}

export type RelacaoNomeada = { id: number; nome: string | null };

/**
 * O PostgREST devolve embeds `to-one` ora como objeto, ora como array de um
 * elemento (depende de como a FK e resolvida). Normaliza os dois casos.
 */
export function relacaoNomeada(value: unknown, campoNome = "nome"): RelacaoNomeada | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;

  const registro = row as Record<string, unknown>;
  if (registro.id == null) return null;

  return { id: Number(registro.id), nome: texto(registro[campoNome]) };
}

export function comoLista(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

export function erroInterno(escopo: string, e: unknown): NextResponse {
  console.error(`[${escopo}]`, e);
  const message = e instanceof Error ? e.message : "Erro ao carregar dados";
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * As comissões que já existem de fato para esta pessoa.
 *
 * A Central mostra o que o sistema **apurou** — o snapshot do vínculo ou da
 * criação. Nem tudo que está apurado virou comissão: enquanto a OS não chega a
 * EM_ANDAMENTO o valor é uma projeção do orçamento atual, e muda junto com ele.
 * Quem lê a própria página precisa saber qual das duas está olhando, senão
 * confere o total contra o holerite e não bate.
 *
 * O que NÃO entra aqui é o estado do evento no financeiro — se já virou título,
 * se foi pago. Isso é assunto de outro setor, e na página do realizador só
 * levantaria uma pergunta que ele não tem como responder.
 *
 * Devolve as chaves `<ordemservicoid>::<chave_origem>` que têm comissão
 * confirmada. Uma consulta por página, e não uma por linha: a chave de origem
 * carrega o serviço e o usuário (`<servicoid>:<uuid>`) ou a marca da criação
 * (`CRIACAO:<uuid>`), então o pareamento acontece em memória.
 *
 * Cancelado fica de fora: comissão cancelada não é comissão de ninguém.
 */
export async function comissoesConfirmadas(ordemIds: number[]): Promise<Set<string>> {
  const chaves = new Set<string>();
  const ids = [...new Set(ordemIds)].filter(Number.isFinite);
  if (!ids.length) return chaves;

  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .select("ordemservicoid, chave_origem")
    .eq("origem", "COMISSAO")
    .neq("status", "CANCELADO")
    .in("ordemservicoid", ids);
  if (error) throw error;

  for (const linha of data ?? []) {
    const registro = linha as Record<string, unknown>;
    const origem = String(registro.chave_origem ?? "");
    chaves.add(`${registro.ordemservicoid}::${origem}`);

    // A comissão de criação sai um evento por item (`CRIACAO:<uuid>:S12`), mas
    // a Central mostra o total da OS. Guardar também o prefixo sem o item deixa
    // a pergunta "esta OS já rendeu comissão de criação para mim?" ser um
    // acesso direto, em vez de uma varredura por linha da página.
    if (origem.startsWith("CRIACAO:")) {
      const semItem = origem.split(":").slice(0, 2).join(":");
      chaves.add(`${registro.ordemservicoid}::${semItem}`);
    }
  }

  return chaves;
}

/** A chave do evento de comissão de realização: serviço e quem executou. */
export function chaveComissaoDeServico(ordemId: number, servicoId: number, usuarioId: string) {
  return `${ordemId}::${servicoId}:${usuarioId}`;
}

/**
 * A chave da comissão de criação desta pessoa nesta OS, sem o item.
 *
 * Os eventos são por item; esta é a pergunta no nível da ordem, que é o que a
 * Central mostra. `comissoesConfirmadas` guarda o prefixo junto das chaves
 * completas para isso.
 */
export function chaveComissaoDeCriacao(ordemId: number, usuarioId: string) {
  return `${ordemId}::CRIACAO:${usuarioId}`;
}
