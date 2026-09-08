import { connectDatabase, loadDatabaseConfigs } from "./lib";

async function main() {
  const demo = loadDatabaseConfigs().find((database) => database.key === "demo");
  if (!demo) throw new Error("Banco de demonstração não configurado.");
  const { client } = await connectDatabase(demo);
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    if (process.argv[2]) {
      const id = Number(process.argv[2]);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("ID inválido.");
      const consulta = await client.query(`with fluxo as (
        select id, row_number() over (order by data_dia desc nulls last,
          movimento_registrado_em desc, id desc) as posicao
        from transacao where is_deleted = false and pendente = false and banco_id is not null
      ) select t.id, t.descricao, t.data, t.data_dia, t.created_at,
        t.movimento_registrado_em, t.pendente, t.is_deleted, t.deleted_at,
        t.banco_id, b.titulo as banco, t.tipo, t.valor, t."valorLiquido",
        t.baixa_de_transacao_id, t.adiantamento_id, t.eh_adiantamento,
        t.transferencia_id, t.abonado, t.categoria_id, t.metodopagamento,
        f.posicao, m.id as movimento_ofx, m.status as status_ofx,
        m.acao_conciliacao, m.data_postagem, m.conciliado_em
        from transacao t left join bancoconta b on b.id = t.banco_id
        left join fluxo f on f.id = t.id
        left join ofx_movimento m on m.transacao_id = t.id
        where t.id = $1`, [id]);
      console.log("transacao", JSON.stringify(consulta.rows));
      return;
    }
    const consultas = {
      importacoes: `select i.id, i.arquivo_nome, i.created_at,
        m.status, m.acao_conciliacao, count(*)::int as quantidade,
        min(m.data_postagem) as primeira_data, max(m.data_postagem) as ultima_data
        from ofx_importacao i join ofx_movimento m on m.importacao_id = i.id
        group by i.id, m.status, m.acao_conciliacao order by i.id desc limit 20`,
      criadas: `with fluxo as (
        select id, row_number() over (order by data_dia desc nulls last,
          movimento_registrado_em desc, id desc) as posicao
        from transacao where is_deleted = false and pendente = false and banco_id is not null
      ) select m.id as movimento_id, m.status, m.data_postagem, m.valor,
        t.id as transacao_id, t.descricao, t.data_dia, t.created_at, t.pendente,
        t.is_deleted, t.banco_id, t.tipo, t."valorLiquido", f.posicao
        from ofx_movimento m left join transacao t on t.id = m.transacao_id
        left join fluxo f on f.id = t.id where m.acao_conciliacao = 'CRIAR'
        order by m.conciliado_em desc limit 30`,
      totaisPorMes: `select to_char(data_dia, 'YYYY-MM') as mes, count(*)::int as quantidade,
        sum(case when tipo in ('RECEITA','DEPOSITO') then coalesce(nullif("valorLiquido",0),valor) else 0 end) as entradas,
        sum(case when tipo in ('DESPESA','SAQUE') then coalesce(nullif("valorLiquido",0),valor) else 0 end) as saidas
        from transacao where is_deleted = false and pendente = false and banco_id is not null
        group by 1 order by 1 desc limit 12`,
    };
    for (const [nome, sql] of Object.entries(consultas)) {
      console.log(nome, JSON.stringify((await client.query(sql)).rows));
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha no diagnóstico.");
  process.exitCode = 1;
});
