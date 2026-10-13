/**
 * Valida, numa transação revertida, o espelho da comissão ajustada no vínculo.
 *
 * Uso:
 *   npm run db:test:comissao-ajustada
 *   npm run db:test:comissao-ajustada -- demir
 *
 * 1. As migrations pendentes aplicam sem erro, separadas como o `db push` separa.
 * 2. `supabase/tests/comissao_ajustada_espelha_no_vinculo.sql` passa sobre elas:
 *    nenhum evento de comissão ativo diverge do vínculo, o ajuste espelha,
 *    resiste ao recálculo e volta ao cálculo quando o evento é cancelado.
 * 3. A função do gatilho não fica executável por anon nem por authenticated.
 *
 * Mesmo cuidado dos demais: cada comando vai como prepared statement e um
 * COMMIT perdido não efetiva nada.
 */
import path from "node:path";
import fs from "node:fs";

import {
  DATABASE_KEYS,
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  readLocalMigrations,
  type DatabaseKey,
} from "./lib";
import { splitLikeSupabaseCli } from "./supabase-splitter";

const BANCOS: DatabaseKey[] = [...DATABASE_KEYS];
const CONTROLE_DE_TRANSACAO = /^(begin|start\s+transaction|commit|end|rollback|abort)\b/i;
const TESTE = path.join(projectRoot, "supabase", "tests", "comissao_ajustada_espelha_no_vinculo.sql");

function semComentariosIniciais(comando: string) {
  return comando.replace(/^(\s*--[^\n]*(\n|$))+/, "").trim();
}

/** O envelope do arquivo sai; qualquer outro controle de transação é recusado. */
function lerComandos(arquivo: string, envelope: RegExp) {
  const sql = fs.readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  const comandos: string[] = [];
  for (const comando of splitLikeSupabaseCli(sql)) {
    const nucleo = semComentariosIniciais(comando);
    if (!nucleo) continue;
    if (envelope.test(nucleo)) continue;
    if (CONTROLE_DE_TRANSACAO.test(nucleo)) {
      throw new Error(`${path.basename(arquivo)}: controle de transação fora do envelope (${nucleo.slice(0, 40)}); recusado.`);
    }
    comandos.push(comando);
  }
  return comandos;
}

async function main() {
  const chave = (process.argv[2] ?? "demo") as DatabaseKey;
  if (!BANCOS.includes(chave)) throw new Error(`Banco inválido: ${chave}. Use um de: ${BANCOS.join(", ")}.`);
  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} não configurado.`);

  const { client } = await connectDatabase(banco);
  client.on("notice", (notice) => {
    if (notice.message && !/already exists|does not exist|skipping/i.test(notice.message)) {
      console.log(`  ${notice.message}`);
    }
  });

  const guarda = async (depois: string) => {
    const { rows } = await client.query("SELECT current_setting('comissao_ajustada_teste.guarda', true) AS guarda");
    if (rows[0]?.guarda !== "ativa") {
      throw new Error(`A transação do teste foi encerrada depois de ${depois}. Verifique o banco.`);
    }
  };

  try {
    console.log(`Validando o espelho da comissão ajustada em ${banco.label}...`);
    const { rows: historico } = await client.query<{ version: string }>(
      "SELECT version FROM supabase_migrations.schema_migrations",
    );
    const aplicadas = new Set(historico.map((row) => String(row.version)));
    const pendentes = readLocalMigrations().filter((migration) => !aplicadas.has(migration.version));
    const scripts = pendentes.map((migration) => ({
      migration,
      comandos: lerComandos(path.join(projectRoot, "supabase", "migrations", migration.file), /^(begin|commit)$/i),
    }));
    const teste = lerComandos(TESTE, /^(begin|rollback)$/i);
    let preparados = 0;

    await client.query("BEGIN");
    await client.query("SET LOCAL comissao_ajustada_teste.guarda = 'ativa'");

    for (const { migration, comandos } of scripts) {
      for (const [indice, comando] of comandos.entries()) {
        try {
          await client.query({ name: `comissao_ajustada_${preparados++}`, text: comando });
        } catch (error) {
          const detalhe = error instanceof Error ? error.message : String(error);
          throw new Error(`${migration.file}, comando ${indice}: ${detalhe}`);
        }
      }
      await guarda(migration.file);
      console.log(`  ${migration.file}: aplicada (${comandos.length} comandos)`);
    }

    for (const comando of teste) {
      await client.query({ name: `comissao_ajustada_${preparados++}`, text: comando });
    }
    await guarda(path.basename(TESTE));

    for (const funcao of ["public.tg_espelhar_comissao_ajustada()"]) {
      const { rows: privilegios } = await client.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated`,
        [funcao],
      );
      if (privilegios[0].anon || privilegios[0].authenticated) {
        throw new Error(`Privilégios incorretos em ${funcao}: ${JSON.stringify(privilegios[0])}`);
      }
      console.log(`  ${funcao}: fechada para anon e authenticated.`);
    }

    await guarda("verificações");
    await client.query("ROLLBACK");
    console.log(`OK - ${pendentes.length} migration(s) validadas em ${banco.label}; transação revertida.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
