import { connectDatabase, loadDatabaseConfigs } from "../db/lib";

const APLICAR = new Set(process.argv.slice(2)).has("--aplicar");
const PREFIXO = "LEGADO_OS_EXPORTACAO:";
const TOTAL_NATIVAS = 54;
const TOTAL_MIGRADAS = 1_736;
const PRIMEIRO_ID = TOTAL_NATIVAS + 1;
const ULTIMO_ID = TOTAL_NATIVAS + TOTAL_MIGRADAS;

type Fk = {
  schema_nome: string;
  tabela_nome: string;
  constraint_nome: string;
  coluna_nome: string;
  definicao: string;
};

function identificador(valor: string) {
  return `"${valor.replace(/"/g, '""')}"`;
}

async function main() {
  const banco = loadDatabaseConfigs().find((item) => item.key === "garage");
  if (!banco) throw new Error("Banco Garage Premium nao configurado.");

  const { client } = await connectDatabase(banco);
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [PREFIXO]);

    const resumo = await client.query<{
      nativas: number;
      nativa_min: number;
      nativa_max: number;
      migradas: number;
      migrada_min: number;
      migrada_max: number;
      destino_ocupado: number;
    }>(`
      select
        count(*) filter (where migracao_referencia is null)::int nativas,
        min(id) filter (where migracao_referencia is null)::int nativa_min,
        max(id) filter (where migracao_referencia is null)::int nativa_max,
        count(*) filter (where migracao_referencia is not null)::int migradas,
        min(id) filter (where migracao_referencia is not null)::int migrada_min,
        max(id) filter (where migracao_referencia is not null)::int migrada_max,
        count(*) filter (where id between ${PRIMEIRO_ID} and ${ULTIMO_ID})::int destino_ocupado
      from public.ordemservico
    `);
    const antes = resumo.rows[0];
    const jaRenumerada =
      antes.nativas === TOTAL_NATIVAS &&
      antes.nativa_min === 1 &&
      antes.nativa_max === TOTAL_NATIVAS &&
      antes.migradas === TOTAL_MIGRADAS &&
      antes.migrada_min === PRIMEIRO_ID &&
      antes.migrada_max === ULTIMO_ID &&
      antes.destino_ocupado === TOTAL_MIGRADAS;
    if (jaRenumerada) {
      const auditoria = await client.query<{
        saidas: number;
        datas_inconsistentes: number;
        financeiro: number;
        ids_antigos_auditoria: number;
        saidas_antigas_auditoria: number;
        sequencia: number;
        identidade: string;
      }>(`
        select
          (select count(*)::int from public.os_saida s join public.ordemservico o on o.id = s.ordemservico_id where o.migracao_referencia is not null) saidas,
          (select count(*)::int from public.ordemservico o where o.migracao_referencia is not null and (o.datasaida is distinct from o.dataentrada or o.pagamento_concluido_em is distinct from o.dataentrada or o.finalizado_em is distinct from o.dataentrada)) datas_inconsistentes,
          (select count(*)::int from public.transacao t join public.ordemservico o on o.id = t.ordemservicoid where o.migracao_referencia is not null)
            + (select count(*)::int from public.pagamento p join public.ordemservico o on o.id = p.ordemservicoid where o.migracao_referencia is not null)
            + (select count(*)::int from public.eventos_financeiros e join public.ordemservico o on o.id = e.ordemservicoid where o.migracao_referencia is not null) financeiro,
          (select count(*)::int from public.auditoria_evento a where a.tabela = 'ordemservico' and a.registro_id::bigint between 3527 and 5262) ids_antigos_auditoria,
          (select count(*)::int from public.auditoria_evento a where a.tabela = 'os_saida' and coalesce(a.dados_novos ->> 'ordemservico_id', a.dados_anteriores ->> 'ordemservico_id')::bigint between 3527 and 5262) saidas_antigas_auditoria,
          (select last_value::int from public.ordemservico_id_seq) sequencia,
          (select a.attidentity from pg_attribute a where a.attrelid = 'public.ordemservico'::regclass and a.attname = 'id') identidade
      `);
      const atual = auditoria.rows[0];
      if (
        atual.saidas !== TOTAL_MIGRADAS ||
        atual.datas_inconsistentes !== 0 ||
        atual.financeiro !== 0 ||
        atual.ids_antigos_auditoria !== 0 ||
        atual.saidas_antigas_auditoria !== 0 ||
        atual.sequencia !== ULTIMO_ID ||
        atual.identidade !== "a"
      ) {
        throw new Error(`Renumeracao existente inconsistente: ${JSON.stringify(atual)}`);
      }
      await client.query("ROLLBACK");
      console.log(`Renumeracao ja aplicada e auditada: IDs ${PRIMEIRO_ID}-${ULTIMO_ID}; proxima OS ${ULTIMO_ID + 1}.`);
      console.log("Financeiro: 0. Datas inconsistentes: 0. Referencias antigas na auditoria: 0.");
      return;
    }
    if (
      antes.nativas !== TOTAL_NATIVAS ||
      antes.nativa_min !== 1 ||
      antes.nativa_max !== TOTAL_NATIVAS ||
      antes.migradas !== TOTAL_MIGRADAS ||
      antes.migrada_min !== 3_527 ||
      antes.migrada_max !== 5_262 ||
      antes.destino_ocupado !== 0
    ) {
      throw new Error(`Pre-condicoes dos IDs divergentes: ${JSON.stringify(antes)}`);
    }

    const fks = await client.query<Fk>(`
      select
        n.nspname schema_nome,
        r.relname tabela_nome,
        c.conname constraint_nome,
        a.attname coluna_nome,
        pg_get_constraintdef(c.oid, true) definicao
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and c.confrelid = 'public.ordemservico'::regclass
        and array_length(c.conkey, 1) = 1
      order by n.nspname, r.relname, c.conname
    `);
    if (fks.rowCount !== 15) throw new Error(`Esperadas 15 FKs para ordemservico; encontradas ${fks.rowCount}.`);

    const referencias: Array<{ tabela: string; total: number }> = [];
    for (const fk of fks.rows) {
      const tabela = `${identificador(fk.schema_nome)}.${identificador(fk.tabela_nome)}`;
      const coluna = identificador(fk.coluna_nome);
      const contagem = await client.query<{ total: number }>(
        `select count(*)::int total from ${tabela} where ${coluna} between 3527 and 5262`,
      );
      referencias.push({ tabela: fk.tabela_nome, total: contagem.rows[0].total });
    }
    const saidasAntes = referencias.find((item) => item.tabela === "os_saida")?.total ?? 0;
    const outrasReferencias = referencias
      .filter((item) => item.tabela !== "os_saida")
      .reduce((total, item) => total + item.total, 0);
    if (saidasAntes !== TOTAL_MIGRADAS || outrasReferencias !== 0) {
      throw new Error(`Referencias inesperadas: ${JSON.stringify(referencias)}`);
    }

    const auditoriaAntes = await client.query<{ eventos_os: number; json_saidas: number }>(`
      select
        count(*) filter (
          where tabela = 'ordemservico' and registro_id::bigint between 3527 and 5262
        )::int eventos_os,
        count(*) filter (
          where tabela = 'os_saida'
            and coalesce(dados_novos ->> 'ordemservico_id', dados_anteriores ->> 'ordemservico_id')::bigint between 3527 and 5262
        )::int json_saidas
      from public.auditoria_evento
    `);

    console.log(`IDs atuais: nativas 1-${TOTAL_NATIVAS}; migradas ${antes.migrada_min}-${antes.migrada_max}.`);
    console.log(`Novo intervalo: ${PRIMEIRO_ID}-${ULTIMO_ID}; referencias de saida: ${saidasAntes}.`);
    console.log(`Auditoria: ${auditoriaAntes.rows[0].eventos_os} eventos de OS e ${auditoriaAntes.rows[0].json_saidas} snapshots de saida.`);

    if (!APLICAR) {
      await client.query("ROLLBACK");
      console.log("Simulacao concluida; nenhuma alteracao aplicada.");
      return;
    }

    const tabelasBloqueio = [
      "public.ordemservico",
      "public.auditoria_evento",
      ...fks.rows.map((fk) => `${identificador(fk.schema_nome)}.${identificador(fk.tabela_nome)}`),
    ];
    await client.query(`lock table ${[...new Set(tabelasBloqueio)].join(", ")} in access exclusive mode`);

    await client.query(`
      create temporary table os_id_mapa (
        id_antigo integer primary key,
        id_novo integer not null unique
      ) on commit drop
    `);
    await client.query(`
      insert into os_id_mapa (id_antigo, id_novo)
      select id, (${TOTAL_NATIVAS} + row_number() over (order by id))::integer
      from public.ordemservico
      where migracao_referencia like $1
      order by id
    `, [`${PREFIXO}%`]);

    await client.query("alter table public.ordemservico disable trigger user");
    await client.query("alter table public.os_saida disable trigger user");
    await client.query("alter table public.ordemservico alter column id set generated by default");

    for (const fk of fks.rows) {
      const tabela = `${identificador(fk.schema_nome)}.${identificador(fk.tabela_nome)}`;
      await client.query(`alter table ${tabela} drop constraint ${identificador(fk.constraint_nome)}`);
    }

    for (const fk of fks.rows) {
      const tabela = `${identificador(fk.schema_nome)}.${identificador(fk.tabela_nome)}`;
      const coluna = identificador(fk.coluna_nome);
      await client.query(`
        update ${tabela} filho
           set ${coluna} = mapa.id_novo
          from os_id_mapa mapa
         where filho.${coluna} = mapa.id_antigo
      `);
    }

    const ordensAtualizadas = await client.query(`
      update public.ordemservico os
         set id = mapa.id_novo
        from os_id_mapa mapa
       where os.id = mapa.id_antigo
    `);
    if (ordensAtualizadas.rowCount !== TOTAL_MIGRADAS) {
      throw new Error(`Atualizadas ${ordensAtualizadas.rowCount} OS; esperado: ${TOTAL_MIGRADAS}.`);
    }

    await client.query(`
      update public.auditoria_evento evento
         set registro_id = mapa.id_novo::text,
             dados_anteriores = case
               when evento.dados_anteriores ? 'id'
                 then jsonb_set(evento.dados_anteriores, '{id}', to_jsonb(mapa.id_novo), false)
               else evento.dados_anteriores
             end,
             dados_novos = case
               when evento.dados_novos ? 'id'
                 then jsonb_set(evento.dados_novos, '{id}', to_jsonb(mapa.id_novo), false)
               else evento.dados_novos
             end
        from os_id_mapa mapa
       where evento.tabela = 'ordemservico'
         and evento.registro_id = mapa.id_antigo::text
    `);
    await client.query(`
      update public.auditoria_evento evento
         set dados_anteriores = case
               when evento.dados_anteriores ->> 'ordemservico_id' = mapa.id_antigo::text
                 then jsonb_set(evento.dados_anteriores, '{ordemservico_id}', to_jsonb(mapa.id_novo), false)
               else evento.dados_anteriores
             end,
             dados_novos = case
               when evento.dados_novos ->> 'ordemservico_id' = mapa.id_antigo::text
                 then jsonb_set(evento.dados_novos, '{ordemservico_id}', to_jsonb(mapa.id_novo), false)
               else evento.dados_novos
             end
        from os_id_mapa mapa
       where evento.tabela = 'os_saida'
         and (
           evento.dados_anteriores ->> 'ordemservico_id' = mapa.id_antigo::text
           or evento.dados_novos ->> 'ordemservico_id' = mapa.id_antigo::text
         )
    `);

    for (const fk of fks.rows) {
      const tabela = `${identificador(fk.schema_nome)}.${identificador(fk.tabela_nome)}`;
      await client.query(
        `alter table ${tabela} add constraint ${identificador(fk.constraint_nome)} ${fk.definicao}`,
      );
    }

    await client.query("alter table public.os_saida enable trigger user");
    await client.query("alter table public.ordemservico enable trigger user");
    await client.query("select setval('public.ordemservico_id_seq', $1, true)", [ULTIMO_ID]);
    await client.query("alter table public.ordemservico alter column id set generated always");

    const depois = await client.query<{
      nativas: number;
      migradas: number;
      migrada_min: number;
      migrada_max: number;
      ids_antigos: number;
      saidas: number;
      datas_inconsistentes: number;
      financeiro: number;
      auditoria_ids_antigos: number;
      auditoria_saida_antiga: number;
      sequencia: number;
    }>(`
      select
        count(*) filter (where os.migracao_referencia is null)::int nativas,
        count(*) filter (where os.migracao_referencia is not null)::int migradas,
        min(os.id) filter (where os.migracao_referencia is not null)::int migrada_min,
        max(os.id) filter (where os.migracao_referencia is not null)::int migrada_max,
        count(*) filter (where os.id between 3527 and 5262)::int ids_antigos,
        (select count(*)::int from public.os_saida s join public.ordemservico o on o.id = s.ordemservico_id where o.migracao_referencia is not null) saidas,
        count(*) filter (where os.migracao_referencia is not null and (os.datasaida is distinct from os.dataentrada or os.pagamento_concluido_em is distinct from os.dataentrada or os.finalizado_em is distinct from os.dataentrada))::int datas_inconsistentes,
        (select count(*)::int from public.transacao t join public.ordemservico o on o.id = t.ordemservicoid where o.migracao_referencia is not null)
          + (select count(*)::int from public.pagamento p join public.ordemservico o on o.id = p.ordemservicoid where o.migracao_referencia is not null)
          + (select count(*)::int from public.eventos_financeiros e join public.ordemservico o on o.id = e.ordemservicoid where o.migracao_referencia is not null) financeiro,
        (select count(*)::int from public.auditoria_evento a where a.tabela = 'ordemservico' and a.registro_id::bigint between 3527 and 5262) auditoria_ids_antigos,
        (select count(*)::int from public.auditoria_evento a where a.tabela = 'os_saida' and coalesce(a.dados_novos ->> 'ordemservico_id', a.dados_anteriores ->> 'ordemservico_id')::bigint between 3527 and 5262) auditoria_saida_antiga,
        (select last_value::int from public.ordemservico_id_seq) sequencia
      from public.ordemservico os
    `);
    const validacao = depois.rows[0];
    if (
      validacao.nativas !== TOTAL_NATIVAS ||
      validacao.migradas !== TOTAL_MIGRADAS ||
      validacao.migrada_min !== PRIMEIRO_ID ||
      validacao.migrada_max !== ULTIMO_ID ||
      validacao.ids_antigos !== 0 ||
      validacao.saidas !== TOTAL_MIGRADAS ||
      validacao.datas_inconsistentes !== 0 ||
      validacao.financeiro !== 0 ||
      validacao.auditoria_ids_antigos !== 0 ||
      validacao.auditoria_saida_antiga !== 0 ||
      validacao.sequencia !== ULTIMO_ID
    ) {
      throw new Error(`Auditoria final falhou: ${JSON.stringify(validacao)}`);
    }

    await client.query("COMMIT");
    console.log(`Renumeracao concluida: ${TOTAL_MIGRADAS} OS agora ocupam ${PRIMEIRO_ID}-${ULTIMO_ID}.`);
    console.log(`Proxima OS: ${ULTIMO_ID + 1}. Financeiro: 0. Datas inconsistentes: 0.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
