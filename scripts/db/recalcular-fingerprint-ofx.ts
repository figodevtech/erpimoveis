/**
 * Recalcula o fingerprint dos movimentos de extrato gravados, sem o FITID.
 *
 * O fingerprint deixou de usar o FITID (ver src/lib/financeiro/ofx/fingerprint.ts):
 * o C6 gera um FITID novo a cada exportação, e o mesmo movimento em dois
 * arquivos entrava duas vezes. As linhas já gravadas têm o fingerprint antigo;
 * sem recalcular, um extrato reimportado não reconheceria nada do que já foi
 * conciliado. O cálculo usa `chaveBaseDoMovimento`, a MESMA função do app, sobre
 * as colunas gravadas — que reproduzem o fingerprint atual em 100% das linhas.
 *
 * Aproveita para corrigir o período da importação: o C6 declara em DTSTART e
 * DTEND o instante da exportação, e o período passa a conter os movimentos.
 *
 * NA GARAGE, ANTES DO RECÁLCULO: desfaz a importação #4.
 * É a segunda exportação do C6 (01/09–22/09), que entrou inteira como nova por
 * causa do FITID: as 27 linhas que ela tem em comum com a #1 colidiriam com as
 * da #1 no fingerprint novo. Nela só uma linha foi resolvida — o movimento 333,
 * conciliado com CRIAR, que gerou a transação 732. A 732 duplica a 341 (a
 * transferência da Cappta), que o movimento 7 da #1 já vincula; por isso sai
 * junto. Pela tela ela não sairia: a exclusão recusa transação liquidada.
 * Depois disso o arquivo é reimportado pela tela, já com o fingerprint novo.
 *
 * Uso:
 *   npm run db:ofx:fingerprint -- garage              # simula, não grava
 *   npm run db:ofx:fingerprint -- garage --aplicar    # grava
 *   (idem para demir e demo)
 *
 * Por segurança a rotina:
 * - simula por padrão e faz tudo numa transação por banco;
 * - só desfaz a #4 da Garage se ela estiver exatamente no estado descrito acima;
 * - só apaga a 732 se, fora do movimento 333, nada mais apontar para ela;
 * - recusa se o fingerprint novo colidir dentro de uma conta;
 * - confere antes do COMMIT que nenhum fingerprint ficou fora da regra nova.
 */
import { createHash } from "node:crypto";

import { chaveBaseDoMovimento } from "../../src/lib/financeiro/ofx/fingerprint";
import { connectDatabase, loadDatabaseConfigs, type DatabaseKey } from "./lib";

const argumentos = process.argv.slice(2);
const APLICAR = argumentos.includes("--aplicar");
const CHAVE = argumentos.find((arg) => !arg.startsWith("--")) as DatabaseKey | undefined;
const CHAVES_VALIDAS: DatabaseKey[] = ["demo", "demir", "garage"];

const GARAGE_IMPORTACAO_DUPLICADA = {
  id: 4,
  bancoId: 2,
  arquivoNome: "01M34V1SX3G5M1RXZFSPKFJCA1.ofx",
  movimentos: 35,
  movimentoResolvido: 333,
  transacaoCriada: 732,
};

type Client = Awaited<ReturnType<typeof connectDatabase>>["client"];

function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

function dia(valor: unknown): string {
  if (valor instanceof Date) {
    // `date` do Postgres chega como meia-noite local; o dia é o local.
    const ano = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const d = String(valor.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${d}`;
  }
  return String(valor).slice(0, 10);
}

async function desfazerImportacaoDuplicadaDaGarage(client: Client) {
  const alvo = GARAGE_IMPORTACAO_DUPLICADA;

  const { rows: importacao } = await client.query(
    `SELECT id, banco_id, arquivo_nome, quantidade_movimentos,
            (SELECT count(*) FROM public.ofx_movimento m WHERE m.importacao_id = i.id) AS gravados
       FROM public.ofx_importacao i WHERE id = $1`,
    [alvo.id],
  );

  if (importacao.length === 0) {
    console.log(`  importação #${alvo.id} não existe mais — nada a desfazer.`);
    return;
  }

  const imp = importacao[0];
  console.log(
    `  importação #${imp.id}: ${imp.arquivo_nome}, conta ${imp.banco_id}, ${imp.gravados} movimento(s)`,
  );
  if (
    Number(imp.banco_id) !== alvo.bancoId ||
    imp.arquivo_nome !== alvo.arquivoNome ||
    Number(imp.gravados) !== alvo.movimentos
  ) {
    throw new Error(`A importação #${alvo.id} não é a esperada. Confira antes de apagar.`);
  }

  const { rows: resolvidos } = await client.query(
    `SELECT id, status, acao_conciliacao, transacao_id, titulo_origem_id
       FROM public.ofx_movimento
      WHERE importacao_id = $1 AND status <> 'PENDENTE'`,
    [alvo.id],
  );
  const esperado =
    resolvidos.length === 1 &&
    Number(resolvidos[0].id) === alvo.movimentoResolvido &&
    resolvidos[0].acao_conciliacao === "CRIAR" &&
    Number(resolvidos[0].transacao_id) === alvo.transacaoCriada &&
    resolvidos[0].titulo_origem_id == null;
  if (!esperado) {
    console.log("  resolvidos na importação:", resolvidos);
    throw new Error(
      `A importação #${alvo.id} tem conciliações além do movimento ${alvo.movimentoResolvido}. Nada foi apagado.`,
    );
  }

  const { rows: transacao } = await client.query(
    `SELECT id, tipo::text AS tipo, descricao, valor::text AS valor, banco_id
       FROM public.transacao WHERE id = $1`,
    [alvo.transacaoCriada],
  );
  console.log("  transação criada pela conciliação:", transacao[0] ?? "(não existe)");
  if (
    transacao.length === 1 &&
    (transacao[0].tipo !== "RECEITA" || transacao[0].valor !== "4273.40" || Number(transacao[0].banco_id) !== alvo.bancoId)
  ) {
    throw new Error(`A transação ${alvo.transacaoCriada} não é a esperada. Nada foi apagado.`);
  }

  const apagada = await client.query(`DELETE FROM public.ofx_importacao WHERE id = $1`, [alvo.id]);
  console.log(`  apagada — importação #${alvo.id} (${apagada.rowCount}), com os movimentos em cascata`);

  if (transacao.length === 0) return;

  // Qualquer outra coisa apontando para a 732 significa que ela ganhou vida
  // própria depois da conciliação — aí apagar deixa de ser reparo.
  //
  // A exceção é o espelho dela no livro de eventos (source_type TRANSACAO,
  // source_id 732), que toda transação avulsa ganha por trigger. A FK é SET NULL
  // e `tg_eventos_financeiros_transacao_delete` o cancela na exclusão — o mesmo
  // caminho de quando a transação é excluída pela tela.
  const espelho = `AND NOT (source_type = 'TRANSACAO' AND source_id = $1)`;
  const { rows: chaves } = await client.query(
    `SELECT c.conrelid::regclass::text AS tabela, a.attname AS coluna
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'public.transacao'::regclass
        AND array_length(c.conkey, 1) = 1`,
  );
  for (const { tabela, coluna } of chaves) {
    const filtroEspelho = tabela === "eventos_financeiros" ? espelho : "";
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ${tabela} WHERE "${coluna}" = $1 ${filtroEspelho}`,
      [alvo.transacaoCriada],
    );
    if (rows[0].n > 0) {
      throw new Error(
        `A transação ${alvo.transacaoCriada} é referenciada por ${tabela}.${coluna}. Nada foi apagado.`,
      );
    }
  }

  const removida = await client.query(`DELETE FROM public.transacao WHERE id = $1`, [alvo.transacaoCriada]);
  console.log(`  apagada — transação ${alvo.transacaoCriada} (${removida.rowCount})`);

  const { rows: evento } = await client.query(
    `SELECT id, status FROM public.eventos_financeiros WHERE source_type = 'TRANSACAO' AND source_id = $1`,
    [alvo.transacaoCriada],
  );
  if (evento.some((linha) => linha.status === "ATIVO")) {
    throw new Error(`O espelho da transação ${alvo.transacaoCriada} no livro de eventos continuou ativo.`);
  }
  console.log(`  espelho no livro de eventos: ${evento.map((linha) => `#${linha.id} ${linha.status}`).join(", ") || "nenhum"}`);
}

async function recalcular(client: Client) {
  const { rows: importacoes } = await client.query(
    `SELECT id, banco_id, bank_id_ofx, agencia_ofx, conta_ofx FROM public.ofx_importacao ORDER BY id`,
  );
  const { rows: movimentos } = await client.query(
    `SELECT id, importacao_id, banco_id, data_postagem, valor_centavos, tipo_ofx,
            fitid, checknum, refnum, nome, memo, fingerprint
       FROM public.ofx_movimento ORDER BY importacao_id, sequencia, id`,
  );

  const porImportacao = new Map<string, typeof movimentos>();
  for (const movimento of movimentos) {
    const chave = String(movimento.importacao_id);
    porImportacao.set(chave, [...(porImportacao.get(chave) ?? []), movimento]);
  }

  const novos = new Map<number, string>();
  const usados = new Map<string, number>();
  let mudam = 0;

  for (const importacao of importacoes) {
    const cabecalho = {
      bankId: importacao.bank_id_ofx,
      branchId: importacao.agencia_ofx,
      acctId: importacao.conta_ofx,
    } as Parameters<typeof chaveBaseDoMovimento>[0];

    // A ocorrência é contada por arquivo, como em `calcularFingerprints`.
    const ocorrencias = new Map<string, number>();
    for (const linha of porImportacao.get(String(importacao.id)) ?? []) {
      const base = chaveBaseDoMovimento(cabecalho, {
        sequencia: 0,
        tipoOfx: linha.tipo_ofx,
        dataPostagem: dia(linha.data_postagem),
        dataDisponivel: null,
        valorCentavos: Number(linha.valor_centavos),
        fitid: linha.fitid,
        checknum: linha.checknum,
        refnum: linha.refnum,
        nome: linha.nome,
        memo: linha.memo,
      });
      const ocorrencia = (ocorrencias.get(base) ?? 0) + 1;
      ocorrencias.set(base, ocorrencia);
      const fingerprint = sha256(`${base}|#${ocorrencia}`);

      const naConta = `${linha.banco_id}:${fingerprint}`;
      const outro = usados.get(naConta);
      if (outro != null) {
        throw new Error(
          `Os movimentos ${outro} e ${linha.id} ficam com o mesmo fingerprint na conta ${linha.banco_id}. Nada foi gravado.`,
        );
      }
      usados.set(naConta, Number(linha.id));
      novos.set(Number(linha.id), fingerprint);
      if (fingerprint !== linha.fingerprint) mudam += 1;
    }
  }

  console.log(`  ${movimentos.length} movimento(s), ${mudam} com fingerprint novo, sem colisão`);
  if (mudam === 0) return novos;

  // Em duas fases: trocar direto bateria no índice único (banco_id,
  // fingerprint) sempre que o valor novo de uma linha for o antigo de outra.
  const ids = [...novos.keys()];
  const valores = ids.map((id) => novos.get(id)!);
  await client.query(
    `UPDATE public.ofx_movimento SET fingerprint = 'recalculando:' || id WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  await client.query(
    `UPDATE public.ofx_movimento m SET fingerprint = v.fingerprint
       FROM unnest($1::bigint[], $2::text[]) AS v(id, fingerprint)
      WHERE m.id = v.id`,
    [ids, valores],
  );
  return novos;
}

async function corrigirPeriodos(client: Client) {
  const { rows } = await client.query(
    `UPDATE public.ofx_importacao i
        SET periodo_inicio = least(coalesce(i.periodo_inicio, p.primeira), p.primeira),
            periodo_fim = greatest(coalesce(i.periodo_fim, p.ultima), p.ultima)
       FROM (SELECT importacao_id, min(data_postagem) AS primeira, max(data_postagem) AS ultima
               FROM public.ofx_movimento GROUP BY importacao_id) p
      WHERE p.importacao_id = i.id
        AND (i.periodo_inicio IS DISTINCT FROM least(coalesce(i.periodo_inicio, p.primeira), p.primeira)
          OR i.periodo_fim IS DISTINCT FROM greatest(coalesce(i.periodo_fim, p.ultima), p.ultima))
      RETURNING i.id, i.arquivo_nome, i.periodo_inicio::text AS inicio, i.periodo_fim::text AS fim`,
  );
  if (rows.length === 0) {
    console.log("  períodos já contêm os movimentos");
    return;
  }
  for (const linha of rows) {
    console.log(`  período — importação #${linha.id} (${linha.arquivo_nome}): ${linha.inicio} → ${linha.fim}`);
  }
}

async function main() {
  if (!CHAVE || !CHAVES_VALIDAS.includes(CHAVE)) {
    throw new Error(`Informe o banco: ${CHAVES_VALIDAS.join(", ")}. Ex.: npm run db:ofx:fingerprint -- garage`);
  }

  const configuracao = loadDatabaseConfigs().find((item) => item.key === CHAVE);
  if (!configuracao) throw new Error(`O banco ${CHAVE} não está configurado.`);

  console.log(`${configuracao.label}${APLICAR ? "" : " (simulação)"}`);
  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN");

    if (CHAVE === "garage") await desfazerImportacaoDuplicadaDaGarage(client);
    const novos = await recalcular(client);
    await corrigirPeriodos(client);

    /* ---------------- conferência ---------------- */

    const { rows: gravados } = await client.query(`SELECT id, fingerprint FROM public.ofx_movimento`);
    const fora = gravados.filter((linha) => novos.get(Number(linha.id)) !== linha.fingerprint);
    if (fora.length > 0 || gravados.length !== novos.size) {
      throw new Error(`${fora.length} movimento(s) ficaram fora da regra nova.`);
    }
    console.log(`  conferência: ${gravados.length} fingerprint(s) pela regra nova`);

    if (APLICAR) {
      await client.query("COMMIT");
      console.log("\nAplicado.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nSimulação — nada foi gravado. Rode com --aplicar para valer.");
    }
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`\nNada foi gravado: ${erro instanceof Error ? erro.message : erro}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
