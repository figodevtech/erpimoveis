/**
 * Aplica UMA migration nos bancos cadastrados, sem passar pelo `db:deploy`.
 *
 * Uso:
 *   npm run db:aplicar:avulsa -- supabase/migrations/<arquivo>.sql
 *   npm run db:aplicar:avulsa -- supabase/migrations/<arquivo>.sql --aplicar
 *
 * Sem `--aplicar` cada banco termina em ROLLBACK: o SQL roda inteiro e so o
 * erro, se houver, aparece.
 *
 * POR QUE ESTE SCRIPT EXISTE
 * O deploy empurra com `--include-all`, entao leva tudo o que estiver pendente.
 * Quando ha migrations de outro trabalho ainda nao prontas, uma correcao urgente
 * fica presa a elas. Este script aplica so o arquivo pedido.
 *
 * O QUE ELE NAO FAZ
 * Nao grava a versao em `supabase_migrations.schema_migrations`. O `db:status`
 * continua mostrando a migration como pendente, e o proximo `db:deploy` roda o
 * arquivo de novo e a registra. Por isso so serve para migration idempotente
 * (`CREATE OR REPLACE`, `IF NOT EXISTS`, UPDATE que nao muda nada na segunda
 * vez) — confira antes de usar.
 *
 * A ordem e a do deploy: Demonstracao primeiro. Se um banco falhar, os
 * seguintes nao sao tocados.
 */
import fs from "node:fs";
import path from "node:path";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const ARQUIVO = args.find((arg) => !arg.startsWith("--")) ?? "";

/** O arquivo traz o proprio BEGIN/COMMIT; aqui a transacao e do script. */
function corpoDaMigration(sql: string) {
  const encontrado = sql.replace(/^﻿/, "").match(/\bbegin\s*;([\s\S]*)commit\s*;\s*$/i);
  if (!encontrado) throw new Error("A migration precisa estar envelopada em BEGIN; ... COMMIT;.");
  return encontrado[1];
}

async function main() {
  if (!ARQUIVO) {
    throw new Error("Informe a migration. Ex.: npm run db:aplicar:avulsa -- supabase/migrations/<arquivo>.sql");
  }
  const caminho = path.isAbsolute(ARQUIVO) ? ARQUIVO : path.join(projectRoot, ARQUIVO);
  if (!fs.existsSync(caminho)) throw new Error(`Arquivo nao encontrado: ${caminho}`);
  const corpo = corpoDaMigration(fs.readFileSync(caminho, "utf8"));

  const configs = loadDatabaseConfigs();
  console.log(`\n${path.basename(caminho)} — ${APLICAR ? "APLICANDO" : "simulacao"}\n`);

  for (const config of configs) {
    const { client } = await connectDatabase(config);
    try {
      await client.query("BEGIN");
      await client.query(corpo);
      await client.query(APLICAR ? "COMMIT" : "ROLLBACK");
      console.log(`  ${config.label}: ${APLICAR ? "aplicada" : "rodou sem erro (desfeito)"}`);
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      throw new Error(`${config.label}: ${mensagem}. Bancos seguintes nao foram tocados.`);
    } finally {
      await client.end();
    }
  }

  console.log(
    APLICAR
      ? "\nA versao continua pendente no historico; o proximo db:deploy a registra.\n"
      : "\nSimulacao — nada foi gravado. Repita com --aplicar.\n",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
