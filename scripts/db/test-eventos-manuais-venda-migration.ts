/** Aplica apenas a migration desta tarefa e testa em uma transação sempre revertida. */
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";
import { splitLikeSupabaseCli } from "./supabase-splitter";

const migration = "20261005162941_eventos_financeiros_manuais_venda.sql";
const testes = ["eventos_manuais_venda.sql", "despesa_frete_venda.sql", "comissao_de_vendas.sql", "exclusao_evento_manual_e_despesa_frete.sql"];

async function main() {
  const banco = loadDatabaseConfigs().find((item) => item.key === "demo");
  if (!banco) throw new Error("Banco de demonstração não configurado.");
  const { client } = await connectDatabase(banco);
  client.on("notice", (notice) => { if (notice.message) console.log(notice.message); });
  let numero = 0;
  const executar = async (arquivo: string) => {
    for (const comando of splitLikeSupabaseCli(fs.readFileSync(arquivo, "utf8"))) {
      const nucleo = comando.replace(/^(\s*--[^\n]*(\n|$))+/, "").trim();
      if (!nucleo || /^(begin|commit|rollback)\s*;?$/i.test(nucleo)) continue;
      if (/^(begin|start\s+transaction|commit|end|rollback|abort)\b/i.test(nucleo)) throw new Error("Controle de transação inesperado.");
      await client.query({ name: `venda_manual_${numero++}`, text: comando });
    }
    const { rows } = await client.query("SELECT current_setting('venda_manual_teste.guarda', true) AS guarda");
    if (rows[0]?.guarda !== "ativa") throw new Error("Transação de teste encerrada inesperadamente.");
  };
  try {
    if (process.argv.includes("--inspect")) {
      console.log((await client.query("SELECT enum_range(NULL::public.enum_status_venda) AS status")).rows);
      console.log((await client.query("SELECT tgname FROM pg_trigger WHERE tgrelid='public.eventos_financeiros'::regclass AND NOT tgisinternal")).rows);
      console.log((await client.query("SELECT pg_get_functiondef('public.tg_vincular_transacao_evento_financeiro()'::regprocedure) AS definicao")).rows);
      console.log((await client.query("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 4")).rows);
      return;
    }
    await client.query("BEGIN");
    await client.query("SET LOCAL venda_manual_teste.guarda = 'ativa'");
    await executar(path.join(projectRoot, "supabase/migrations", migration));
    // Idempotência da nova migration, inclusive os patches nas funções vigentes.
    await executar(path.join(projectRoot, "supabase/migrations", migration));
    for (const teste of testes) {
      await executar(path.join(projectRoot, "supabase/tests", teste));
      console.log(`${teste}: OK`);
    }
    console.log("Migration idempotente e regressões aprovadas. Todas as alterações serão revertidas.");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
