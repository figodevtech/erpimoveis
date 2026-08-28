begin;

-- `ordemservico.updatedat` nunca e tocado pela aplicacao ao trocar o status
-- (nenhuma rota de /api/ordens grava essa coluna, e nao ha trigger generico
-- de "bumped updatedat"). Com isso `coalesce(new.updatedat, new.createdat, now())`
-- sempre resolvia para o instante de CRIACAO da OS, nao o instante real da
-- transicao de status — o evento so parecia certo quando OS nascia e mudava
-- de status no mesmo dia. `ocorrido_em` deve ser "o instante do fato no
-- modulo" (docs/modulos/central-operacional.md), que e exatamente o momento
-- em que este trigger dispara.
create or replace function public.central_evento_ordemservico()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant integer := public.central_operacional_tenant_id();
  v_tipo text;
  v_titulo text;
  v_prioridade text := 'INFO';
begin
  if new.is_deleted or new.migracao_referencia is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_tipo := 'OS_CRIADA';
    v_titulo := 'OS #' || new.id::text || ' criada';
  elsif old.status is distinct from new.status then
    case new.status::text
      when 'EM_ANDAMENTO' then
        v_tipo := 'OS_INICIO_EXECUCAO';
        v_titulo := 'OS #' || new.id::text || ' iniciou execucao';
      when 'PAGAMENTO' then
        v_tipo := 'OS_AGUARDANDO_PAGAMENTO';
        v_titulo := 'OS #' || new.id::text || ' aguarda pagamento';
      when 'CONCLUIDO' then
        v_tipo := 'OS_FINALIZADA';
        v_titulo := 'OS #' || new.id::text || ' finalizada';
      when 'CANCELADO' then
        v_tipo := 'OS_CANCELADA';
        v_titulo := 'OS #' || new.id::text || ' cancelada';
        v_prioridade := 'ATENCAO';
      else
        return new;
    end case;
  else
    return new;
  end if;

  perform public.central_emitir_evento_operacional(
    v_tenant,
    v_tipo,
    'ORDENS',
    'ORDEM_SERVICO',
    new.id::text,
    v_titulo,
    null,
    null,
    null,
    v_prioridade,
    jsonb_build_object('status', new.status::text),
    case when tg_op = 'INSERT'
      then 'OS_CRIADA:' || new.id::text
      else v_tipo || ':' || new.id::text || ':' || txid_current()::text
    end,
    now()
  );
  return new;
exception when others then
  raise warning '[central] evento de OS ignorado: %', sqlerrm;
  return new;
end;
$$;

commit;
