/**
 * Valida a 20260915140000 (linha da DRE por plano de conta) numa transacao
 * revertida.
 *
 * Uso:
 *   npm run db:test:linha-dre-conta
 *   npm run db:test:linha-dre-conta -- cespedes
 *
 * O que precisa ser provado antes de publicar, porque a migration troca a
 * sincronizacao de todo lancamento avulso:
 *
 * 1. Num banco sem classificacao, nenhum evento muda. A comparacao e evento a
 *    evento (status, linha, valor, natureza), nao pelo total: dois erros que se
 *    cancelam passariam num total.
 * 2. Refazer TODAS as transacoes pela regra nova da o mesmo resultado que
 *    refaze-las pela regra antiga. As duas passadas rodam, uma antes e outra
 *    depois da migration, para que desalinhamento antigo do banco nao seja
 *    confundido com efeito da regra nova.
 * 3. A soma e o detalhamento continuam fechando, linha a linha.
 * 4. As regressoes das Fases 1 a 4 e a desta migration passam.
 */
import fs from "node:fs";
import path from "node:path";

import { DATABASE_KEYS, connectDatabase, loadDatabaseConfigs, projectRoot, type DatabaseKey } from "./lib";

const BANCOS: DatabaseKey[] = [...DATABASE_KEYS];

const MIGRATION = "supabase/migrations/20260915140000_linha_da_dre_por_plano_de_conta.sql";

const CHECKS = [
  "supabase/tests/classificacao_resultado_catalogo.sql",
  "supabase/tests/resolvedor_classificacao_dre.sql",
  "supabase/tests/cadastro_classificacao_atomico.sql",
  "supabase/tests/pendencias_e_migracao_classificacao.sql",
  "supabase/tests/linha_da_dre_por_plano_de_conta.sql",
];

/** Estado de cada evento que a DRE le. `updated_at` fica de fora: refazer muda a data, nao o fato. */
const EVENTOS = `
  SELECT count(*)::bigint AS total,
         md5(string_agg(
           id || ':' || status || ':' || coalesce(dre_linha_id::text, '-') || ':' || valor || ':' ||
           natureza || ':' || coalesce(natureza_dre, '-') || ':' || coalesce(competencia_em::text, '-'),
           ',' ORDER BY id)) AS assinatura
    FROM public.eventos_financeiros`;

const BASELINE = `
  WITH t AS (SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1)
  SELECT l.codigo, s.valor, s.lancamentos
    FROM t
    CROSS JOIN LATERAL public.dre_somar_por_linha(
      t.id, timestamptz '2000-01-01', timestamptz '2100-01-01') s
    JOIN public.dre_linha l ON l.id = s.linha_id
   ORDER BY l.codigo`;

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

const REFAZER_TUDO = `
  DO $refazer$
  DECLARE r record;
  BEGIN
    FOR r IN SELECT id FROM public.transacao ORDER BY id LOOP
      PERFORM public.sincronizar_eventos_financeiros_transacao(r.id);
    END LOOP;
  END;
  $refazer$`;

const FILA = `
  SELECT motivo, quantidade, valor
    FROM public.dre_pendencias(timestamptz '2000-01-01', timestamptz '2100-01-01')
   ORDER BY motivo`;

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
  const chave = (process.argv[2] ?? "cespedes") as DatabaseKey;
  if (!BANCOS.includes(chave)) {
    throw new Error(`Banco invalido: ${chave}. Use um de: ${BANCOS.join(", ")}.`);
  }
  const banco = loadDatabaseConfigs().find((item) => item.key === chave);
  if (!banco) throw new Error(`Banco ${chave} nao configurado.`);

  const checks = CHECKS.map((arquivo) => ({
    arquivo,
    sql: desembrulhar(fs.readFileSync(path.join(projectRoot, arquivo), "utf8"), "rollback"),
  }));

  const { client } = await connectDatabase(banco);
  client.on("notice", (notice) => {
    if (notice.message && !/already exists|does not exist/i.test(notice.message)) {
      console.log(`  ${notice.message}`);
    }
  });

  try {
    console.log(`Validando a linha da DRE por plano de conta em ${banco.label}...`);
    await client.query("BEGIN");

    const { rows: aplicadas } = await client.query(
      "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260915140000'",
    );
    const publicada = aplicadas.length > 0;

    const filaAntes = await client.query(FILA);

    if (!publicada) {
      // Passada pela regra antiga: alinha o banco com ela, para que a proxima
      // comparacao meca so o efeito da regra nova.
      await client.query(REFAZER_TUDO);
    }
    const eventosAntes = (await client.query(EVENTOS)).rows[0];
    const somaAntes = await client.query(BASELINE);
    console.log(`  Eventos: ${eventosAntes.total}; ${somaAntes.rowCount} linha(s) com valor.`);

    if (!publicada) {
      await client.query(desembrulhar(fs.readFileSync(path.join(projectRoot, MIGRATION), "utf8"), "commit"));
      console.log("  Migration aplicada dentro da transacao.");
    } else {
      console.log("  Migration ja publicada neste banco: comparando so a passada nova.");
    }

    const eventosMigrados = (await client.query(EVENTOS)).rows[0];
    if (eventosMigrados.assinatura !== eventosAntes.assinatura) {
      throw new Error("Aplicar a migration alterou eventos sem ninguem classificar nada.");
    }

    await client.query(REFAZER_TUDO);
    const eventosDepois = (await client.query(EVENTOS)).rows[0];
    if (eventosDepois.assinatura !== eventosAntes.assinatura) {
      throw new Error(
        "Refazer todas as transacoes pela regra nova mudou eventos num banco sem classificacao.",
      );
    }
    console.log(`  Todas as transacoes refeitas pela regra nova: ${eventosDepois.total} eventos identicos.`);

    const somaDepois = await client.query(BASELINE);
    if (serializar(somaAntes.rows) !== serializar(somaDepois.rows)) {
      throw new Error("A DRE mudou, linha a linha, sem ninguem classificar nada.");
    }
    const drilldown = await client.query(DRILLDOWN);
    if (serializar(somaDepois.rows) !== serializar(drilldown.rows)) {
      throw new Error("O detalhamento nao fecha com a soma.");
    }
    console.log("  DRE identica e detalhamento fechando, linha a linha, no historico inteiro.");

    const filaDepois = await client.query(FILA);
    const porMotivo = (rows: Record<string, unknown>[]) =>
      new Map(rows.map((r) => [String(r.motivo), `${r.quantidade}${r.valor == null ? "" : ` / ${r.valor}`}`]));
    const antes = porMotivo(filaAntes.rows);
    const depois = porMotivo(filaDepois.rows);
    for (const motivo of new Set([...antes.keys(), ...depois.keys()])) {
      if (antes.get(motivo) !== depois.get(motivo)) {
        console.log(`  Fila ${motivo}: ${antes.get(motivo) ?? "—"} -> ${depois.get(motivo) ?? "—"}`);
      }
    }

    for (const check of checks) {
      await client.query(check.sql);
      console.log(`  ${path.basename(check.arquivo)}: ok`);
    }

    await client.query("ROLLBACK");
    console.log("OK - linha da DRE por plano de conta validada; transacao revertida.");
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
