import { NextRequest, NextResponse } from "next/server";

import { requirePerm } from "@/app/api/_authz/perms";
import { PERMS } from "@/app/api/_authz/permission-constants";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const OPERACOES = new Set(["INSERT", "UPDATE", "DELETE"]);

type EventoAuditoria = {
  dados_anteriores: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
};

type ReferenciasAuditoria = Record<string, Record<string, string>>;

function coletarIds(eventos: EventoAuditoria[], campo: string) {
  const ids = new Set<string>();
  for (const evento of eventos) {
    for (const dados of [evento.dados_anteriores, evento.dados_novos]) {
      const valor = dados?.[campo];
      if (valor !== null && valor !== undefined && valor !== "") ids.add(String(valor));
    }
  }
  return Array.from(ids);
}

function juntarPartes(...partes: Array<unknown>) {
  return partes
    .filter((parte) => parte !== null && parte !== undefined && String(parte).trim())
    .map(String)
    .join(" · ");
}

async function carregarReferencias(eventos: EventoAuditoria[]): Promise<ReferenciasAuditoria> {
  const ids = {
    pecaid: coletarIds(eventos, "pecaid"),
    clienteid: coletarIds(eventos, "clienteid"),
    veiculoid: coletarIds(eventos, "veiculoid"),
    setorid: coletarIds(eventos, "setorid"),
    servicoid: coletarIds(eventos, "servicoid"),
    produtoid: coletarIds(eventos, "produtoid"),
    checklist_modelo_id: coletarIds(eventos, "checklist_modelo_id"),
    usuarios: Array.from(new Set([
      ...coletarIds(eventos, "usuarioid"),
      ...coletarIds(eventos, "usuariocriadorid"),
      ...coletarIds(eventos, "created_by"),
      ...coletarIds(eventos, "updated_by"),
      ...coletarIds(eventos, "deleted_by"),
    ])),
  };

  const consultar = <T,>(valores: string[], consulta: () => PromiseLike<{ data: T[] | null; error: unknown }>) => (
    valores.length ? consulta() : Promise.resolve({ data: [] as T[], error: null })
  );

  const [pecas, clientes, veiculos, setores, servicos, produtos, modelosChecklist, usuarios] = await Promise.all([
    consultar(ids.pecaid, () => supabaseAdmin.from("peca").select("id, titulo, descricao, codigo").in("id", ids.pecaid)),
    consultar(ids.clienteid, () => supabaseAdmin.from("cliente").select("id, nomerazaosocial").in("id", ids.clienteid)),
    consultar(ids.veiculoid, () => supabaseAdmin.from("veiculo").select("id, placa, marca, modelo").in("id", ids.veiculoid)),
    consultar(ids.setorid, () => supabaseAdmin.from("setor").select("id, nome").in("id", ids.setorid)),
    consultar(ids.servicoid, () => supabaseAdmin.from("servico").select("id, codigo, descricao").in("id", ids.servicoid)),
    consultar(ids.produtoid, () => supabaseAdmin.from("produto").select("id, descricao, referencia").in("id", ids.produtoid)),
    consultar(ids.checklist_modelo_id, () => supabaseAdmin.from("checklist_modelo").select("id, nome").in("id", ids.checklist_modelo_id)),
    consultar(ids.usuarios, () => supabaseAdmin.from("usuario").select("id, nome, email").in("id", ids.usuarios)),
  ]);

  for (const resultado of [pecas, clientes, veiculos, setores, servicos, produtos, modelosChecklist, usuarios]) {
    if (resultado.error) console.warn("[auditoria] Não foi possível resolver uma referência:", resultado.error);
  }

  const referencias: ReferenciasAuditoria = {};
  const adicionar = (campo: string, id: unknown, nome: string) => {
    if (id === null || id === undefined || !nome) return;
    referencias[campo] ??= {};
    referencias[campo][String(id)] = nome;
  };

  for (const item of pecas.data ?? []) adicionar("pecaid", item.id, juntarPartes(item.titulo, item.codigo || item.descricao));
  for (const item of clientes.data ?? []) adicionar("clienteid", item.id, juntarPartes(item.nomerazaosocial));
  for (const item of veiculos.data ?? []) adicionar("veiculoid", item.id, juntarPartes(`${item.marca} ${item.modelo}`.trim(), item.placa));
  for (const item of setores.data ?? []) adicionar("setorid", item.id, String(item.nome));
  for (const item of servicos.data ?? []) adicionar("servicoid", item.id, juntarPartes(item.descricao, item.codigo));
  for (const item of produtos.data ?? []) adicionar("produtoid", item.id, juntarPartes(item.descricao, item.referencia));
  for (const item of modelosChecklist.data ?? []) adicionar("checklist_modelo_id", item.id, String(item.nome));
  for (const item of usuarios.data ?? []) {
    const nome = juntarPartes(item.nome, item.email);
    for (const campo of ["usuarioid", "usuariocriadorid", "created_by", "updated_by", "deleted_by"]) {
      adicionar(campo, item.id, nome);
    }
  }

  return referencias;
}

function numeroLimitado(valor: string | null, padrao: number, minimo: number, maximo: number) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(maximo, Math.max(minimo, Math.trunc(numero)));
}

export async function GET(request: NextRequest) {
  try {
    await requirePerm(PERMS.CONFIG);

    const params = request.nextUrl.searchParams;
    if (params.get("metadata") === "1") {
      const [{ data: eventos, error: eventosError }, { data: usuarios, error: usuariosError }] = await Promise.all([
        supabaseAdmin.from("auditoria_evento").select("modulo, tabela").order("ocorrido_em", { ascending: false }).limit(2000),
        supabaseAdmin.from("usuario").select("id, nome, email").order("nome", { ascending: true }),
      ]);

      if (eventosError) throw eventosError;
      if (usuariosError) throw usuariosError;

      const tabelas = Array.from(
        new Map(
          (eventos ?? []).map((evento) => [
            String(evento.tabela),
            { nome: String(evento.tabela), modulo: String(evento.modulo) },
          ]),
        ).values(),
      ).sort((a, b) => a.nome.localeCompare(b.nome));
      const modulos = Array.from(new Set((eventos ?? []).map((evento) => String(evento.modulo)))).sort();
      return NextResponse.json({ modulos, tabelas, usuarios: usuarios ?? [] });
    }

    const pagina = numeroLimitado(params.get("pagina"), 1, 1, 100000);
    const porPagina = numeroLimitado(params.get("porPagina"), 25, 10, 100);
    const inicio = (pagina - 1) * porPagina;
    const fim = inicio + porPagina - 1;

    let query = supabaseAdmin
      .from("auditoria_evento")
      .select(
        "id, ocorrido_em, operacao, modulo, tabela, registro_id, usuario_id, ator_nome, dados_anteriores, dados_novos, campos_alterados, origem, fonte, usuario:usuario_id ( id, nome, email )",
        { count: "exact" },
      )
      .order("ocorrido_em", { ascending: false });

    const operacao = params.get("operacao")?.toUpperCase();
    const modulo = params.get("modulo")?.trim();
    const tabela = params.get("tabela")?.trim();
    const usuarioId = params.get("usuarioId")?.trim();
    const busca = params.get("busca")?.trim();
    const inicioData = params.get("inicio")?.trim();
    const fimData = params.get("fim")?.trim();

    if (operacao && OPERACOES.has(operacao)) query = query.eq("operacao", operacao);
    if (modulo) query = query.eq("modulo", modulo);
    if (tabela) query = query.eq("tabela", tabela);
    if (usuarioId === "usuarios") query = query.eq("origem", "usuario");
    else if (usuarioId === "usuarios_sistema") query = query.in("origem", ["usuario", "sistema"]);
    else if (usuarioId === "sistema") query = query.eq("origem", "sistema");
    else if (usuarioId === "cliente") query = query.eq("origem", "cliente");
    else if (usuarioId) query = query.eq("usuario_id", usuarioId);
    if (busca) query = query.ilike("registro_id", `%${busca}%`);
    if (inicioData) query = query.gte("ocorrido_em", `${inicioData}T00:00:00-03:00`);
    if (fimData) query = query.lte("ocorrido_em", `${fimData}T23:59:59.999-03:00`);

    const { data, error, count } = await query.range(inicio, fim);
    if (error) throw error;

    const eventos = (data ?? []) as EventoAuditoria[];
    const referencias = await carregarReferencias(eventos);

    return NextResponse.json({
      eventos,
      referencias,
      paginacao: {
        pagina,
        porPagina,
        total: count ?? 0,
        totalPaginas: Math.max(1, Math.ceil((count ?? 0) / porPagina)),
      },
    });
  } catch (error) {
    const status = Number((error as { statusCode?: number })?.statusCode) || 500;
    console.error("[auditoria] Falha ao consultar eventos:", error);
    return NextResponse.json(
      { error: status === 403 ? "Sem permissao para visualizar a auditoria." : "Nao foi possivel carregar a auditoria." },
      { status },
    );
  }
}
