/** Valida a migration em demonstração e desfaz tudo, inclusive as colunas. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

async function main() {
  const database = loadDatabaseConfigs().find((item) => item.key === "cespedes")!;
  const { client } = await connectDatabase(database);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const columns = await client.query(`SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'osproduto_avulso'
      AND column_name = 'desconto_informativo'`);
    if (!columns.rowCount) {
      await client.query(fs.readFileSync(path.join(projectRoot,
        "supabase/migrations/20260923000200_desconto_informativo_produtos_avulsos.sql"), "utf8"));
    }
    for (const table of ["osproduto_avulso", "orcamento_produto_avulso"]) {
      // Sem FKs ou triggers de negócio: somente a estrutura e constraints reais.
      await client.query(`CREATE TEMP TABLE teste_${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP`);
      const parentColumn = table === "osproduto_avulso" ? "ordemservicoid" : "orcamentoid";
      await client.query(`INSERT INTO teste_${table}
        (id, ${parentColumn}, titulo, quantidade, precounitario, subtotal)
        VALUES (1, 1, 'Teste desconto informativo', 2, 100, 200)`);
      for (const tipo of ["FIXO", "PORCENTAGEM"]) {
        const result = await client.query(`UPDATE teste_${table}
          SET desconto_informativo_tipo = $1, desconto_informativo = 25
          RETURNING subtotal::text, desconto::text, desconto_informativo::text`, [tipo]);
        assert.equal(Number(result.rows[0].subtotal), 200);
        assert.equal(Number(result.rows[0].desconto), 0);
        assert.equal(Number(result.rows[0].desconto_informativo), 25);
      }
      for (const [tipo, valor] of [["FIXO", -1], ["PORCENTAGEM", 101], [null, 25], ["FIXO", "NaN"]]) {
        await client.query("SAVEPOINT valor_invalido");
        await assert.rejects(client.query(`UPDATE teste_${table}
          SET desconto_informativo_tipo = $1, desconto_informativo = $2`, [tipo, valor]),
          (error: { code?: string }) => error.code === "23514");
        await client.query("ROLLBACK TO SAVEPOINT valor_invalido");
      }
      console.log(`${table}: gravação, subtotal preservado e constraints OK.`);
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
    console.log("Rollback concluído; nenhuma alteração persistida.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha na validação.");
  process.exitCode = 1;
});
