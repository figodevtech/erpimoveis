/**
 * Preenche no Demir o custo dos itens que sairam sem custo cadastrado.
 *
 * Regra: custo = 40% do preco de venda do item. Decisao do dono da operacao,
 * tomada em 17/08/2026 depois da conferencia de custo.
 *
 * O QUE ISTO SIGNIFICA — LEIA ANTES DE RODAR
 * Este e um custo ESTIMADO. Ele nao veio de nota nem de entrada de estoque: e um
 * percentual arbitrado sobre o preco de venda. Depois de aplicado, a linha 4.1
 * da DRE deixa de ser conferivel contra documento, e nao ha campo no banco que
 * separe custo real de custo estimado — a unica marca fica na saida deste script
 * e no registro em `docs/dre.md`.
 *
 * O motivo de existir: sem custo nenhum, esses itens entram com margem de 100%,
 * o que distorce a DRE mais do que uma estimativa razoavel.
 *
 * Uso:
 *   npm run db:custo:estimado                 # simula, lista os itens, nao grava
 *   npm run db:custo:estimado -- --aplicar    # grava
 *   npm run db:custo:estimado -- --percentual=50 --aplicar
 *
 * Por seguranca a rotina:
 * - conecta exclusivamente ao Demir;
 * - simula por padrao;
 * - so toca item com custo ZERO — nunca sobrescreve custo ja informado;
 * - so toca item com preco de venda maior que zero (40% de zero e zero);
 * - grava na ORIGEM (`custo_unitario_aplicado`), nao no evento: o evento e
 *   regerado a partir dela, e mexer so no evento seria desfeito na proxima
 *   reconciliacao;
 * - reprocessa os documentos afetados para os eventos acompanharem;
 * - faz tudo numa transacao e mostra o efeito na DRE antes do COMMIT.
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

const ARGUMENTOS = process.argv.slice(2);
const APLICAR = ARGUMENTOS.includes("--aplicar");

const PERCENTUAL = (() => {
  const informado = ARGUMENTOS.find((valor) => valor.startsWith("--percentual="));
  const numero = informado ? Number(informado.split("=")[1]) : 40;
  if (!Number.isFinite(numero) || numero <= 0 || numero >= 100) {
    throw new Error("Informe um percentual entre 1 e 99.");
  }
  return numero;
})();

const FATOR = PERCENTUAL / 100;

/** Status de OS em que o orcamento vale e o custo faz sentido. */
const STATUS_OS_ATIVA = ["ORCAMENTO_APROVADO", "EM_ANDAMENTO", "PAGAMENTO", "CONCLUIDO"];

async function totalDoGrupo(client: any, prefixo: string) {
  const { rows } = await client.query(
    `SELECT coalesce(sum(s.valor), 0) AS total
       FROM public.dre_somar_por_linha(1, '1900-01-01'::timestamptz, '2999-12-31'::timestamptz) s
       JOIN public.dre_linha dl ON dl.id = s.linha_id
      WHERE dl.codigo LIKE $1`,
    [prefixo],
  );
  return Number(rows[0].total);
}

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!configuracao) throw new Error("O banco Demir não está configurado.");

  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN");

    console.log(`Custo estimado = ${PERCENTUAL}% do preço de venda.\n`);

    const custoAntes = await totalDoGrupo(client, "4.%");

    /* ---------------- o que vai mudar ---------------- */

    const { rows: itensVenda } = await client.query(
      `SELECT vp.id, vp.venda_id, vp.produtoid, vp.quantidade, vp.sub_total,
              round(vp.sub_total * $1 / nullif(vp.quantidade, 0), 4) AS custo_novo,
              coalesce(nullif(p.titulo, ''), p.descricao, '?') AS produto
         FROM public.vendaproduto vp
         JOIN public.venda v ON v.id = vp.venda_id
         LEFT JOIN public.produto p ON p.id = vp.produtoid
        WHERE coalesce(vp.custo_unitario_aplicado, 0) = 0
          AND coalesce(vp.sub_total, 0) > 0
          AND public.venda_reconhece_receita(v.status::text)
        ORDER BY vp.sub_total DESC`,
      [FATOR],
    );

    const { rows: itensOs } = await client.query(
      `SELECT op.ordemservicoid, op.produtoid, op.quantidade, op.precounitario,
              round(op.precounitario * $1, 4) AS custo_novo,
              coalesce(nullif(p.titulo, ''), p.descricao, '?') AS produto
         FROM public.osproduto op
         JOIN public.ordemservico o ON o.id = op.ordemservicoid
         LEFT JOIN public.produto p ON p.id = op.produtoid
        WHERE coalesce(op.custo_unitario_aplicado, 0) = 0
          AND coalesce(op.precounitario, 0) > 0
          AND coalesce(o.is_deleted, false) = false
          AND o.status::text = ANY($2)
        ORDER BY op.precounitario * op.quantidade DESC`,
      [FATOR, STATUS_OS_ATIVA],
    );

    console.log(`Itens de venda sem custo: ${itensVenda.length}`);
    for (const item of itensVenda.slice(0, 10)) {
      console.log(
        `  venda #${item.venda_id} · ${String(item.produto).slice(0, 32)} · ` +
          `venda R$ ${item.sub_total} → custo unit. R$ ${item.custo_novo}`,
      );
    }
    if (itensVenda.length > 10) console.log(`  ... e mais ${itensVenda.length - 10}`);

    console.log(`\nItens de OS sem custo: ${itensOs.length}`);
    for (const item of itensOs.slice(0, 10)) {
      console.log(
        `  OS #${item.ordemservicoid} · ${String(item.produto).slice(0, 32)} · ` +
          `preço R$ ${item.precounitario} → custo unit. R$ ${item.custo_novo}`,
      );
    }
    if (itensOs.length > 10) console.log(`  ... e mais ${itensOs.length - 10}`);

    if (itensVenda.length === 0 && itensOs.length === 0) {
      console.log("\nNenhum item sem custo. Nada a fazer.");
      await client.query("ROLLBACK");
      return;
    }

    /* ---------------- grava na origem ---------------- */

    const { rowCount: gravadosVenda } = await client.query(
      `UPDATE public.vendaproduto vp
          SET custo_unitario_aplicado = round(vp.sub_total * $1 / nullif(vp.quantidade, 0), 4)
         FROM public.venda v
        WHERE v.id = vp.venda_id
          AND coalesce(vp.custo_unitario_aplicado, 0) = 0
          AND coalesce(vp.sub_total, 0) > 0
          AND public.venda_reconhece_receita(v.status::text)`,
      [FATOR],
    );

    const { rowCount: gravadosOs } = await client.query(
      `UPDATE public.osproduto op
          SET custo_unitario_aplicado = round(op.precounitario * $1, 4)
         FROM public.ordemservico o
        WHERE o.id = op.ordemservicoid
          AND coalesce(op.custo_unitario_aplicado, 0) = 0
          AND coalesce(op.precounitario, 0) > 0
          AND coalesce(o.is_deleted, false) = false
          AND o.status::text = ANY($2)`,
      [FATOR, STATUS_OS_ATIVA],
    );

    console.log(`\nGravado na origem — venda: ${gravadosVenda} item(ns), OS: ${gravadosOs} item(ns)`);

    /* ---------------- refaz os lançamentos ---------------- */

    const vendasAfetadas = [...new Set(itensVenda.map((item) => Number(item.venda_id)))];
    for (const id of vendasAfetadas) {
      await client.query("SELECT public.sincronizar_eventos_financeiros_venda($1)", [id]);
    }

    const ordensAfetadas = [...new Set(itensOs.map((item) => Number(item.ordemservicoid)))];
    let ordensPuladas = 0;
    for (const id of ordensAfetadas) {
      try {
        await client.query("SAVEPOINT reconciliar");
        await client.query("SELECT public.reconciliar_eventos_financeiros_os($1)", [id]);
        await client.query("RELEASE SAVEPOINT reconciliar");
      } catch (erro) {
        // A reconciliação recusa OS com evento CONVERTIDO divergente: a despesa
        // já virou transação e mexer nela aqui desencontraria os dois lados.
        await client.query("ROLLBACK TO SAVEPOINT reconciliar");
        ordensPuladas += 1;
        console.log(`  OS #${id} pulada: ${erro instanceof Error ? erro.message : erro}`);
      }
    }

    console.log(
      `Reprocessados — ${vendasAfetadas.length} venda(s), ` +
        `${ordensAfetadas.length - ordensPuladas} OS (${ordensPuladas} pulada(s))`,
    );

    /* ---------------- efeito na DRE ---------------- */

    const custoDepois = await totalDoGrupo(client, "4.%");
    const receita = await totalDoGrupo(client, "1.%");

    console.log("\nEfeito na DRE (todo o histórico):");
    console.log(`  receita bruta      R$ ${receita.toFixed(2)}`);
    console.log(`  CUSTOS antes       R$ ${custoAntes.toFixed(2)}`);
    console.log(`  CUSTOS depois      R$ ${custoDepois.toFixed(2)}`);
    console.log(`  o lucro cai        R$ ${(custoDepois - custoAntes).toFixed(2)}`);

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
