import fs from "node:fs";
import path from "node:path";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

async function main() {
  const demo = loadDatabaseConfigs().find((b) => b.key === "demo")!;
  const { client } = await connectDatabase(demo);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '20s'");
    const migration = fs.readFileSync(path.join(projectRoot,
      "supabase/migrations/20260908170000_condicoes_no_envio_faturamento.sql"), "utf8");
    await client.query(migration.replace(/^BEGIN;/m, "").replace(/^COMMIT;/m, ""));
    await client.query(`DO $$
      DECLARE v_id integer; v_erro boolean; v_condicoes jsonb;
      BEGIN
        UPDATE config_geral SET habilitar_faturamento_os = true;
        INSERT INTO ordemservico(usuariocriadorid,clienteid,status,orcamentototal,subtotal,valor_frete,dataentrada)
          VALUES((SELECT id FROM usuario WHERE ativo LIMIT 1),(SELECT id FROM cliente LIMIT 1),'ORCAMENTO',100,100,0,now())
          RETURNING id INTO v_id;
        UPDATE ordemservico SET status='ORCAMENTO_APROVADO' WHERE id=v_id;
        UPDATE ordemservico SET status='EM_ANDAMENTO' WHERE id=v_id;
        UPDATE ordemservico SET status='PAGAMENTO' WHERE id=v_id;
        IF (SELECT pagamentos_previstos FROM ordemservico WHERE id=v_id) IS NOT NULL THEN
          RAISE EXCEPTION 'Pagamento deve aceitar execução encerrada sem condições.';
        END IF;
        v_erro := false;
        BEGIN
          PERFORM transicionar_faturamento_os(v_id,'FATURAMENTO','{"pagamentos_previstos":[]}'::jsonb);
        EXCEPTION WHEN OTHERS THEN v_erro := true; END;
        IF NOT v_erro OR (SELECT status FROM ordemservico WHERE id=v_id) <> 'PAGAMENTO' THEN
          RAISE EXCEPTION 'Faturamento sem condições deve falhar sem alterar o status.';
        END IF;
        v_condicoes := '{"pagamentos_previstos":[{"metodo":"PIX","valor":100,"parcelas":null}],"forma_pagamento":"PIX","parcelas_pagamento":null,"descricao_financeiro":"Acordo teste","garantia":"90 dias"}'::jsonb;
        PERFORM transicionar_faturamento_os(v_id,'FATURAMENTO',v_condicoes);
        IF (SELECT status FROM ordemservico WHERE id=v_id) <> 'FATURAMENTO'
          OR (SELECT pagamentos_previstos FROM ordemservico WHERE id=v_id) IS DISTINCT FROM v_condicoes->'pagamentos_previstos' THEN
          RAISE EXCEPTION 'Faturamento não preservou as condições.';
        END IF;
        PERFORM transicionar_faturamento_os(v_id,'PAGAMENTO');
        IF (SELECT pagamentos_previstos FROM ordemservico WHERE id=v_id) IS DISTINCT FROM v_condicoes->'pagamentos_previstos' THEN
          RAISE EXCEPTION 'Retorno apagou o acordo.';
        END IF;
        -- Simula uma OS com acordo anterior à ativação do faturamento.
        UPDATE config_geral SET habilitar_faturamento_os = false;
        UPDATE config_geral SET habilitar_faturamento_os = true;
        PERFORM transicionar_faturamento_os(v_id,'FATURAMENTO');
        IF (SELECT pagamentos_previstos FROM ordemservico WHERE id=v_id) IS DISTINCT FROM v_condicoes->'pagamentos_previstos'
          OR (SELECT forma_pagamento::text FROM ordemservico WHERE id=v_id) IS DISTINCT FROM 'PIX'
          OR (SELECT descricao_financeiro FROM ordemservico WHERE id=v_id) IS DISTINCT FROM 'Acordo teste'
          OR (SELECT garantia FROM ordemservico WHERE id=v_id) IS DISTINCT FROM '90 dias' THEN
          RAISE EXCEPTION 'Ativação ou envio ao faturamento apagou dados anteriores.';
        END IF;
        PERFORM transicionar_faturamento_os(v_id,'PAGAMENTO');
        UPDATE ordemservico SET pagamentos_previstos = null,
          forma_pagamento = 'BOLETO', parcelas_pagamento = 3 WHERE id = v_id;
        UPDATE config_geral SET habilitar_faturamento_os = false;
        UPDATE config_geral SET habilitar_faturamento_os = true;
        PERFORM transicionar_faturamento_os(v_id,'FATURAMENTO');
        IF (SELECT pagamentos_previstos FROM ordemservico WHERE id=v_id) IS NOT NULL
          OR (SELECT forma_pagamento::text FROM ordemservico WHERE id=v_id) IS DISTINCT FROM 'BOLETO'
          OR (SELECT parcelas_pagamento FROM ordemservico WHERE id=v_id) IS DISTINCT FROM 3
          OR (SELECT descricao_financeiro FROM ordemservico WHERE id=v_id) IS DISTINCT FROM 'Acordo teste'
          OR (SELECT garantia FROM ordemservico WHERE id=v_id) IS DISTINCT FROM '90 dias' THEN
          RAISE EXCEPTION 'Dados do formato antigo de pagamento foram alterados.';
        END IF;
      END;
    $$`);
    console.log("Condições no faturamento validadas no banco de demonstração; teste e migration revertidos por ROLLBACK.");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}
main().catch((erro) => { console.error(erro instanceof Error ? erro.message : "Falha no teste"); process.exitCode = 1; });
