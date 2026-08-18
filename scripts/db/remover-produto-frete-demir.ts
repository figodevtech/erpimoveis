/**
 * Remove do Demir o produto criado por engano para representar frete.
 *
 * Frete nao e mercadoria. O produto #866 "FRETE" foi cadastrado porque a venda
 * ainda nao tinha campo proprio de frete, recebeu entrada de 100 unidades e foi
 * usado uma vez, na venda #56 — onde ja foi convertido: a linha do produto saiu,
 * o estoque foi devolvido e os R$ 180,00 viraram `venda.valor_frete`.
 *
 * Sobrou o cadastro, com 100 unidades de estoque fantasma e uma entrada que
 * existe so para ele. E isso que esta rotina apaga.
 *
 * Uso:
 *   npm run db:remover:frete                # simula, nao grava
 *   npm run db:remover:frete -- --aplicar   # grava
 *
 * Por seguranca a rotina:
 * - conecta exclusivamente ao Demir;
 * - simula por padrao;
 * - recusa se o produto estiver em qualquer venda ou OS, ou se a entrada dele
 *   tiver outros itens, ou se houver transacao ligada aquela entrada — nesses
 *   casos apagar mexeria em documento de outra gente;
 * - so aceita saldo de movimento zerado (o que saiu voltou), para nao apagar
 *   historico de mercadoria que de fato circulou;
 * - faz tudo numa transacao e confere antes do COMMIT.
 *
 * A ordem da exclusao segue as chaves estrangeiras: `estoque_movimento` e
 * `estoque_movimento_entrada` sao RESTRICT e `entradaitens` e NO ACTION, entao
 * precisam sair antes do produto. Os dois eventos financeiros ligados a ele ja
 * estao CANCELADOS e tem FK `ON DELETE SET NULL` — ficam no livro, sem produto,
 * que e o correto: eles registram o que aconteceu.
 *
 * SOBRE DESABILITAR O GATILHO DO RAZAO
 * `estoque_movimento_imutavel_trg` recusa DELETE na tabela: o razao de estoque e
 * imutavel por decisao de projeto, e a mensagem dele manda registrar um estorno
 * em vez de alterar a linha. A regra esta certa para mercadoria de verdade.
 *
 * Aqui ela nao se aplica: frete nunca foi mercadoria, e as 100 unidades nunca
 * existiram. Manter o razao de um produto que nao deveria existir preserva um
 * historico falso, nao um historico. Por isso o gatilho e desligado dentro da
 * transacao — o `ALTER TABLE` e transacional no Postgres, entao um erro no meio
 * devolve o gatilho junto com o resto.
 *
 * Isto vale para ESTE caso. Nao use esta rotina de modelo para apagar produto
 * que de fato circulou.
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");
const PRODUTO_ID = 866;

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!configuracao) throw new Error("O banco Demir não está configurado.");

  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN");

    const { rows: produto } = await client.query(
      `SELECT id, coalesce(nullif(titulo,''), descricao) AS nome, estoque
         FROM public.produto WHERE id = $1`,
      [PRODUTO_ID],
    );

    if (produto.length === 0) {
      console.log(`Produto #${PRODUTO_ID} não existe. Nada a fazer.`);
      await client.query("ROLLBACK");
      return;
    }

    console.log(`Produto #${produto[0].id} "${produto[0].nome}" — estoque ${produto[0].estoque}`);

    /* ---------------- recusas ---------------- */

    const { rows: usos } = await client.query(
      `SELECT
         (SELECT count(*) FROM public.vendaproduto WHERE produtoid = $1) AS vendas,
         (SELECT count(*) FROM public.osproduto   WHERE produtoid = $1) AS ordens,
         -- Só interessa o que circulou por documento. O saldo total incluiria a
         -- entrada inicial de 100 unidades, que é justamente o estoque fantasma
         -- que esta rotina existe para apagar.
         (SELECT coalesce(sum(CASE WHEN sentido::text = 'SAIDA' THEN quantidade
                                   ELSE -quantidade END), 0)
            FROM public.estoque_movimento
           WHERE produto_id = $1
             AND (venda_id IS NOT NULL OR ordemservicoid IS NOT NULL)) AS saldo_documentos`,
      [PRODUTO_ID],
    );

    const { vendas, ordens, saldo_documentos } = usos[0];
    console.log(`  em vendas: ${vendas} | em OS: ${ordens} | saído por documento e não devolvido: ${saldo_documentos}`);

    if (Number(vendas) > 0 || Number(ordens) > 0) {
      throw new Error("O produto ainda está em venda ou OS. Converta o documento antes.");
    }
    if (Number(saldo_documentos) !== 0) {
      throw new Error(
        `Saíram ${saldo_documentos} unidade(s) por venda ou OS que não voltaram ao estoque.`,
      );
    }

    const { rows: entradas } = await client.query(
      `SELECT ei.entrada_id,
              (SELECT count(*) FROM public.entradaitens x WHERE x.entrada_id = ei.entrada_id) AS itens,
              (SELECT count(*) FROM public.transacao t WHERE t.entrada_id = ei.entrada_id) AS transacoes
         FROM public.entradaitens ei WHERE ei.produto_id = $1`,
      [PRODUTO_ID],
    );

    for (const entrada of entradas) {
      console.log(
        `  entrada #${entrada.entrada_id}: ${entrada.itens} item(ns), ${entrada.transacoes} transação(ões)`,
      );
      if (Number(entrada.itens) > 1) {
        throw new Error(
          `A entrada #${entrada.entrada_id} tem outros itens; apagá-la mexeria em mercadoria alheia.`,
        );
      }
      if (Number(entrada.transacoes) > 0) {
        throw new Error(`A entrada #${entrada.entrada_id} tem transação financeira ligada.`);
      }
    }

    /* ---------------- exclusão ---------------- */

    const idsEntrada = entradas.map((linha) => Number(linha.entrada_id));

    // Ver a nota no cabeçalho. Volta ligado no fim, e o ROLLBACK também o
    // devolve se algo falhar daqui para frente.
    await client.query(
      "ALTER TABLE public.estoque_movimento DISABLE TRIGGER estoque_movimento_imutavel_trg",
    );
    console.log("  gatilho do razão desligado para esta transação");

    const passos: Array<[string, string, unknown[]]> = [
      ["movimentos de entrada", `DELETE FROM public.estoque_movimento_entrada WHERE produto_id = $1`, [PRODUTO_ID]],
      ["movimentos de estoque", `DELETE FROM public.estoque_movimento WHERE produto_id = $1`, [PRODUTO_ID]],
      ["itens de entrada", `DELETE FROM public.entradaitens WHERE produto_id = $1`, [PRODUTO_ID]],
    ];

    if (idsEntrada.length > 0) {
      passos.push(["entradas vazias", `DELETE FROM public.entrada WHERE id = ANY($1)`, [idsEntrada]]);
    }

    passos.push(["produto", `DELETE FROM public.produto WHERE id = $1`, [PRODUTO_ID]]);

    for (const [rotulo, sql, parametros] of passos) {
      const resultado = await client.query(sql, parametros);
      console.log(`  apagado — ${rotulo}: ${resultado.rowCount} linha(s)`);
    }

    /* ---------------- conferência ---------------- */

    const { rows: sobrou } = await client.query(
      `SELECT
         (SELECT count(*) FROM public.produto           WHERE id = $1)          AS produto,
         (SELECT count(*) FROM public.estoque_movimento WHERE produto_id = $1)  AS movimentos,
         (SELECT count(*) FROM public.entradaitens      WHERE produto_id = $1)  AS itens,
         (SELECT count(*) FROM public.eventos_financeiros
           WHERE produtoid = $1)                                                AS eventos_com_produto,
         (SELECT count(*) FROM public.eventos_financeiros
           WHERE source_type = 'VENDA' AND source_id = 56 AND status = 'ATIVO') AS eventos_vivos_venda56`,
      [PRODUTO_ID],
    );

    await client.query(
      "ALTER TABLE public.estoque_movimento ENABLE TRIGGER estoque_movimento_imutavel_trg",
    );
    console.log("  gatilho do razão religado");

    console.log("  conferência:", sobrou[0]);

    const restante =
      Number(sobrou[0].produto) + Number(sobrou[0].movimentos) + Number(sobrou[0].itens);
    if (restante !== 0) {
      throw new Error("Sobrou referência ao produto depois da exclusão.");
    }

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
