/**
 * Valida a migração da fase 2 do chat sem persistir DDL nem dados.
 *
 * Assim como o runner da fase 1, os envelopes BEGIN/COMMIT e BEGIN/ROLLBACK são
 * removidos e conferidos antes de abrir a transação de segurança: um COMMIT
 * interno encerraria a transação externa e as alterações ficariam gravadas.
 *
 * Uso:
 *   npm run db:test:chat-fase2
 *   npm run db:test:chat-fase2 -- demir
 */
import fs from "node:fs";
import path from "node:path";

import {
  connectDatabase,
  loadDatabaseConfigs,
  projectRoot,
  type DatabaseKey,
} from "./lib";

const VALID_DATABASES: DatabaseKey[] = ["demo", "demir", "garage"];

const MIGRACAO_FASE_1 = "supabase/migrations/20260825190000_chat_interno_fase_1.sql";
const MIGRACAO_FASE_2 = "supabase/migrations/20260828120000_chat_interno_fase_2.sql";
const TESTES_FASE_1 = "supabase/tests/chat_fase1.sql";
const TESTES_FASE_2 = "supabase/tests/chat_fase2.sql";

function unwrapTransaction(sql: string, closingStatement: "commit" | "rollback") {
  const normalized = sql.replace(/^﻿/, "");
  const pattern = new RegExp(
    `^\\s*begin\\s*;([\\s\\S]*)${closingStatement}\\s*;\\s*$`,
    "i",
  );
  const match = normalized.match(pattern);
  if (!match) {
    throw new Error(
      `Envelope transacional inválido: esperado BEGIN ... ${closingStatement.toUpperCase()}.`,
    );
  }
  return match[1];
}

function ler(relativo: string, fechamento: "commit" | "rollback") {
  return unwrapTransaction(fs.readFileSync(path.join(projectRoot, relativo), "utf8"), fechamento);
}

async function main() {
  const key = (process.argv[2] ?? "demo") as DatabaseKey;
  if (!VALID_DATABASES.includes(key)) {
    throw new Error(`Banco inválido: ${key}. Use um de: ${VALID_DATABASES.join(", ")}.`);
  }

  const database = loadDatabaseConfigs().find((item) => item.key === key);
  if (!database) throw new Error(`Banco ${key} não configurado.`);

  const fase1 = ler(MIGRACAO_FASE_1, "commit");
  const fase2 = ler(MIGRACAO_FASE_2, "commit");
  const checks = ler(TESTES_FASE_2, "rollback");
  const regressaoFase1 = ler(TESTES_FASE_1, "rollback");

  const { client } = await connectDatabase(database);
  client.on("notice", (notice) => {
    if (notice.message) console.log(notice.message);
  });

  const runScenario = async (name: string, steps: string[]) => {
    console.log(`\nCenário: ${name}`);
    await client.query("BEGIN");
    try {
      for (const step of steps) await client.query(step);
      await client.query("ROLLBACK");
      console.log("OK — transação revertida.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  };

  try {
    await runScenario("aplicação sobre o schema atual", [fase2, checks]);
    await runScenario("reaplicação da própria migração", [fase2, fase2, checks]);
    await runScenario("instalação limpa das duas fases", [
      "DROP TABLE IF EXISTS public.chat_push_subscription, public.chat_audio_pendente_remocao, public.chat_mensagem_oculta, public.chat_mensagem_edicao, public.chat_reacao, public.chat_mensagem, public.chat_participante, public.chat_conversa CASCADE",
      fase1,
      fase2,
      checks,
    ]);
    await runScenario("regressão dos testes da fase 1 sobre o schema da fase 2", [fase2, regressaoFase1]);
    console.log("\nResultado: migração, testes da fase 2 e regressão da fase 1 passaram sem persistir alterações.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
