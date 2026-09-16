export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { planosDasTransacoes, type PlanoDoLancamento } from "../_planos";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

type Registro = Record<string, unknown>;

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const texto = (v: unknown) => (v == null ? null : String(v));

/** Documento que originou o lançamento — é o que a tela abre ao clicar na origem. */
type Documento = {
  tipo: "OS" | "VENDA" | "ENTRADA" | "USO_CONSUMO" | "TRANSACAO";
  id: number;
} | null;

function documentoDoEvento(row: Registro): Documento {
  const tipo = texto(row.source_type);
  const id = row.source_id == null ? null : Number(row.source_id);

  if (row.ordemservicoid != null) return { tipo: "OS", id: Number(row.ordemservicoid) };
  if (!id) return null;
  if (tipo === "ORDEM_SERVICO") return { tipo: "OS", id };
  if (tipo === "VENDA") return { tipo: "VENDA", id };
  if (tipo === "ENTRADA") return { tipo: "ENTRADA", id };
  if (tipo === "USOCONSUMO_ENTRADA") return { tipo: "USO_CONSUMO", id };
  if (tipo === "TRANSACAO") return { tipo: "TRANSACAO", id };
  return null;
}

/** Linha clicada mais toda a subarvore: quem abre "CUSTOS" espera ver 4.1 a 4.7. */
async function descendentes(templateId: number, linhaId: number): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from("dre_linha")
    .select("id, parent_id")
    .eq("template_id", templateId)
    .eq("ativo", true);

  if (error) throw error;

  const filhosDe = new Map<number, number[]>();
  for (const row of (data ?? []) as Registro[]) {
    const pai = row.parent_id == null ? null : Number(row.parent_id);
    if (pai == null) continue;
    filhosDe.set(pai, [...(filhosDe.get(pai) ?? []), Number(row.id)]);
  }

  const resultado: number[] = [];
  const pilha = [linhaId];
  while (pilha.length) {
    const atual = pilha.pop()!;
    resultado.push(atual);
    pilha.push(...(filhosDe.get(atual) ?? []));
  }

  return resultado;
}

export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();

    const { searchParams } = new URL(req.url);
    const de = (searchParams.get("de") ?? "").trim();
    const ate = (searchParams.get("ate") ?? "").trim();
    const linhaId = Number(searchParams.get("linha"));

    if (!DATA_ISO.test(de) || !DATA_ISO.test(ate) || !Number.isFinite(linhaId)) {
      return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
    }

    const { data: linha, error: erroLinha } = await supabaseAdmin
      .from("dre_linha")
      .select("id, template_id, codigo, nome, tipo")
      .eq("id", linhaId)
      .maybeSingle();

    if (erroLinha) throw erroLinha;
    if (!linha) return NextResponse.json({ error: "Linha não encontrada." }, { status: 404 });

    const registro = linha as Registro;
    const templateId = Number(registro.template_id);

    // Linha de formula e resultado de calculo, nao de lancamentos.
    if (String(registro.tipo) === "FORMULA") {
      return NextResponse.json(
        {
          linha: { id: linhaId, codigo: registro.codigo, nome: registro.nome, calculada: true },
          items: [],
          total: 0,
          planosIndisponiveis: false,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const ids = await descendentes(templateId, linhaId);

    const { data, error } = await supabaseAdmin.rpc("dre_lancamentos_por_linha", {
      p_template_id: templateId,
      p_linha_ids: ids,
      p_de: `${de}T00:00:00.000Z`,
      p_ate: `${ate}T23:59:59.999Z`,
    });

    if (error) throw error;

    const rows = (data ?? []) as Registro[];

    /*
     * O plano de conta enriquece a lista, mas não é ela. Se a consulta dele
     * falhar, os lançamentos continuam sendo mostrados — e a tela sabe que a
     * coluna do plano está indisponível, em vez de concluir que nenhum
     * lançamento tem conta.
     */
    const transacoesAvulsas = rows
      .filter((row) => texto(row.source_type) === "TRANSACAO" && row.source_id != null)
      .map((row) => Number(row.source_id));
    let planos = new Map<number, PlanoDoLancamento>();
    let planosIndisponiveis = false;
    try {
      planos = await planosDasTransacoes([...new Set(transacoesAvulsas)]);
    } catch (erroPlanos) {
      planosIndisponiveis = true;
      console.error("[GET /api/dre/drilldown] planos de conta", erroPlanos);
    }

    const items = rows.map((row) => {
      const documento = documentoDoEvento(row);
      return {
        id: Number(row.id),
        linhaId: row.linha_id == null ? null : Number(row.linha_id),
        competenciaEm: texto(row.competencia_em),
        origem: texto(row.origem),
        natureza: texto(row.natureza),
        naturezaDre: texto(row.natureza_dre),
        descricao: texto(row.descricao) ?? "—",
        detalhe: texto(row.detalhe),
        valor: num(row.valor),
        sourceType: texto(row.source_type),
        sourceId: row.source_id == null ? null : Number(row.source_id),
        ordemServicoId: row.ordemservicoid == null ? null : Number(row.ordemservicoid),
        transacaoId: row.transacaoid == null ? null : Number(row.transacaoid),
        isManual: row.is_manual === true,
        isEstorno: row.estorno_de_id != null,
        semCusto: row.sem_custo === true,
        documento,
        planoConta: documento?.tipo === "TRANSACAO" ? (planos.get(documento.id) ?? null) : null,
      };
    });

    return NextResponse.json(
      {
        linha: { id: linhaId, codigo: registro.codigo, nome: registro.nome, calculada: false },
        items,
        total: Number(items.reduce((acc, i) => acc + i.valor, 0).toFixed(2)),
        planosIndisponiveis,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Erro ao carregar os lançamentos";
    console.error("[GET /api/dre/drilldown]", e);
    return NextResponse.json({ error: mensagem }, { status: /forbidden|permiss/i.test(mensagem) ? 403 : 500 });
  }
}
