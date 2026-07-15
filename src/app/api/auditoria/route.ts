import { NextRequest, NextResponse } from "next/server";

import { requirePerm } from "@/app/api/_authz/perms";
import { PERMS } from "@/app/api/_authz/permission-constants";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const OPERACOES = new Set(["INSERT", "UPDATE", "DELETE"]);

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
        "id, ocorrido_em, operacao, modulo, tabela, registro_id, usuario_id, dados_anteriores, dados_novos, campos_alterados, origem, usuario:usuario_id ( id, nome, email )",
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
    if (usuarioId === "sistema") query = query.is("usuario_id", null);
    else if (usuarioId) query = query.eq("usuario_id", usuarioId);
    if (busca) query = query.ilike("registro_id", `%${busca}%`);
    if (inicioData) query = query.gte("ocorrido_em", `${inicioData}T00:00:00-03:00`);
    if (fimData) query = query.lte("ocorrido_em", `${fimData}T23:59:59.999-03:00`);

    const { data, error, count } = await query.range(inicio, fim);
    if (error) throw error;

    return NextResponse.json({
      eventos: data ?? [],
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
