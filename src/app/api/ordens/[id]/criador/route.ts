export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { PERMS, requirePerm } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mesesDeCompetenciaFechada } from "../eventos-financeiros/_lib/competencia";

type Params = { params: Promise<{ id: string }> };

/**
 * Troca do criador da OS.
 *
 * O criador não é só um rótulo: é quem recebe a comissão de criação, e o
 * snapshot dela fixa o dono na primeira apuração. A troca e o recálculo moram
 * juntos em `trocar_criador_os`, numa transação só — esta rota só confere a
 * permissão, mostra o impacto e traduz a resposta.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idValido(valor: unknown) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function uuidValido(valor: unknown) {
  const texto = String(valor ?? "").trim();
  return UUID.test(texto) ? texto : null;
}

async function carregarOrdem(osId: number) {
  const { data, error } = await supabaseAdmin
    .from("ordemservico")
    .select("id, status, usuariocriadorid, is_deleted, criador:usuariocriadorid ( id, nome )")
    .eq("id", osId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_deleted) return null;
  return data as any;
}

/**
 * Meses já fechados na DRE que a troca alcança. Olha todos os eventos da OS, e
 * não só a comissão de criação atual: a OS encerrada que nunca teve comissão
 * ganha uma agora, com a competência dos outros eventos.
 */
async function mesesFechadosDaOs(osId: number) {
  const { data, error } = await supabaseAdmin
    .from("eventos_financeiros")
    .select("competencia_em")
    .eq("ordemservicoid", osId)
    .neq("status", "CANCELADO")
    .not("competencia_em", "is", null);
  if (error) throw error;
  return mesesDeCompetenciaFechada((data ?? []).map((row: any) => row.competencia_em));
}

function statusDoErro(error: any) {
  const statusCode = Number(error?.statusCode ?? 500);
  return statusCode === 401 || statusCode === 403 || statusCode === 409 ? statusCode : 500;
}

export async function GET(req: Request, { params }: Params) {
  try {
    await requirePerm(PERMS.ORDENS_ALTERAR_CRIADOR);
    const osId = idValido((await params).id);
    if (!osId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const ordem = await carregarOrdem(osId);
    if (!ordem) {
      return NextResponse.json({ error: "OS não encontrada." }, { status: 404 });
    }

    const usuarioId = uuidValido(new URL(req.url).searchParams.get("usuarioId"));

    const [snapshot, comprometidas, mesesFechados, candidato] = await Promise.all([
      supabaseAdmin.from("os_comissao_criacao").select("valor_comissao").eq("ordemservicoid", osId),
      // A mesma guarda de `trocar_criador_os`, para a tela avisar antes de tentar.
      supabaseAdmin
        .from("eventos_financeiros")
        .select("id, usuarioid, status, transacaoid, lancamento_id, is_manual")
        .eq("ordemservicoid", osId)
        .eq("origem", "COMISSAO")
        .like("chave_origem", "CRIACAO:%")
        .neq("status", "CANCELADO"),
      mesesFechadosDaOs(osId),
      usuarioId
        ? supabaseAdmin
            .from("usuario")
            .select("id, nome, ativo, comissao_criacao_servico_percent, comissao_criacao_produto_percent")
            .eq("id", usuarioId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (snapshot.error) throw snapshot.error;
    if (comprometidas.error) throw comprometidas.error;
    if (candidato.error) throw candidato.error;

    const comissaoAtual =
      Math.round(
        (snapshot.data ?? []).reduce((total, linha: any) => total + Number(linha.valor_comissao ?? 0), 0) * 100,
      ) / 100;

    const temComprometida = (comprometidas.data ?? []).some(
      (evento: any) =>
        evento.usuarioid !== usuarioId &&
        (evento.status === "CONVERTIDO" || evento.transacaoid != null || evento.lancamento_id != null || evento.is_manual),
    );

    const status = String(ordem.status ?? "").toUpperCase();
    const bloqueio =
      status === "CANCELADO"
        ? "Uma OS cancelada não muda de criador."
        : temComprometida
          ? "A comissão de criação desta OS já foi lançada no financeiro ou corrigida à mão. Desfaça isso antes de trocar o criador."
          : null;

    const usuario = candidato.data as any;

    return NextResponse.json(
      {
        osId,
        status,
        criadorAtual: ordem.criador ? { id: String(ordem.criador.id), nome: ordem.criador.nome ?? null } : null,
        comissaoCriacaoAtual: comissaoAtual,
        semCobranca: status === "SEM_COBRANCA",
        bloqueio,
        mesesFechados,
        candidato: usuario
          ? {
              id: String(usuario.id),
              nome: usuario.nome ?? null,
              ativo: Boolean(usuario.ativo),
              percentualServicos: Number(usuario.comissao_criacao_servico_percent ?? 0),
              percentualProdutos: Number(usuario.comissao_criacao_produto_percent ?? 0),
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível carregar o criador da OS." },
      { status: statusDoErro(error) },
    );
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    await requirePerm(PERMS.ORDENS_ALTERAR_CRIADOR);
    const osId = idValido((await params).id);
    if (!osId) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}) as any);
    const usuarioId = uuidValido(body?.usuarioId);
    if (!usuarioId) {
      return NextResponse.json({ error: "Selecione o novo criador." }, { status: 400 });
    }

    const mesesAfetados = await mesesFechadosDaOs(osId);

    const { data, error } = await supabaseAdmin.rpc("trocar_criador_os", {
      p_ordemservicoid: osId,
      p_usuarioid: usuarioId,
    });
    if (error) {
      // P0001: recusa escrita para a tela. 55000: OS histórica, somente leitura.
      if (error.code === "P0001" || error.code === "55000") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    const resultado = (data ?? {}) as {
      criador_anterior: { id: string; nome: string | null } | null;
      criador_novo: { id: string; nome: string | null };
      comissao_anterior: number;
      comissao_nova: number;
      eventos_publicados: boolean;
    };

    const aviso =
      resultado.eventos_publicados && mesesAfetados.length
        ? `Esta OS tem lançamentos com competência em ${mesesAfetados.join(", ")}. ` +
          "A DRE desse período foi recalculada com a comissão de criação transferida."
        : null;

    return NextResponse.json({
      ok: true,
      osId,
      criadorAnterior: resultado.criador_anterior,
      criadorNovo: resultado.criador_novo,
      comissaoAnterior: Number(resultado.comissao_anterior ?? 0),
      comissaoNova: Number(resultado.comissao_nova ?? 0),
      eventosPublicados: Boolean(resultado.eventos_publicados),
      aviso,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Não foi possível trocar o criador da OS." },
      { status: statusDoErro(error) },
    );
  }
}
