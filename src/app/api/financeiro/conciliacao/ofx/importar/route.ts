export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { requireFinanceiroCreate, requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { centavosParaReais } from "@/lib/financeiro/ofx/normalize";
import { ErroDeOfx } from "@/lib/financeiro/ofx/types";
import { analisarExtrato, lerArquivoEnviado } from "../_lib/analise";
import {
  ACOES_DE_EDICAO,
  aplicarDecisao,
  chavesDaDecisao,
  normalizarDecisao,
  type Decisao,
  type ResultadoDecisao,
} from "../_lib/conciliar";

/**
 * A confirmação: grava o extrato e aplica as decisões do usuário.
 *
 * O arquivo é lido DE NOVO aqui, em vez de a tela devolver os movimentos que
 * recebeu na análise. É o que garante que o que vai para o banco é o que o
 * banco emissor escreveu — fingerprint, valor e data saem do arquivo, não de um
 * corpo de requisição que poderia ter sido editado no caminho.
 *
 * A gravação do extrato é atômica (uma RPC para o arquivo inteiro) e cada
 * decisão é atômica por conta própria. Uma baixa que falhe deixa o movimento
 * dela em aberto na importação, para o usuário resolver depois — o que é
 * melhor do que descartar as trinta que deram certo.
 */
export async function POST(req: Request) {
  try {
    await requireFinanceiroCreate();
    const session = await auth();
    const usuarioId = ((session?.user as any)?.id as string | undefined) ?? null;

    const formData = await req.formData();

    const bancoId = Number(formData.get("bancoId"));
    if (!Number.isSafeInteger(bancoId) || bancoId <= 0) {
      return NextResponse.json({ error: "Escolha a conta bancária do extrato." }, { status: 400 });
    }

    const decisoes = lerDecisoes(formData.get("decisoes"));
    if (decisoes === null) {
      return NextResponse.json(
        { error: "As decisões de conciliação vieram em formato inválido." },
        { status: 400 },
      );
    }
    if (decisoes.some((decisao) => ACOES_DE_EDICAO.has(decisao.acao))) {
      await requireFinanceiroEdit();
    }

    const arquivo = await lerArquivoEnviado(formData);
    const movimentos = await analisarExtrato(arquivo, bancoId);

    const { data: registro, error } = await supabaseAdmin.rpc("registrar_importacao_ofx", {
      p_banco_id: bancoId,
      p_arquivo_nome: arquivo.nome,
      p_arquivo_hash: arquivo.hash,
      p_cabecalho: {
        bankId: arquivo.extrato.cabecalho.bankId,
        branchId: arquivo.extrato.cabecalho.branchId,
        acctId: arquivo.extrato.cabecalho.acctId,
        acctType: arquivo.extrato.cabecalho.acctType,
        moeda: arquivo.extrato.cabecalho.moeda,
        periodoInicio: arquivo.extrato.cabecalho.periodoInicio,
        periodoFim: arquivo.extrato.cabecalho.periodoFim,
        saldoInicial:
          arquivo.saldoInicialCentavos == null
            ? null
            : String(centavosParaReais(arquivo.saldoInicialCentavos)),
        saldoFinal:
          arquivo.extrato.cabecalho.saldoFinalCentavos == null
            ? null
            : String(centavosParaReais(arquivo.extrato.cabecalho.saldoFinalCentavos)),
      },
      p_movimentos: movimentos.map((movimento) => ({
        sequencia: movimento.sequencia,
        fitid: movimento.fitid,
        checknum: movimento.checknum,
        refnum: movimento.refnum,
        tipoOfx: movimento.tipoOfx,
        dataPostagem: movimento.dataPostagem,
        dataDisponivel: movimento.dataDisponivel,
        valorCentavos: movimento.valorCentavos,
        nome: movimento.nome,
        memo: movimento.memo,
        fingerprint: movimento.fingerprint,
        situacao: movimento.analise.situacao,
        score: movimento.analise.score,
        observacao: movimento.analise.observacao,
      })),
      p_created_by: usuarioId,
    });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }

    const importacaoId = Number((registro as any)?.importacao_id);
    const porFingerprint = new Map<string, number>();
    for (const linha of ((registro as any)?.movimentos ?? []) as Array<{
      fingerprint: string;
      movimento_id: number | null;
    }>) {
      if (linha.movimento_id != null) porFingerprint.set(linha.fingerprint, Number(linha.movimento_id));
    }

    const resultados: ResultadoDecisao[] = [];
    for (const decisao of decisoes) {
      const chaves = chavesDaDecisao(decisao);
      const movimentoIds = chaves
        .map((chave) => porFingerprint.get(chave))
        .filter((valor): valor is number => valor != null);

      /*
       * O grupo é tudo ou nada.
       *
       * Se uma das linhas não entrou no arquivo — repetida de outro extrato, por
       * exemplo —, conciliar as que sobraram fecharia o lançamento com uma soma
       * menor do que ele. Melhor deixar o ato inteiro em aberto e dizer por quê.
       */
      if (!movimentoIds.length || movimentoIds.length !== chaves.length) {
        resultados.push({
          movimentoId: movimentoIds[0] ?? 0,
          movimentoIds,
          fingerprint: decisao.fingerprint ?? null,
          fingerprints: chaves,
          ok: false,
          acao: decisao.acao,
          transacaoId: null,
          erro:
            chaves.length > 1
              ? "Alguma das linhas conciliadas juntas não faz parte do arquivo importado."
              : "Este movimento não faz parte do arquivo importado.",
        });
        continue;
      }

      resultados.push(await aplicarDecisao(movimentoIds, decisao, usuarioId));
    }

    return NextResponse.json({
      data: {
        importacaoId,
        quantidadeMovimentos: (registro as any)?.quantidade_movimentos ?? 0,
        quantidadeImportados: (registro as any)?.quantidade_importados ?? 0,
        quantidadeRepetidos: (registro as any)?.quantidade_repetidos ?? 0,
        // Linhas do extrato, nao atos: uma conciliacao N:1 resolve duas de uma vez,
        // e a tela diz "movimentos processados".
        conciliados: resultados
          .filter((resultado) => resultado.ok)
          .reduce((total, resultado) => total + resultado.movimentoIds.length, 0),
        falhas: resultados.filter((resultado) => !resultado.ok),
        resultados,
      },
    });
  } catch (error: any) {
    if (error instanceof ErroDeOfx) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const statusCode = Number(error?.statusCode ?? 500);
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json({ error: error.message }, { status: statusCode });
    }

    console.error("POST /api/financeiro/conciliacao/ofx/importar", error);
    return NextResponse.json({ error: "Não foi possível importar o extrato." }, { status: 500 });
  }
}

/** Devolve `null` quando o campo veio malformado — lista vazia é legítima. */
function lerDecisoes(bruto: FormDataEntryValue | null): Decisao[] | null {
  if (bruto == null || bruto === "") return [];
  if (typeof bruto !== "string") return null;

  let cru: unknown;
  try {
    cru = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!Array.isArray(cru)) return null;

  const decisoes: Decisao[] = [];
  for (const item of cru) {
    const decisao = normalizarDecisao(item);
    if (!decisao) return null;
    decisoes.push(decisao);
  }
  return decisoes;
}
