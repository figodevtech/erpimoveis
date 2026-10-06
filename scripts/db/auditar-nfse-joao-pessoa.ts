import { connectDatabase, loadDatabaseConfigs, readLocalMigrations } from "./lib";
import { createHash } from "node:crypto";

// Auditoria somente por leitura: não usa NFSeService nem chama a Focus.
async function main() {
  const database = loadDatabaseConfigs().find((entry) => entry.key === "demir");
  if (!database) throw new Error("Demir não configurada.");
  const { client } = await connectDatabase(database);
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const empresa = await client.query("select id, codigomunicipio, regimetributario, inscricaomunicipal, ambiente from public.empresa order by id limit 1");
    const config = await client.query("select empresa_id, padroes_emissao from public.nfse_config order by empresa_id limit 1");
    const notas = await client.query("select id, ordemservicoid, modelo_emissao, status, erros, valor_total, payload_enviado, retorno_bruto, tentativas from public.nfse where id = 139 or ordemservicoid = 525 order by id");
    const historico = await client.query("select id, modelo_emissao, status, dataemissao from public.nfse where status = 'AUTORIZADA' order by id desc limit 5");
    const migrations = await client.query("select version from supabase_migrations.schema_migrations order by version");
    const applied = new Set(migrations.rows.map((row) => String(row.version)));
    console.log(JSON.stringify({
      empresa: empresa.rows,
      config: config.rows,
      notas: notas.rows.map(({ payload_enviado, retorno_bruto, tentativas, ...row }) => ({
        ...row,
        hashRegistro: createHash("sha256").update(JSON.stringify({ ...row, payload_enviado, retorno_bruto, tentativas })).digest("hex"),
        payloadFiscal: Object.fromEntries(Object.entries(payload_enviado ?? {}).filter(([key]) => !/tomador|cnpj_prestador|informacoes_complementares/.test(key))),
        metodo: retorno_bruto?.requisicao?.metodo,
        interacoes: Array.isArray(tentativas) ? tentativas.length : null,
      })),
      historico: historico.rows,
      migrationsPendentes: readLocalMigrations().filter((entry) => !applied.has(entry.version)).map((entry) => entry.file),
    }, null, 2));
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Falha na auditoria."); process.exitCode = 1; });
