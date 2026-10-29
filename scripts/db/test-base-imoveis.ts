import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PERMS, TIPO_PERMISSIONS } from "../../src/app/api/_authz/permission-constants";
import { configurarAdministradorInicial } from "./configurar-administrador-inicial";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

async function main() {
  const emailIndex = process.argv.indexOf("--email");
  const email = emailIndex >= 0 ? process.argv[emailIndex + 1] : "";
  if (!email) throw new Error("Informe --email com o e-mail do único usuário para testar o bootstrap em rollback.");
  const migration = fs.readFileSync(path.join(
    projectRoot, "supabase/migrations/20261029154534_excluir_agendamentos_e_legado_oficina.sql",
  ), "utf8").replace(/^\s*begin\s*;/i, "").replace(/commit\s*;\s*$/i, "");
  const { client } = await connectDatabase(loadDatabaseConfigs()[0]);
  try {
    await client.query("begin; set local lock_timeout = '3s'; set local statement_timeout = '30s'");
    const before = (await client.query<{ nome: string }>("select nome from public.permissao order by nome")).rows;
    await client.query(migration);
    const expected = [...new Set([...Object.values(PERMS), ...TIPO_PERMISSIONS])].sort();
    const actual = (await client.query<{ nome: string }>("select nome from public.permissao order by nome")).rows.map((p) => p.nome).sort();
    assert.deepEqual(actual, expected, "O catálogo deve corresponder ao código, sem perder acessos mantidos");
    console.log(`Catálogo validado: ${actual.length} permissões; ${before.length - actual.length} obsoletas retiradas na simulação.`);
    await client.query(migration);
    assert.equal((await client.query("select count(*)::int total from public.permissao")).rows[0].total, expected.length);

    const realtime = (await client.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'",
    )).rows.map((r) => r.tablename);
    assert(!realtime.some((t) => ["ordemservico", "osservico", "osservico_realizador"].includes(t)));
    for (const name of ["system_notification", "transacao", "venda"]) assert(realtime.includes(name));

    await assert.rejects(configurarAdministradorInicial(client, "usuario-diferente@example.invalid"), /único usuário/);
    const originalRoot = (await client.query("select is_root from public.usuario")).rows[0].is_root;
    const result = await configurarAdministradorInicial(client, email);
    assert.deepEqual(await configurarAdministradorInicial(client, email), result, "Bootstrap deve ser idempotente");
    const active = (await client.query("select ativo, perfilid, is_root from public.usuario")).rows[0];
    assert.equal(active.ativo, true);
    assert.equal(active.perfilid, result.perfilId);
    assert.equal(active.is_root, originalRoot);
    assert.equal(result.permissoes, expected.length);

    await client.query("savepoint segundo_usuario");
    await client.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, '{}'::jsonb)",
      [randomUUID(), `teste-${randomUUID()}@example.invalid`]);
    await assert.rejects(configurarAdministradorInicial(client, email), /único usuário/);
    await client.query("rollback to savepoint segundo_usuario");
    console.log("Administrador validado: vínculo, todos os acessos, repetição e recusa de usuário diferente/múltiplos usuários.");

    const removed = ["agendamento", "aluguel", "aluguel_item", "orcamento", "ordemservico", "veiculo",
      "osservico", "osproduto", "osproduto_avulso", "lotes", "lote_pecas", "checklist_documento", "nfse_os_servico_vinculo"];
    for (const table of removed) {
      assert.equal((await client.query("select to_regclass($1) as tabela", [`public.${table}`])).rows[0].tabela, null);
    }
    for (const table of ["transacao", "venda", "cliente", "documento_modelo", "eventos_financeiros_fila", "transacao_cliente"]) {
      await client.query(`select 1 from public.${table} limit 1`);
    }
    await client.query("select public.dashboard_estoque_resumo()");
    await client.query("select * from public.buscar_ultimo_valor_venda_produto(1)");
    await client.query("insert into public.dre_implantacao(estado) select 'LEGADO' where not exists(select 1 from public.dre_implantacao)");
    await client.query(fs.readFileSync(path.join(projectRoot, "supabase/tests/exclusao_legado_preserva_fluxos.sql"), "utf8"));
    // Regressão existente: CRUD de eventos em todos os status de venda,
    // auditoria, fila, sincronização, parcelas, estorno e DRE.
    const salesTest = fs.readFileSync(path.join(projectRoot, "supabase/tests/eventos_manuais_venda.sql"), "utf8")
      .replace(/^\s*--[^\n]*\n\s*BEGIN\s*;/i, "").replace(/ROLLBACK\s*;\s*$/i, "");
    await client.query(salesTest);
    await client.query("select * from public.dre_pendencias(now() - interval '30 days', now())");
    await client.query("select * from public.dre_pendencias_itens('EVENTO_SEM_COMPETENCIA', now() - interval '30 days', now())");
    console.log("Realtime e consultas compartilhadas validados. Tudo revertido ao final.");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha na validação da base de imóveis.");
  if (error && typeof error === "object" && "where" in error) console.error(error.where);
  process.exitCode = 1;
});
