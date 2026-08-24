begin;

do $test$
declare
  v_cliente_id integer;
  v_usuario_id uuid;
  v_os_id integer;
  v_bloqueou boolean := false;
begin
  select id into v_cliente_id from public.cliente order by id limit 1;
  select id into v_usuario_id from public.usuario where ativo = true order by id limit 1;
  if v_cliente_id is null or v_usuario_id is null then
    raise exception 'O banco de teste precisa de cliente e usuario ativos.';
  end if;

  insert into public.ordemservico (
    clienteid, usuariocriadorid, status, statusaprovacao, descricao,
    orcamentototal, subtotal, valor_frete, migracao_referencia, veiculo_snapshot,
    dataentrada, datasaida, pagamento_concluido_em, finalizado_em
  ) values (
    v_cliente_id, v_usuario_id, 'CONCLUIDO', 'APROVADA', 'OS historica de teste',
    0, 0, 0, 'TESTE_OS_HISTORICA:1', '{"placa":"ABC1D23","modelo":"TESTE"}'::jsonb,
    now(), now(), now(), now()
  ) returning id into v_os_id;

  if exists (
    select 1 from public.os_notificacao_evento where ordemservico_id = v_os_id
  ) then
    raise exception 'A OS historica gerou notificacao.';
  end if;

  begin
    update public.ordemservico set descricao = 'alterada' where id = v_os_id;
  exception when sqlstate '55000' then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'A OS historica aceitou alteracao.';
  end if;

  v_bloqueou := false;
  begin
    insert into public.pagamento (ordemservicoid, metodo, valor)
    values (v_os_id, 'DINHEIRO', 1);
  exception when sqlstate '55000' then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'A OS historica aceitou pagamento.';
  end if;

  v_bloqueou := false;
  begin
    insert into public.ordemservico (
      clienteid, usuariocriadorid, status, descricao, orcamentototal,
      subtotal, valor_frete, migracao_referencia, veiculo_snapshot
    ) values (
      v_cliente_id, v_usuario_id, 'CONCLUIDO', 'invalida', 1,
      0, 0, 'TESTE_OS_HISTORICA:INVALIDA', '{"placa":"ABC1D23"}'::jsonb
    );
  exception when check_violation then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'A constraint aceitou valor financeiro na OS historica.';
  end if;

  raise notice 'OS historica: snapshot, somente leitura, sem notificacao e sem pagamento validados.';
end;
$test$;

rollback;
