/**
 * Prova que as migrations pendentes deixam os três bancos com o mesmo schema.
 *
 * Uso:
 *   npm run db:test:schema-padrao
 *
 * Abre uma transação em Demonstração, Demir e Garage Premium, aplica em cada
 * uma as migrations pendentes daquele banco (como o `db push --include-all`),
 * e compara linha a linha entre os três, com as mesmas consultas do
 * `db:status` (dono, ACL, RLS, policies, corpo de função normalizado...). No fim
 * as três transações são revertidas.
 *
 * Mesmo cuidado dos demais runners: cada comando vai como prepared statement e
 * um COMMIT perdido não efetiva nada.
 */
import fs from "node:fs";
import path from "node:path";

import {
  connectDatabase,
  loadDatabaseConfigs,
  normalizeFunction,
  projectRoot,
  readLocalMigrations,
  SCHEMA_QUERIES,
  type DatabaseKey,
} from "./lib";
import { splitLikeSupabaseCli } from "./supabase-splitter";

const BANCOS: DatabaseKey[] = ["demo", "demir", "garage"];
const CONTROLE_DE_TRANSACAO = /^(begin|start\s+transaction|commit|end|rollback|abort)\b/i;

/**
 * As mesmas consultas e a mesma normalizacao de funcao do `db:status`: o teste
 * aprova exatamente o que o deploy aprova, mas aponta a linha que difere em vez
 * de so a contagem.
 */
function linhas(categoria: string, rows: Record<string, unknown>[]) {
  return rows.map((row) =>
    JSON.stringify(categoria === "functions" ? { ...row, prosrc: normalizeFunction(String(row.prosrc)) } : row),
  );
}

function semComentariosIniciais(comando: string) {
  return comando.replace(/^(\s*--[^\n]*(\n|$))+/, "").trim();
}

function lerComandos(arquivo: string) {
  const sql = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  const comandos: string[] = [];
  for (const comando of splitLikeSupabaseCli(sql)) {
    const nucleo = semComentariosIniciais(comando);
    if (!nucleo) continue;
    if (/^(begin|commit)$/i.test(nucleo)) continue;
    if (CONTROLE_DE_TRANSACAO.test(nucleo)) {
      throw new Error(`${path.basename(arquivo)}: controle de transação fora do envelope (${nucleo.slice(0, 40)}); recusado.`);
    }
    comandos.push(comando);
  }
  return comandos;
}

async function main() {
  const conexoes = [];
  try {
    for (const chave of BANCOS) {
      const banco = loadDatabaseConfigs().find((item) => item.key === chave);
      if (!banco) throw new Error(`Banco ${chave} não configurado.`);
      const { client } = await connectDatabase(banco);
      conexoes.push({ chave, banco, client });
    }

    const objetos: Record<string, Record<string, Set<string>>> = {};
    let preparados = 0;

    for (const { chave, banco, client } of conexoes) {
      const { rows: historico } = await client.query<{ version: string }>(
        "SELECT version FROM supabase_migrations.schema_migrations",
      );
      const aplicadas = new Set(historico.map((row) => String(row.version)));
      const pendentes = readLocalMigrations().filter((migration) => !aplicadas.has(migration.version));
      const scripts = pendentes.map((migration) => ({
        migration,
        comandos: lerComandos(path.join(projectRoot, "supabase", "migrations", migration.file)),
      }));

      await client.query("BEGIN");
      await client.query("SET LOCAL schema_padrao_teste.guarda = 'ativa'");
      for (const { migration, comandos } of scripts) {
        for (const [indice, comando] of comandos.entries()) {
          try {
            await client.query({ name: `schema_padrao_teste_${preparados++}`, text: comando });
          } catch (error) {
            const detalhe = error instanceof Error ? error.message : String(error);
            throw new Error(`${banco.label}: ${migration.file}, comando ${indice}: ${detalhe}`);
          }
        }
        const { rows } = await client.query("SELECT current_setting('schema_padrao_teste.guarda', true) AS guarda");
        if (rows[0]?.guarda !== "ativa") {
          throw new Error(`${banco.label}: transação encerrada depois de ${migration.file}. Verifique o banco.`);
        }
        console.log(`  ${banco.label}: ${migration.file} aplicada (${comandos.length} comandos)`);
      }
      if (!scripts.length) console.log(`  ${banco.label}: nenhuma migration pendente`);

      objetos[chave] = {};
      for (const [tipo, sql] of Object.entries(SCHEMA_QUERIES)) {
        objetos[chave][tipo] = new Set(linhas(tipo, (await client.query(sql)).rows));
      }
    }

    const diferencas: string[] = [];
    for (const tipo of Object.keys(SCHEMA_QUERIES)) {
      const [referencia, ...outros] = BANCOS;
      for (const outro of outros) {
        const faltam = [...objetos[referencia][tipo]].filter((k) => !objetos[outro][tipo].has(k));
        const sobram = [...objetos[outro][tipo]].filter((k) => !objetos[referencia][tipo].has(k));
        for (const k of faltam) diferencas.push(`${tipo}: só em ${referencia} (não em ${outro}): ${k.slice(0, 400)}`);
        for (const k of sobram) diferencas.push(`${tipo}: só em ${outro} (não em ${referencia}): ${k.slice(0, 400)}`);
      }
      console.log(`  ${tipo}: ${BANCOS.map((chave) => `${chave}=${objetos[chave][tipo].size}`).join(" | ")}`);
    }

    if (diferencas.length) {
      throw new Error(`Schemas ainda divergem depois das pendentes:\n  - ${diferencas.slice(0, 40).join("\n  - ")}`);
    }
    console.log("OK - os três bancos ficam com o mesmo schema; transações revertidas.");
  } finally {
    for (const { client } of conexoes) {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
