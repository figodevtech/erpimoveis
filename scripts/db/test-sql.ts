/**
 * Roda um arquivo .sql de teste contra um dos bancos configurados.
 *
 * Uso:
 *   npm run db:test:sql -- supabase/tests/ajustar_valores_transacao.sql
 *   npm run db:test:sql -- supabase/tests/ajustar_valores_transacao.sql demir
 *
 * O banco padrão é o `demo`. Os scripts de teste terminam em ROLLBACK, e este
 * runner emite outro ROLLBACK no `finally` — se o arquivo abortar no meio, a
 * transação morre junto com a conexão e nada é gravado.
 */
import fs from "node:fs";
import path from "node:path";

import {
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  type DatabaseKey,
} from "./lib";

const CHAVES_VALIDAS: DatabaseKey[] = ["demo", "demir", "alpha", "garage"];

async function main() {
  const [arquivoArg, bancoArg] = process.argv.slice(2);

  if (!arquivoArg) {
    throw new Error(
      "Informe o arquivo .sql. Ex.: npm run db:test:sql -- supabase/tests/ajustar_valores_transacao.sql",
    );
  }

  const chave = (bancoArg ?? "demo") as DatabaseKey;
  if (!CHAVES_VALIDAS.includes(chave)) {
    throw new Error(`Banco inválido: ${bancoArg}. Use um de: ${CHAVES_VALIDAS.join(", ")}.`);
  }

  const caminho = path.isAbsolute(arquivoArg)
    ? arquivoArg
    : path.join(projectRoot, arquivoArg);

  if (!fs.existsSync(caminho)) {
    throw new Error(`Arquivo não encontrado: ${caminho}`);
  }

  const sql = fs.readFileSync(caminho, "utf8");
  const configuracao = loadDatabaseConfigs().find((item) => item.key === chave);

  if (!configuracao) {
    throw new Error(`Banco ${chave} não está configurado.`);
  }

  console.log(`Executando ${path.basename(caminho)} em ${configuracao.label}...\n`);

  const { client } = await connectDatabase(configuracao);

  // Sem isto o RAISE NOTICE do script não aparece em lugar nenhum.
  client.on("notice", (notice) => {
    if (notice.message) console.log(notice.message);
  });

  try {
    await client.query(sql);
    console.log("\nResultado: todas as verificações passaram.");
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error(`\nResultado: ${mensagem}`);
    process.exitCode = 1;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
