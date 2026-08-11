begin;

do $$
declare
  v_corte constant date := date '2026-05-01';
  v_total_ativos integer;
  v_remover integer;
  v_manter integer;
  v_total_remover numeric(14, 2);
  v_total_manter numeric(14, 2);
  v_migrados_remover integer;
  v_operacionais_remover integer;
  v_sem_vencimento integer;
  v_linha record;
begin
  select
    count(*),
    count(*) filter (
      where coalesce(vencimento_em, data) is null
         or (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date <= v_corte
    ),
    count(*) filter (
      where coalesce(vencimento_em, data) is not null
        and (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date > v_corte
    ),
    coalesce(sum(valor) filter (
      where coalesce(vencimento_em, data) is null
         or (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date <= v_corte
    ), 0),
    coalesce(sum(valor) filter (
      where coalesce(vencimento_em, data) is not null
        and (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date > v_corte
    ), 0),
    count(*) filter (
      where origem = 'ORIGEM_MIGRACAO'
        and (
          coalesce(vencimento_em, data) is null
          or (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date <= v_corte
        )
    ),
    count(*) filter (
      where origem is distinct from 'ORIGEM_MIGRACAO'
        and (
          coalesce(vencimento_em, data) is null
          or (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date <= v_corte
        )
    ),
    count(*) filter (where coalesce(vencimento_em, data) is null)
  into
    v_total_ativos,
    v_remover,
    v_manter,
    v_total_remover,
    v_total_manter,
    v_migrados_remover,
    v_operacionais_remover,
    v_sem_vencimento
  from public.transacao
  where tipo = 'RECEITA'::public.tipos_transacao
    and pendente is true
    and coalesce(is_deleted, false) is false;

  raise notice 'Corte: manter vencimentos posteriores a % (a partir de 02/05/2026)', v_corte;
  raise notice 'Receitas pendentes ativas: %', v_total_ativos;
  raise notice 'REMOVER: % titulo(s), total R$ %', v_remover, v_total_remover;
  raise notice '  migrados: % | operacionais: % | sem vencimento: %',
    v_migrados_remover, v_operacionais_remover, v_sem_vencimento;
  raise notice 'MANTER: % titulo(s), total R$ %', v_manter, v_total_manter;
  raise notice '';
  raise notice 'LISTA DE REMOCAO';

  for v_linha in
    select
      id,
      (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date as vencimento,
      valor,
      nomepagador,
      descricao,
      origem,
      ordemservicoid,
      vendaid,
      entrada_id,
      usoconsumo_entrada_id,
      adiantamento_id,
      eh_adiantamento
    from public.transacao
    where tipo = 'RECEITA'::public.tipos_transacao
      and pendente is true
      and coalesce(is_deleted, false) is false
      and (
        coalesce(vencimento_em, data) is null
        or (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date <= v_corte
      )
    order by coalesce(vencimento_em, data) nulls first, id
  loop
    raise notice 'id=% | venc=% | R$ % | origem=% | pagador=% | OS=% venda=% entrada=% uso=% adiantamento=% eh_adiantamento=% | %',
      v_linha.id,
      coalesce(v_linha.vencimento::text, 'SEM DATA'),
      v_linha.valor,
      coalesce(v_linha.origem, '-'),
      coalesce(v_linha.nomepagador, '-'),
      coalesce(v_linha.ordemservicoid::text, '-'),
      coalesce(v_linha.vendaid::text, '-'),
      coalesce(v_linha.entrada_id::text, '-'),
      coalesce(v_linha.usoconsumo_entrada_id::text, '-'),
      coalesce(v_linha.adiantamento_id::text, '-'),
      coalesce(v_linha.eh_adiantamento::text, '-'),
      coalesce(v_linha.descricao, '-');
  end loop;
end
$$;

rollback;
