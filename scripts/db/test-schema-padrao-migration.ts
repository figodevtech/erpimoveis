/**
 * Prova que as migrations pendentes deixam os três bancos com o mesmo schema.
 *
 * Uso:
 *   npm run db:test:schema-padrao
 *
 * Abre uma transação em Demonstração, Demir e Garage Premium, aplica em cada
 * uma as migrations pendentes daquele banco (como o `db push --include-all`),
 * e compara objeto a objeto entre os três — não só contagens: definição de
 * policy, privilégios, corpo e ACL de função, expressão de coluna gerada. No fim
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
  projectRoot,
  readLocalMigrations,
  type DatabaseKey,
} from "./lib";
import { splitLikeSupabaseCli } from "./supabase-splitter";

const BANCOS: DatabaseKey[] = ["demo", "demir", "garage"];
const CONTROLE_DE_TRANSACAO = /^(begin|start\s+transaction|commit|end|rollback|abort)\b/i;

const OBJETOS: Record<string, string> = {
  relations: `SELECT c.relkind::text || ' ' || c.relname || ' rls=' || c.relrowsecurity AS k
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f','S')`,
  columns: `SELECT table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable
                   || ' gen=' || coalesce(generation_expression, '') AS k
              FROM information_schema.columns WHERE table_schema = 'public'`,
  constraints: `SELECT conrelid::regclass::text || ' ' || conname AS k
                  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                 WHERE n.nspname = 'public'`,
  indexes: `SELECT indexdef AS k FROM pg_indexes WHERE schemaname = 'public'`,
  policies: `SELECT tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text || ' '
                    || coalesce(qual, '') || ' ' || coalesce(with_check, '') AS k
               FROM pg_policies WHERE schemaname = 'public'`,
  // O corpo é comparado sem CR, comentários de linha, espaços e caixa: a mesma
  // função gravada do Windows ou reformatada no painel não é divergência.
  functions: `SELECT format('%s(%s) acl=%s sec=%s md5=%s', p.proname, pg_get_function_identity_arguments(p.oid),
                            coalesce(p.proacl::text, ''), p.prosecdef,
                            md5(lower(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '\\s+', '', 'g')))) AS k
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public'
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`,
  grantsDaLoja: `SELECT table_name || ' ' || grantee || ' ' || privilege_type AS k
                   FROM information_schema.role_table_grants
                  WHERE table_schema = 'public' AND table_name IN ('contato_lead')`,
};

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
      for (const [tipo, sql] of Object.entries(OBJETOS)) {
        objetos[chave][tipo] = new Set((await client.query(sql)).rows.map((row) => String(row.k)));
      }
    }

    const diferencas: string[] = [];
    for (const tipo of Object.keys(OBJETOS)) {
      const [referencia, ...outros] = BANCOS;
      for (const outro of outros) {
        const faltam = [...objetos[referencia][tipo]].filter((k) => !objetos[outro][tipo].has(k));
        const sobram = [...objetos[outro][tipo]].filter((k) => !objetos[referencia][tipo].has(k));
        for (const k of faltam) diferencas.push(`${tipo}: só em ${referencia} (não em ${outro}): ${k.slice(0, 160)}`);
        for (const k of sobram) diferencas.push(`${tipo}: só em ${outro} (não em ${referencia}): ${k.slice(0, 160)}`);
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
