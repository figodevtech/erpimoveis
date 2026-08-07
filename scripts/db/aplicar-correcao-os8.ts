/**
 * Correcao pontual da OS #8 do Garage Premium, finalizada sem cobranca antes da
 * regra nova. Script descartavel: rode uma vez e apague.
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

const SQL = `
DO $$
DECLARE v_quando timestamptz;
BEGIN
  SELECT max(updated_at) INTO v_quando FROM public.eventos_financeiros WHERE ordemservicoid = 8;

  UPDATE public.eventos_financeiros
     SET status = 'CANCELADO', updated_at = now()
   WHERE ordemservicoid = 8 AND status = 'ATIVO'
     AND (natureza = 'RECEITA' OR origem = 'DESCONTO');

  UPDATE public.ordemservico
     SET desconto_tipo = 'PORCENTAGEM', desconto = 100, orcamentototal = 0,
         acrescimo_financeiro_tipo = NULL, acrescimo_financeiro_valor = 0
   WHERE id = 8;

  UPDATE public.ordemservico SET execucao_fim_em = v_quando WHERE id = 8;
END $$;
`;

const CONFERENCIA = `
  SELECT o.orcamentototal,
         coalesce(sum(e.valor) FILTER (WHERE e.natureza='RECEITA' AND e.status='ATIVO' AND e.competencia_em IS NOT NULL),0) AS receita_dre,
         coalesce(sum(e.valor) FILTER (WHERE e.natureza='DESPESA' AND e.status='ATIVO' AND e.competencia_em IS NOT NULL),0) AS despesa_dre,
         count(e.id) FILTER (WHERE e.status='CANCELADO') AS cancelados,
         max(e.competencia_em) AS competencia
    FROM public.ordemservico o
    LEFT JOIN public.eventos_financeiros e ON e.ordemservicoid = o.id
   WHERE o.id = 8 GROUP BY o.orcamentototal`;

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "garage");
  if (!configuracao) throw new Error("Garage Premium nao configurado.");

  const { client } = await connectDatabase(configuracao);
  try {
    await client.query("BEGIN");
    await client.query(SQL);
    const { rows } = await client.query(CONFERENCIA);
    console.log("Conferencia dentro da transacao:", rows[0]);
    await client.query("COMMIT");
    console.log("COMMIT aplicado.");

    const depois = await client.query(CONFERENCIA);
    console.log("Releitura apos commit:", depois.rows[0]);
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
