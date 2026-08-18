/**
 * Reconstroi no Demir a baixa de estoque da venda #51, que nunca aconteceu.
 *
 * O QUE FALTOU
 * A venda #51 (27/07, CAIO GIOVANI, R$ 3.500, 1x MODULO DE CABINE LU 12V) foi
 * criada em 27/07 as 14:43 — no mesmo dia da migration
 * `20260727170000_control_sale_budget_stock.sql`, que criou o rastreamento de
 * baixa, e antes dela valer. E a unica venda da base sem `vendaproduto_baixa`:
 * as 47 seguintes, de 28/07 em diante, todas tem.
 *
 * Resultado: a peca foi vendida e entregue sem nunca passar pelo estoque. Nao ha
 * entrada da compra dela nem saida da venda.
 *
 * POR QUE SAO DOIS MOVIMENTOS E NAO UM
 * `fn_baixa_estoque_produto` recusa baixa sem saldo, e o produto esta com
 * estoque 0 — a peca que entrou depois (entrada #828, 11/08) ja saiu pela venda
 * #106. Registrar so a saida deixaria o saldo em -1, que e falso.
 *
 * "Como se tivesse sido tudo certo" sao os dois lados: a compra que trouxe a
 * peca e a venda que a levou. Saldo final inalterado — entra 1, sai 1.
 *
 * POR QUE COM A DATA DE HOJE
 * O razao encadeia `saldo_anterior` e `saldo_resultante` movimento a movimento.
 * Inserir no passado obrigaria a reescrever a cadeia dos movimentos seguintes —
 * exatamente o que `estoque_movimento_imutavel_trg` existe para impedir. Os dois
 * movimentos entram agora, com o rotulo dizendo o que sao e a que venda se
 * referem. E o registro honesto: a correcao aconteceu hoje.
 *
 * O custo da entrada e R$ 1.400,00 — o mesmo que a venda ja carrega em
 * `custo_unitario_aplicado`, a estimativa de 40% aplicada em 17/08. Assim o
 * razao e a DRE contam a mesma historia.
 *
 * Uso:
 *   npm run db:reconstruir:baixa51                # simula
 *   npm run db:reconstruir:baixa51 -- --aplicar   # grava
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");
const VENDA_ID = 51;
const PRODUTO_ID = 623;
const QUANTIDADE = 1;
const CUSTO_UNITARIO = 1400;

async function estoqueAtual(client: any) {
  const { rows } = await client.query("SELECT estoque FROM public.produto WHERE id = $1", [PRODUTO_ID]);
  return Number(rows[0]?.estoque ?? NaN);
}

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!configuracao) throw new Error("O banco Demir não está configurado.");

  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN");

    /* ---------------- recusas ---------------- */

    const { rows: venda } = await client.query(
      `SELECT v.id, v.status::text AS status, v.datavenda::date AS data,
              (SELECT count(*) FROM public.vendaproduto_baixa b WHERE b.venda_id = v.id) AS baixas,
              (SELECT count(*) FROM public.estoque_movimento m
                WHERE m.venda_id = v.id AND m.produto_id = $2) AS movimentos
         FROM public.venda v WHERE v.id = $1`,
      [VENDA_ID, PRODUTO_ID],
    );

    if (venda.length === 0) throw new Error(`Venda #${VENDA_ID} não existe.`);
    console.log(`Venda #${VENDA_ID} [${venda[0].status}] de ${venda[0].data}`);
    console.log(`  baixas registradas: ${venda[0].baixas} | movimentos de estoque: ${venda[0].movimentos}`);

    if (Number(venda[0].baixas) > 0 || Number(venda[0].movimentos) > 0) {
      throw new Error("Esta venda já tem baixa ou movimento de estoque. Nada a reconstruir.");
    }

    const { rows: item } = await client.query(
      `SELECT quantidade, custo_unitario_aplicado FROM public.vendaproduto
        WHERE venda_id = $1 AND produtoid = $2`,
      [VENDA_ID, PRODUTO_ID],
    );
    if (item.length !== 1) throw new Error("O item esperado não está na venda.");
    if (Number(item[0].quantidade) !== QUANTIDADE) {
      throw new Error(`A quantidade do item é ${item[0].quantidade}, esperava ${QUANTIDADE}.`);
    }

    const antes = await estoqueAtual(client);
    console.log(`  estoque do produto #${PRODUTO_ID} antes: ${antes}`);

    /* ---------------- a compra que faltou ---------------- */

    await client.query("SELECT public.estoque_definir_contexto($1, $2, $3, NULL)", [
      "ENTRADA",
      null,
      `Correção — compra não registrada da venda #${VENDA_ID}`,
    ]);
    await client.query(
      `UPDATE public.produto
          SET estoque = estoque + $2,
              ultimovalordecompra = CASE WHEN coalesce(ultimovalordecompra, 0) = 0
                                         THEN $3 ELSE ultimovalordecompra END,
              updatedat = now()
        WHERE id = $1`,
      [PRODUTO_ID, QUANTIDADE, CUSTO_UNITARIO],
    );
    console.log(`  entrada registrada: +${QUANTIDADE} (estoque ${await estoqueAtual(client)})`);

    /* ---------------- a baixa que faltou ---------------- */

    await client.query("SELECT public.estoque_definir_contexto($1, $2, $3, NULL)", [
      "VENDA",
      VENDA_ID,
      `Venda #${VENDA_ID}`,
    ]);
    await client.query("SELECT public.fn_baixa_estoque_produto($1, $2)", [PRODUTO_ID, QUANTIDADE]);

    await client.query(
      `INSERT INTO public.vendaproduto_baixa (venda_id, produtoid, quantidade, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (venda_id, produtoid) DO UPDATE SET quantidade = excluded.quantidade`,
      [VENDA_ID, PRODUTO_ID, QUANTIDADE],
    );

    const depois = await estoqueAtual(client);
    console.log(`  baixa registrada: -${QUANTIDADE} (estoque ${depois})`);

    if (depois !== antes) {
      throw new Error(`O estoque mudou de ${antes} para ${depois}; deveria ficar igual.`);
    }

    /* ---------------- conferência ---------------- */

    const { rows: conferencia } = await client.query(
      `SELECT
         (SELECT count(*) FROM public.vendaproduto_baixa WHERE venda_id = $1) AS baixas,
         (SELECT count(*) FROM public.estoque_movimento
           WHERE venda_id = $1 AND produto_id = $2) AS saidas_da_venda,
         (SELECT coalesce(sum(CASE WHEN sentido::text = 'ENTRADA' THEN quantidade
                                   ELSE -quantidade END), 0)
            FROM public.estoque_movimento WHERE produto_id = $2) AS razao,
         (SELECT estoque FROM public.produto WHERE id = $2) AS cadastro`,
      [VENDA_ID, PRODUTO_ID],
    );

    console.log("  conferência:", conferencia[0]);
    if (Number(conferencia[0].razao) !== Number(conferencia[0].cadastro)) {
      throw new Error("Razão e cadastro divergiram.");
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
