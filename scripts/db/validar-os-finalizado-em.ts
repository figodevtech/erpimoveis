import { connectDatabase, loadDatabaseConfigs } from "./lib";

type Validacao = {
  concluidas: number;
  sem_cobranca: number;
  canceladas: number;
  finais_sem_data: number;
  abertas_com_data: number;
  sem_cobranca_canceladas_auditaveis: number;
  retroativo_divergente: number;
  migradas_inconsistentes: number;
};

async function main() {
  let encontrouErro = false;

  for (const database of loadDatabaseConfigs()) {
    const { client } = await connectDatabase(database);
    try {
      const resultado = await client.query<Validacao>(`
        with transicoes as (
          select os.id,
            (
              select max(a.ocorrido_em)
              from public.auditoria_evento a
              where a.tabela = 'ordemservico'
                and a.registro_id = os.id::text
                and a.dados_novos ->> 'status' = os.status::text
                and a.campos_alterados @> array['status']::text[]
            ) ocorrido_em
          from public.ordemservico os
          where os.status::text in ('SEM_COBRANCA', 'CANCELADO')
            and os.migracao_referencia is null
        )
        select
          count(*) filter (where os.status::text = 'CONCLUIDO')::int concluidas,
          count(*) filter (where os.status::text = 'SEM_COBRANCA')::int sem_cobranca,
          count(*) filter (where os.status::text = 'CANCELADO')::int canceladas,
          count(*) filter (
            where os.status::text in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO')
              and os.finalizado_em is null
          )::int finais_sem_data,
          count(*) filter (
            where os.status::text not in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO')
              and os.finalizado_em is not null
          )::int abertas_com_data,
          count(*) filter (
            where os.status::text in ('SEM_COBRANCA', 'CANCELADO')
              and os.migracao_referencia is null
              and t.ocorrido_em is not null
          )::int sem_cobranca_canceladas_auditaveis,
          count(*) filter (
            where os.status::text in ('SEM_COBRANCA', 'CANCELADO')
              and os.migracao_referencia is null
              and t.ocorrido_em is not null
              and os.finalizado_em is distinct from t.ocorrido_em
          )::int retroativo_divergente,
          count(*) filter (
            where os.migracao_referencia is not null
              and os.finalizado_em is distinct from os.dataentrada
          )::int migradas_inconsistentes
        from public.ordemservico os
        left join transicoes t on t.id = os.id
      `);
      const dados = resultado.rows[0];
      console.log(`${database.label}:`, dados);

      if (
        dados.finais_sem_data !== 0 ||
        dados.abertas_com_data !== 0 ||
        dados.retroativo_divergente !== 0 ||
        dados.migradas_inconsistentes !== 0
      ) {
        encontrouErro = true;
      }
    } finally {
      await client.end();
    }
  }

  if (encontrouErro) {
    throw new Error("A validacao encontrou datas de finalizacao inconsistentes.");
  }

  console.log("Validacao concluida: datas de finalizacao consistentes nos três bancos.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
