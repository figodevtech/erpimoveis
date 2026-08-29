begin;

do $$
declare
  v_tenant integer;
  v_primeiro uuid;
  v_repetido uuid;
  v_usuario uuid;
  v_topico text;
begin
  if to_regclass('public.central_evento_operacional') is null then
    raise exception 'Tabela central_evento_operacional nao foi criada';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.central_evento_operacional'::regclass) then
    raise exception 'RLS nao foi habilitada no log operacional';
  end if;

  if has_table_privilege('authenticated', 'public.central_evento_operacional', 'SELECT')
     or has_table_privilege('anon', 'public.central_evento_operacional', 'SELECT') then
    raise exception 'Log operacional ficou legivel diretamente pelo navegador';
  end if;

  if (
    select count(*)
    from pg_trigger
    where not tgisinternal
      and tgname in (
        'central_evento_ordemservico_trg',
        'central_evento_venda_trg',
        'central_evento_transacao_trg',
        'central_evento_produto_estoque_trg',
        'central_evento_nfe_trg',
        'central_evento_nfse_trg'
      )
  ) <> 6 then
    raise exception 'Nem todos os seis gatilhos operacionais foram instalados';
  end if;

  v_tenant := public.central_operacional_tenant_id();
  if v_tenant is null then
    raise exception 'Tenant da instalacao nao foi resolvido';
  end if;
  v_topico := 'operational:tenant:' || v_tenant::text;

  v_primeiro := public.central_emitir_evento_operacional(
    v_tenant,
    'OS_CRIADA',
    'ORDENS',
    'ORDEM_SERVICO',
    'central-test',
    'Evento de teste',
    null,
    null,
    null,
    'INFO',
    '{}'::jsonb,
    'CENTRAL_TESTE_IDEMPOTENTE',
    now()
  );
  v_repetido := public.central_emitir_evento_operacional(
    v_tenant,
    'OS_CRIADA',
    'ORDENS',
    'ORDEM_SERVICO',
    'central-test',
    'Evento de teste repetido',
    null,
    null,
    null,
    'INFO',
    '{}'::jsonb,
    'CENTRAL_TESTE_IDEMPOTENTE',
    now()
  );

  if v_primeiro is null or v_repetido is not null then
    raise exception 'Contrato de retorno idempotente invalido';
  end if;
  if (
    select count(*)
    from public.central_evento_operacional
    where tenant_id = v_tenant and event_key = 'CENTRAL_TESTE_IDEMPOTENTE'
  ) <> 1 then
    raise exception 'event_key nao impediu evento duplicado';
  end if;

  if public.central_emitir_evento_operacional(
    null, 'OS_CRIADA', 'ORDENS', 'ORDEM_SERVICO', null, 'Sem tenant', null,
    null, null, 'INFO', '{}'::jsonb, 'CENTRAL_TESTE_SEM_TENANT', now()
  ) is not null then
    raise exception 'Evento sem tenant foi aceito';
  end if;

  -- Forca a primeira compilacao dos seis corpos PL/pgSQL sem alterar os dados.
  update public.ordemservico set status = status where id = (select id from public.ordemservico limit 1);
  update public.venda set status = status where id = (select id from public.venda limit 1);
  update public.transacao set pendente = pendente where id = (select id from public.transacao limit 1);
  update public.produto set estoque = estoque where id = (select id from public.produto limit 1);
  update public.nfe set status = status where id = (select id from public.nfe limit 1);
  update public.nfse set status = status where id = (select id from public.nfse limit 1);

  select u.id into v_usuario
  from public.usuario u
  where u.ativo = true
    and (
      coalesce(u.is_root, false)
      or exists (
        select 1
        from public.perfilpermissao pp
        join public.permissao p on p.id = pp.permissaoid
        where pp.perfilid = u.perfilid
          and upper(trim(p.nome)) = upper('acompanhamento:visualizar')
      )
    )
  limit 1;

  if v_usuario is null then
    raise exception 'Nao existe usuario apto para validar o topico privado';
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_usuario, 'role', 'authenticated')::text,
    true
  );
  if not public.central_realtime_topic_allowed(v_topico) then
    raise exception 'Topico privado da instalacao foi recusado';
  end if;
  if public.central_realtime_topic_allowed(v_topico || ':outro') then
    raise exception 'Topico fora do tenant foi autorizado';
  end if;

  raise notice 'Central Operacional: DDL, RLS, triggers, idempotencia e topico privado validados.';
end;
$$;

rollback;
