export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensagemDoErro, statusDoErro } from "@/lib/financeiro/plano-contas/erros";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

type Resumo = {
  motivo: string;
  descricao: string;
  escopo: string;
  quantidade: number | string;
  valor: number | string | null;
};

type Item = {
  referencia_tipo: string;
  referencia_id: number | string;
  descricao: string | null;
  grupo_nome: string | null;
  conta_nome: string | null;
  competencia: string | null;
  valor: number | string | null;
};

type Registro = Record<string, unknown>;

/** Mesma forma do detalhamento da linha: o que a tela abre ao clicar em corrigir. */
type Documento = {
  tipo: "OS" | "VENDA" | "ENTRADA" | "USO_CONSUMO" | "TRANSACAO";
  id: number;
} | null;

function documentoDoEvento(row: Registro): Documento {
  const tipo = row.source_type == null ? null : String(row.source_type);
  const id = row.source_id == null ? null : Number(row.source_id);

  if (row.ordemservicoid != null) return { tipo: "OS", id: Number(row.ordemservicoid) };
  if (tipo === "TRANSACAO" && id) return { tipo: "TRANSACAO", id };
  // O evento convertido guarda a transação que o liquidou; é ela que se edita.
  if (row.transacaoid != null) return { tipo: "TRANSACAO", id: Number(row.transacaoid) };
  if (!id) return null;
  if (tipo === "ORDEM_SERVICO") return { tipo: "OS", id };
  if (tipo === "VENDA") return { tipo: "VENDA", id };
  if (tipo === "ENTRADA") return { tipo: "ENTRADA", id };
  if (tipo === "USOCONSUMO_ENTRADA") return { tipo: "USO_CONSUMO", id };
  return null;
}

/**
 * Documento de cada item de EVENTO.
 *
 * A fila devolve o id do evento, e o evento não é editável: quem conserta é o
 * documento que o gerou. Sem isso, o botão "Corrigir" de "lançamento sem linha"
 * não abria nada — justamente o motivo mais comum, o do lançamento avulso que
 * ficou sem plano de conta.
 */
async function documentosDosEventos(ids: number[]) {
  const porEvento = new Map<number, Documento>();
  for (let inicio = 0; inicio < ids.length; inicio += 200) {
    const { data, error } = await supabaseAdmin
      .from("eventos_financeiros")
      .select("id, source_type, source_id, ordemservicoid, transacaoid")
      .in("id", ids.slice(inicio, inicio + 200));
    if (error) throw error;
    for (const row of (data ?? []) as Registro[]) {
      porEvento.set(Number(row.id), documentoDoEvento(row));
    }
  }
  return porEvento;
}

/**
 * GET /api/dre/pendencias?de=&ate=[&motivo=&limite=&deslocamento=]
 *
 * Sem `motivo`, devolve o resumo por motivo, com quantidade E valor. Com
 * `motivo`, devolve os itens daquele motivo, paginados.
 *
 * Se a consulta falhar, a resposta é erro — nunca uma lista vazia. Uma fila que
 * devolve zero quando não conseguiu ler faz a tela dizer "sem pendências", que é
 * a pior resposta possível: parece completude e é ignorância.
 */
export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();

    const { searchParams } = new URL(req.url);
    const de = (searchParams.get("de") ?? "").trim();
    const ate = (searchParams.get("ate") ?? "").trim();
    const motivo = (searchParams.get("motivo") ?? "").trim();

    if (!DATA_ISO.test(de) || !DATA_ISO.test(ate)) {
      return NextResponse.json({ error: "Informe o período (de/ate) no formato AAAA-MM-DD." }, { status: 400 });
    }

    const inicio = `${de}T00:00:00.000Z`;
    const fim = `${ate}T23:59:59.999Z`;

    if (motivo) {
      const limite = Number(searchParams.get("limite") ?? 100);
      const deslocamento = Number(searchParams.get("deslocamento") ?? 0);

      const { data, error } = await supabaseAdmin.rpc("dre_pendencias_itens", {
        p_motivo: motivo,
        p_de: inicio,
        p_ate: fim,
        p_limite: Number.isFinite(limite) ? limite : 100,
        p_deslocamento: Number.isFinite(deslocamento) ? Math.max(0, deslocamento) : 0,
      });
      if (error) throw error;

      const linhas = (data ?? []) as Item[];

      /*
       * O documento enriquece a lista, mas não é ela: se a consulta falhar, os
       * itens continuam aparecendo, só sem o atalho de correção.
       */
      let documentos = new Map<number, Documento>();
      const eventos = linhas.filter((item) => item.referencia_tipo === "EVENTO").map((item) => Number(item.referencia_id));
      if (eventos.length) {
        try {
          documentos = await documentosDosEventos([...new Set(eventos)]);
        } catch (erroDocumentos) {
          console.error("[GET /api/dre/pendencias] documentos dos eventos", erroDocumentos);
        }
      }

      const itens = linhas.map((item) => ({
        referencia_tipo: item.referencia_tipo,
        referencia_id: Number(item.referencia_id),
        descricao: item.descricao ?? null,
        grupo: item.grupo_nome ?? null,
        conta: item.conta_nome ?? null,
        competencia: item.competencia ?? null,
        valor: item.valor === null ? null : Number(item.valor),
        documento:
          item.referencia_tipo === "EVENTO" ? (documentos.get(Number(item.referencia_id)) ?? null) : null,
      }));

      return NextResponse.json({ motivo, periodo: { de, ate }, itens }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data, error } = await supabaseAdmin.rpc("dre_pendencias", { p_de: inicio, p_ate: fim });
    if (error) throw error;

    const resumo = ((data ?? []) as Resumo[]).map((linha) => ({
      motivo: linha.motivo,
      descricao: linha.descricao,
      escopo: linha.escopo,
      quantidade: Number(linha.quantidade ?? 0),
      valor: linha.valor === null ? null : Number(linha.valor),
    }));

    return NextResponse.json(
      {
        periodo: { de, ate },
        resumo,
        totais: {
          itens: resumo.reduce((total, linha) => total + linha.quantidade, 0),
          valor: resumo.reduce((total, linha) => total + (linha.valor ?? 0), 0),
        },
        atualizadoEm: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/dre/pendencias]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao carregar as pendências da DRE") },
      { status: statusDoErro(error) },
    );
  }
}
