/**
 * Valida as migrations pendentes do SPED Fiscal numa transacao revertida.
 *
 * Uso:
 *   npm run db:test:sped-fiscal
 *   npm run db:test:sped-fiscal -- demir
 *
 * O SPED chega junto com outras migrations que ainda nao subiram (CNPJ
 * alfanumerico, OS reiniciada, troca do criador). Aplicar so as do SPED nao
 * provaria nada sobre o deploy real, entao o teste aplica TODAS as pendentes
 * deste banco, na ordem de versao, como o `db push --include-all` faria.
 *
 * O que precisa ser provado antes de publicar:
 *
 * 1. Todas as pendentes aplicam sem erro sobre os dados reais do banco.
 * 2. O ciclo da competencia funciona e respeita as travas (supabase/tests/sped_fiscal.sql):
 *    validar, fechar, imutabilidade, reabrir, cancelamento de NF-e.
 * 3. Nenhuma tabela nova fica sem RLS ou com privilegio para anon/authenticated.
 * 4. Nenhuma funcao nova fica executavel por anon.
 * 5. O bucket `fiscal-sped` nasce privado.
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

const BANCOS: DatabaseKey[] = ["demo", "demir", "garage"];

const CHECK = "supabase/tests/sped_fiscal.sql";

const TABELAS_FISCAIS = `
  SELECT c.relname, c.relrowsecurity,
         has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
         has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND (c.relname LIKE 'fiscal\\_sped\\_%' OR c.relname LIKE 'fiscal\\_inventario\\_%'
          OR c.relname = 'fiscal_documento_evento')
   ORDER BY 1`;

// Mesmo criterio do inspectDatabase em lib.ts.
const ROTINAS_ANON = `
  SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
   ORDER BY 1`;

function desembrulhar(sql: string, fim: "commit" | "rollback") {
  const normalizado = sql.replace(/^﻿/, "");
  const encontrado = normalizado.match(new RegExp(`\\bbegin\\s*;([\\s\\S]*)${fim}\\s*;\\s*$`, "i"));
  if (!encontrado) throw new Error(`Envelope invalido: esperado BEGIN ... ${fim.toUpperCase()}.`);
  return encontrado[1];
}

const ENVELOPE = /^(begin|commit)[ \t]*;[ \t]*\r?$/gim;
const TAG = "$sped_teste_migration$";

/**
 * Uma migration que carregue COMMIT efetiva a transacao do teste inteira: o
 * envelope nem sempre abre o arquivo (ha migrations que comecam por
 * comentario). Duas defesas, sem depender de analisar o SQL:
 *
 * 1. As linhas `BEGIN;`/`COMMIT;` do envelope, na coluna zero, saem.
 * 2. O restante roda dentro de `DO ... EXECUTE`. Controle de transacao ali
 *    dentro vira erro ("invalid transaction termination") em vez de commit.
 */
function lerMigration(arquivo: string) {
  const sql = fs.readFileSync(path.join(projectRoot, "supabase", "migrations", arquivo), "utf8");
  if (sql.includes(TAG)) throw new Error(`${arquivo}: contem a tag ${TAG}; ajuste o runner.`);
  const semEnvelope = sql.replace(/^﻿/, "").replace(ENVELOPE, "");
  return `DO $sped_teste$ BEGIN EXECUTE ${TAG}${semEnvelope}${TAG}; END $sped_teste$`;
}

async function exigirTransacaoAberta(client: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> }, depois: string) {
  const { rows } = await client.query("SELECT current_setting('sped_teste.guarda', true) AS guarda");
  if (rows[0]?.guarda !== "ativa") {
    throw new Error(`A transacao do teste foi encerrada depois de ${depois}. Verifique o banco: o conteudo pode ter sido efetivado.`);
  }
}

async function main() {
  const chave = (process.argv[2] ?? "demo") as DatabaseKey;
  if (!BANCOS.includes(chave)) {
    throw new Error(`Banco invalido: ${chave}. Use um de: ${BANCOS.join(", ")}.`);
  }
  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} nao configurado.`);

  const check = desembrulhar(fs.readFileSync(path.join(projectRoot, CHECK), "utf8"), "rollback");
  const { client } = await connectDatabase(banco);
  client.on("notice", (notice) => {
    if (notice.message && !/already exists|does not exist|skipping/i.test(notice.message)) {
      console.log(`  ${notice.message}`);
    }
  });

  try {
    console.log(`Validando as migrations do SPED Fiscal em ${banco.label}...`);
    const { rows: historico } = await client.query<{ version: string }>(
      "SELECT version FROM supabase_migrations.schema_migrations",
    );
    const aplicadas = new Set(historico.map((row) => String(row.version)));
    const pendentes = readLocalMigrations().filter((migration) => !aplicadas.has(migration.version));
    if (!pendentes.some((migration) => migration.name.startsWith("sped_fiscal"))) {
      console.log("  Nenhuma migration do SPED pendente neste banco: validando so o ciclo.");
    }

    // Le e recusa tudo antes de abrir a transacao: nada executa se algum arquivo for suspeito.
    const scripts = pendentes.map((migration) => ({ migration, sql: lerMigration(migration.file) }));

    await client.query("BEGIN");
    await client.query("SET LOCAL sped_teste.guarda = 'ativa'");
    const anonAntes = new Set((await client.query(ROTINAS_ANON)).rows.map((row) => String(row.signature)));

    for (const { migration, sql } of scripts) {
      try {
        await client.query(sql);
      } catch (error) {
        const detalhe = error instanceof Error ? error.message : String(error);
        throw new Error(`${migration.file}: ${detalhe}`);
      }
      await exigirTransacaoAberta(client, migration.file);
      console.log(`  ${migration.file}: aplicada`);
    }

    await client.query(check);
    await exigirTransacaoAberta(client, CHECK);
    console.log(`  ${path.basename(CHECK)}: ok`);

    const problemas: string[] = [];
    const tabelas = (await client.query(TABELAS_FISCAIS)).rows;
    if (tabelas.length < 23) problemas.push(`esperava 23 tabelas fiscais, encontrou ${tabelas.length}`);
    for (const tabela of tabelas) {
      if (!tabela.relrowsecurity) problemas.push(`${tabela.relname} sem RLS`);
      if (tabela.anon) problemas.push(`${tabela.relname} acessivel por anon`);
      if (tabela.authenticated) problemas.push(`${tabela.relname} acessivel por authenticated`);
    }

    const novasAnon = (await client.query(ROTINAS_ANON)).rows
      .map((row) => String(row.signature))
      .filter((signature) => !anonAntes.has(signature));
    for (const signature of novasAnon) problemas.push(`${signature} executavel por anon`);

    const bucket = await client.query("SELECT public FROM storage.buckets WHERE id = 'fiscal-sped'");
    if (bucket.rowCount !== 1 || bucket.rows[0].public !== false) {
      problemas.push("bucket fiscal-sped ausente ou publico");
    }

    const permissoes = await client.query(
      "SELECT count(*)::int AS total FROM public.permissao WHERE nome IN ('fiscal:sped', 'fiscal:sped_gerenciar')",
    );
    if (permissoes.rows[0].total !== 2) problemas.push("permissoes fiscal:sped nao foram semeadas");

    if (problemas.length) throw new Error(`Seguranca:\n  - ${problemas.join("\n  - ")}`);
    console.log(`  ${tabelas.length} tabelas com RLS e sem acesso anon/authenticated; nenhuma funcao nova para anon.`);

    await client.query("ROLLBACK");
    console.log(`OK - ${pendentes.length} migration(s) validadas em ${banco.label}; transacao revertida.`);
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
