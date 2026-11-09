/** Valida a migration e os cenários de edição em uma transação sempre revertida. */
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

async function main() {
  const config = loadDatabaseConfigs().find((item) => item.key === "cespedes");
  if (!config) throw new Error("Banco Cespedes não configurado.");
  const migration = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20261108235825_editar_eventos_financeiros_reserva.sql"), "utf8");
  const tests = fs.readFileSync(path.join(projectRoot, "supabase/tests/edicao_eventos_reserva.sql"), "utf8");
  const testarValorReserva = process.argv.includes("--valor-reserva");
  const testarExclusao = process.argv.includes("--exclusao") || testarValorReserva;
  const { client } = await connectDatabase(config);
  client.on("notice", (notice) => { if (notice.message) console.log(notice.message); });
  try {
    await client.query("BEGIN; SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='5s';");
    const body = migration.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
    await client.query(body);
    // A migration também deve aceitar a reexecução sem alterar novamente a função original.
    await client.query(body);
    await client.query(tests.replace(/^BEGIN;\s*$/gm, "").replace(/^ROLLBACK;\s*$/gm, ""));
    if (testarExclusao) {
      const exclusao = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20261109002607_excluir_lancamentos_reserva.sql"), "utf8")
        .replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
      await client.query(exclusao);
      await client.query(exclusao);
      const cenarios = fs.readFileSync(path.join(projectRoot, "supabase/tests/exclusao_lancamentos_reserva.sql"), "utf8");
      await client.query(cenarios.replace(/^BEGIN;\s*$/gm, "").replace(/^ROLLBACK;\s*$/gm, ""));
    }
    if (testarValorReserva) {
      const valorReserva = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20261109003531_receita_automatica_reserva.sql"), "utf8")
        .replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
      await client.query(valorReserva);
      await client.query(valorReserva);
      const recuperar = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20261109005923_preencher_valor_reservas_existentes.sql"), "utf8")
        .replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
      await client.query(recuperar);
      const antes = await client.query("SELECT count(*)::integer AS total FROM public.eventos_financeiros WHERE origem='RECEITA_RESERVA'");
      await client.query(recuperar);
      const depois = await client.query("SELECT count(*)::integer AS total FROM public.eventos_financeiros WHERE origem='RECEITA_RESERVA'");
      if (antes.rows[0].total !== depois.rows[0].total) throw new Error("A recuperação duplicou registros informativos.");
      // Receita no check-out: também precisa aceitar a reexecução.
      const noCheckout = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20261109010000_receita_reserva_no_checkout.sql"), "utf8")
        .replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
      await client.query(noCheckout);
      await client.query(noCheckout);
      await client.query(`SELECT pg_temp.exigir(NOT EXISTS(
        SELECT 1 FROM public.reserva_imovel r WHERE r.status='CONCLUIDA' AND NOT EXISTS(
          SELECT 1 FROM public.eventos_financeiros e WHERE e.source_type='RESERVA' AND e.source_id=r.id AND e.origem='RECEITA_RESERVA')),
        'reservas com check-out recebem a receita que faltava sem duplicação')`);
      await client.query(`SELECT pg_temp.exigir(NOT EXISTS(
        SELECT 1 FROM public.eventos_financeiros e JOIN public.reserva_imovel r ON r.id=e.source_id
         WHERE e.source_type='RESERVA' AND e.origem='RECEITA_RESERVA' AND e.status='ATIVO' AND r.status<>'CONCLUIDA'),
        'nenhuma reserva sem check-out mantém a receita ativa')`);
      const cenarios = fs.readFileSync(path.join(projectRoot, "supabase/tests/valor_automatico_reserva.sql"), "utf8");
      await client.query(cenarios.replace(/^BEGIN;\s*$/gm, "").replace(/^ROLLBACK;\s*$/gm, ""));
      await client.query(`SELECT pg_temp.exigir(NOT EXISTS(
        SELECT 1 FROM public.eventos_financeiros e WHERE e.origem='RECEITA_RESERVA'
          AND e.dados_snapshot->>'registro_recuperado'='true' AND e.dre_linha_id IS NOT NULL),
        'recuperação das referências não inclui valor bruto na DRE')`);
    }
    console.log("Eventos da reserva: verificações aprovadas (ROLLBACK).");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); if (error?.where) console.error(error.where); process.exitCode = 1; });
