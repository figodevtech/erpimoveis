/**
 * Valida a migration da Fase 2 dentro de uma transacao revertida.
 *
 * Uso:
 *   npm run db:test:resolvedor-dre
 *   npm run db:test:resolvedor-dre -- demir
 *
 * Aplica as migrations da Entrega A que ainda estiverem pendentes, prova que em
 * modo LEGADO a DRE nao muda, e roda as verificacoes de todas as fases.
 *
 * Reaplicar uma migration ja publicada nao e inofensivo aqui: a da Fase 1 recria
 * a restricao de coerencia de `dre_mapeamento` na forma estrita, e a da Fase 2
 * ja preencheu `classificacao_resultado_id` nas origens automaticas — a
 * restricao estrita passaria a ser violada pelas proprias linhas que a Fase 2
 * gravou. Num deploy real isso nao acontece, porque cada migration roda uma vez;
 * aqui o runner precisa respeitar a mesma regra.
 *
 * A comparacao da DRE e feita linha a linha, com a soma completa do historico:
 * um total agregado igual poderia esconder dois erros que se cancelam.
 */
import fs from "node:fs";
import path from "node:path";

import {
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  type DatabaseKey,
} from "./lib";

const BANCOS: DatabaseKey[] = ["demo", "demir", "garage"];

const MIGRATIONS = [
  "supabase/migrations/20260908100000_classificacao_resultado_catalogo.sql",
  "supabase/migrations/20260908110000_resolvedor_classificacao_dre.sql",
  "supabase/migrations/20260908120000_cadastro_classificacao_atomico.sql",
  "supabase/migrations/20260908130000_pendencias_e_migracao_classificacao.sql",
];

const CHECKS = [
  "supabase/tests/classificacao_resultado_catalogo.sql",
  "supabase/tests/resolvedor_classificacao_dre.sql",
  "supabase/tests/cadastro_classificacao_atomico.sql",
  "supabase/tests/pendencias_e_migracao_classificacao.sql",
];

const BASELINE = `
  WITH t AS (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1)
  SELECT l.codigo, s.valor, s.lancamentos
    FROM t
    CROSS JOIN LATERAL public.dre_somar_por_linha(
      t.id, timestamptz '2000-01-01', timestamptz '2100-01-01') s
    JOIN public.dre_linha l ON l.id = s.linha_id
   ORDER BY l.codigo`;

/**
 * O drill-down precisa fechar com o total. Somar os lancamentos devolvidos por
 * linha e compara-los com a soma e a unica forma de provar isso sem confiar em
 * que as duas funcoes continuam com a mesma expressao copiada.
 */
const DRILLDOWN = `
  WITH t AS (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1),
  linhas AS (SELECT array_agg(id) ids FROM public.dre_linha WHERE template_id = (SELECT id FROM t))
  SELECT l.codigo, round(sum(d.valor), 2) AS valor, count(*)::bigint AS lancamentos
    FROM t, linhas
    CROSS JOIN LATERAL public.dre_lancamentos_por_linha(
      t.id, linhas.ids, timestamptz '2000-01-01', timestamptz '2100-01-01') d
    JOIN public.dre_linha l ON l.id = d.linha_id
   GROUP BY l.codigo
   ORDER BY l.codigo`;

function desembrulhar(sql: string, fim: "commit" | "rollback") {
  const normalizado = sql.replace(/^﻿/, "");
  const encontrado = normalizado.match(new RegExp(`\\bbegin\\s*;([\\s\\S]*)${fim}\\s*;\\s*$`, "i"));
  if (!encontrado) throw new Error(`Envelope invalido: esperado BEGIN ... ${fim.toUpperCase()}.`);
  return encontrado[1];
}

function serializar(rows: Record<string, unknown>[]) {
  return rows.map((r) => `${r.codigo}=${r.valor}/${r.lancamentos}`).join("|");
}

async function main() {
  const chave = (process.argv[2] ?? "demo") as DatabaseKey;
  if (!BANCOS.includes(chave)) {
    throw new Error(`Banco invalido: ${chave}. Use um de: ${BANCOS.join(", ")}.`);
  }
  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} nao configurado.`);

  const checks = CHECKS.map((arquivo) =>
    desembrulhar(fs.readFileSync(path.join(projectRoot, arquivo), "utf8"), "rollback"),
  );

  const { client } = await connectDatabase(banco);
  client.on("notice", (notice) => {
    if (notice.message && !/already exists|does not exist/i.test(notice.message)) {
      console.log(`  ${notice.message}`);
    }
  });

  try {
    console.log(`Validando o resolvedor de classificacao em ${banco.label}...`);
    await client.query("BEGIN");

    const antes = await client.query(BASELINE);
    console.log(`  Baseline: ${antes.rowCount} linha(s) com valor.`);

    const { rows: aplicadas } = await client.query(
      "SELECT version FROM supabase_migrations.schema_migrations",
    );
    const jaAplicadas = new Set(aplicadas.map((linha) => String(linha.version)));

    const pendentes = MIGRATIONS.filter(
      (arquivo) => !jaAplicadas.has(path.basename(arquivo).split("_")[0]),
    );
    for (const arquivo of pendentes) {
      await client.query(
        desembrulhar(fs.readFileSync(path.join(projectRoot, arquivo), "utf8"), "commit"),
      );
    }
    console.log(
      pendentes.length
        ? `  ${pendentes.length} migration(s) pendente(s) aplicada(s); ${MIGRATIONS.length - pendentes.length} ja publicada(s).`
        : "  Todas as migrations da Entrega A ja estao publicadas neste banco.",
    );

    const depois = await client.query(BASELINE);
    if (serializar(antes.rows) !== serializar(depois.rows)) {
      throw new Error("Em modo LEGADO a DRE mudou. O resolvedor nao pode alterar total nenhum.");
    }
    console.log("  DRE inalterada em modo LEGADO.");

    const drilldown = await client.query(DRILLDOWN);
    if (serializar(depois.rows) !== serializar(drilldown.rows)) {
      throw new Error("O detalhamento nao fecha com a soma depois de unificar a resolucao.");
    }
    console.log("  Detalhamento fecha com a soma, linha a linha.");

    for (const check of checks) await client.query(check);

    await client.query("ROLLBACK");
    console.log("OK - resolvedor validado; transacao revertida.");
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
