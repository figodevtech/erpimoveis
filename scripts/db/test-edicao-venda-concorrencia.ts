/** Dois clientes no DEMO, sempre com rollback. RPC real em pg_temp para nao publicar schema. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";
import { splitLikeSupabaseCli } from "./supabase-splitter";

async function main() {
  const banco = loadDatabaseConfigs().find(b => b.key === "cespedes");
  if (!banco) throw new Error("Banco DEMO nao configurado.");
  const definition = splitLikeSupabaseCli(fs.readFileSync(path.join(projectRoot,
    "supabase/migrations/20261005193130_editar_eventos_financeiros_venda.sql"), "utf8"))
    .find(sql => /CREATE OR REPLACE FUNCTION public\.editar_evento_financeiro_venda\(/.test(sql));
  assert.ok(definition);
  const privado = definition.replace("FUNCTION public.editar_evento_financeiro_venda(", "FUNCTION pg_temp.editar_evento_financeiro_venda(");
  const { client: bloqueador } = await connectDatabase(banco);
  let editor: typeof bloqueador | undefined;
  try {
    editor = (await connectDatabase(banco)).client;
    const { rows: [evento] } = await bloqueador.query(`SELECT e.id,e.source_id,e.valor,
      (SELECT id FROM public.usuario WHERE ativo ORDER BY id LIMIT 1) AS usuario
      FROM public.eventos_financeiros e JOIN public.venda v ON v.id=e.source_id
      WHERE e.source_type='VENDA' AND e.ordemservicoid IS NULL AND e.origem='PRODUTO'
        AND e.natureza='RECEITA' AND e.status='ATIVO' AND e.transacaoid IS NULL
        AND e.lancamento_id IS NULL AND NOT e.is_manual ORDER BY e.id LIMIT 1`);
    assert.ok(evento?.usuario, "DEMO requer uma receita automatica ativa e um usuario para o teste.");
    for (const escopo of ["venda", "evento"] as const) {
      await bloqueador.query("BEGIN");
      await editor.query("BEGIN");
      await editor.query(privado);
      await editor.query("SET LOCAL lock_timeout = '750ms'");
      if (escopo === "venda") {
        await bloqueador.query("SELECT id FROM public.venda WHERE id=$1 FOR UPDATE", [evento.source_id]);
      } else {
        // A publicacao financeira toma este mesmo lock. Enquanto estiver
        // vinculando o evento, a edicao nao pode ler ATIVO e ultrapassa-la.
        await bloqueador.query("SELECT id FROM public.eventos_financeiros WHERE id=$1 FOR UPDATE", [evento.id]);
        await bloqueador.query("UPDATE public.eventos_financeiros SET status='CONVERTIDO' WHERE id=$1", [evento.id]);
      }
      await assert.rejects(editor.query("SELECT pg_temp.editar_evento_financeiro_venda($1,$2,$3::jsonb,$4::uuid)",
        [evento.source_id,evento.id,JSON.stringify({ valor: Number(evento.valor) + 1 }),evento.usuario]),
      (error: unknown) => (error as { code?: string }).code === "55P03");
      await editor.query("ROLLBACK");
      await bloqueador.query("ROLLBACK");
    }
    // Liberados os locks, a mesma funcao passa. Sua edicao tambem e revertida.
    await editor.query("BEGIN");
    await editor.query(privado);
    const { rows: [resultado] } = await editor.query("SELECT pg_temp.editar_evento_financeiro_venda($1,$2,$3::jsonb,$4::uuid) AS evento",
      [evento.source_id,evento.id,JSON.stringify({ valor: Number(evento.valor) + 1 }),evento.usuario]);
    assert.equal(Number(resultado.evento.valor), Math.round((Number(evento.valor) + 1) * 100) / 100);
    await editor.query("ROLLBACK");
    const { rows: [final] } = await bloqueador.query("SELECT valor,status FROM public.eventos_financeiros WHERE id=$1", [evento.id]);
    assert.equal(final.valor, evento.valor);
    assert.equal(final.status, "ATIVO");
    console.log("Concorrencia: locks de venda/evento impedem edicao durante publicacao; liberados, RPC edita. Tudo revertido.");
  } finally {
    await editor?.query("ROLLBACK").catch(() => undefined);
    await bloqueador.query("ROLLBACK").catch(() => undefined);
    await editor?.end();
    await bloqueador.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
