// Uso único: registra no histórico da Demonstração as 9 migrations que um teste
// com COMMIT embutido aplicou sem gravar a versão.
import fs from "node:fs";
import path from "node:path";

import { connectDatabase, loadDatabaseConfigs, projectRoot, readLocalMigrations } from "./lib";

const VERSOES = [
  "20260916054031", "20260916054033", "20260916054035", "20260916054038", "20260916054042",
  "20260916054044", "20260916054046", "20260916180000", "20260917100000",
];

const EFEITOS: [string, string][] = [
  ["054031", "select to_regprocedure('public.fiscal_cnpj_valido(text)') is not null"],
  ["054033", "select position('fiscal_cnpj_normalizar' in pg_get_functiondef('public.responder_aprovacao_os'::regproc)) > 0"],
  ["054035", "select to_regclass('public.fiscal_documento_evento') is not null"],
  ["054038", "select to_regclass('public.fiscal_sped_config') is not null"],
  ["054042", "select to_regclass('public.fiscal_sped_versao') is not null"],
  ["054044", "select to_regproc('public.fiscal_sped_importar_1601') is not null"],
  ["054046", "select exists (select 1 from storage.buckets where id = 'fiscal-sped')"],
  ["180000", "select position('ORCAMENTO_RECUSADO' in pg_get_functiondef('public.fn_os_execucao_set_times'::regproc)) > 0"],
  ["100000", "select to_regproc('public.trocar_criador_os') is not null"],
];

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const banco = loadDatabaseConfigs().find((b) => b.key === "demo")!;
  const migrations = readLocalMigrations().filter((m) => VERSOES.includes(m.version));
  if (migrations.length !== VERSOES.length) throw new Error("Arquivos de migration não encontrados.");

  const { client } = await connectDatabase(banco);
  try {
    await client.query("BEGIN");
    const existentes = await client.query(
      "select version from supabase_migrations.schema_migrations where version = any($1)", [VERSOES]);
    if (existentes.rowCount) throw new Error(`Já registradas: ${existentes.rows.map((r) => r.version).join(", ")}`);

    for (const [rotulo, sql] of EFEITOS) {
      const ok = Object.values((await client.query(sql)).rows[0])[0];
      if (ok !== true) throw new Error(`Efeito da ${rotulo} ausente no banco; não registro.`);
      console.log(`  ${rotulo}: efeito presente`);
    }

    for (const m of migrations) {
      const sql = fs.readFileSync(path.join(projectRoot, "supabase", "migrations", m.file), "utf8");
      await client.query(
        "insert into supabase_migrations.schema_migrations(version, name, statements) values ($1, $2, $3)",
        [m.version, m.name, [sql]],
      );
    }
    const total = await client.query(
      "select count(*)::int n from supabase_migrations.schema_migrations where version = any($1)", [VERSOES]);
    console.log(`  ${total.rows[0].n} versões no histórico dentro da transação.`);

    await client.query(aplicar ? "COMMIT" : "ROLLBACK");
    console.log(aplicar ? "COMMIT: histórico registrado." : "Simulação: ROLLBACK (use --aplicar).");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
