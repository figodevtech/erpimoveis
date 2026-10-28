begin;

do $test$
declare
  v_usuario_id uuid;
  v_veiculo_id integer;
  v_os_id integer;
  v_bloqueou boolean;
  v_data timestamptz := '2026-01-02 12:05:19-03';
begin
  select id into v_usuario_id from public.usuario where ativo = true order by id limit 1;
  if v_usuario_id is null then
    raise exception 'O banco de teste precisa de um usuario ativo.';
  end if;

  -- IDs explicitos: a sequencia de OS nao volta no ROLLBACK e cada teste
  -- gastaria numeros reais do cliente.
  insert into public.ordemservico (
    id, clienteid, cliente_snapshot, usuariocriadorid, status, statusaprovacao, descricao,
    subtotal, desconto_tipo, desconto, orcamentototal, valor_frete,
    migracao_referencia, veiculoid, veiculo_snapshot,
    dataentrada, datasaida, pagamento_concluido_em, finalizado_em
  ) overriding system value values (
    2000000001, null, '{"nome":"CLIENTE LEGADO DE TESTE"}'::jsonb, v_usuario_id, 'CONCLUIDO', 'APROVADA', 'OS historica sem veiculo',
    100, 'FIXO', 10, 90, 0,
    'TESTE_OS_SEM_VEICULO:1', null, null,
    v_data, v_data, v_data, v_data
  ) returning id into v_os_id;

  if exists (select 1 from public.os_notificacao_evento where ordemservico_id = v_os_id) then
    raise exception 'A OS historica sem veiculo gerou notificacao.';
  end if;

  insert into public.ositem_historico (
    ordemservicoid, origem, linha_origem, tipo, codigo_legado, descricao,
    quantidade, preco_unitario, subtotal
  ) values (
    v_os_id, 'TESTE_SEM_CODIGO', 2, 'PRODUTO', null, 'FILTRO DE OLEO',
    2, 50, 100
  );

  v_bloqueou := false;
  begin
    insert into public.ositem_historico (
      ordemservicoid, origem, linha_origem, tipo, codigo_legado, descricao,
      quantidade, preco_unitario, subtotal
    ) values (
      v_os_id, 'TESTE_SEM_CODIGO', 3, 'SERVICO', '  ', 'MAO DE OBRA',
      1, 50, 50
    );
  exception when check_violation then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'O item historico aceitou codigo legado vazio.';
  end if;

  v_bloqueou := false;
  begin
    insert into public.ordemservico (
      id, cliente_snapshot, usuariocriadorid, status, statusaprovacao, descricao,
      subtotal, orcamentototal, valor_frete, migracao_referencia, veiculo_snapshot,
      dataentrada, datasaida, pagamento_concluido_em, finalizado_em
    ) overriding system value values (
      2000000002, '{"nome":"CLIENTE LEGADO DE TESTE"}'::jsonb, v_usuario_id, 'CONCLUIDO', 'APROVADA', 'placa vazia',
      0, 0, 0, 'TESTE_OS_SEM_VEICULO:PLACA_VAZIA', '{"placa":" ","modelo":"TESTE"}'::jsonb,
      v_data, v_data, v_data, v_data
    );
  exception when check_violation then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'A OS historica aceitou snapshot de veiculo sem placa.';
  end if;

  select id into v_veiculo_id from public.veiculo order by id limit 1;
  if v_veiculo_id is null then
    raise notice 'Sem veiculo cadastrado: caso de veiculoid sem snapshot nao verificado.';
  else
    v_bloqueou := false;
    begin
      insert into public.ordemservico (
        id, cliente_snapshot, usuariocriadorid, status, statusaprovacao, descricao,
        subtotal, orcamentototal, valor_frete, migracao_referencia, veiculoid, veiculo_snapshot,
        dataentrada, datasaida, pagamento_concluido_em, finalizado_em
      ) overriding system value values (
        2000000003, '{"nome":"CLIENTE LEGADO DE TESTE"}'::jsonb, v_usuario_id, 'CONCLUIDO', 'APROVADA', 'veiculo sem snapshot',
        0, 0, 0, 'TESTE_OS_SEM_VEICULO:SEM_SNAPSHOT', v_veiculo_id, null,
        v_data, v_data, v_data, v_data
      );
    exception when check_violation then
      v_bloqueou := true;
    end;
    if not v_bloqueou then
      raise exception 'A OS historica aceitou veiculo vinculado sem snapshot.';
    end if;
  end if;

  v_bloqueou := false;
  begin
    update public.ordemservico set descricao = 'alterada' where id = v_os_id;
  exception when sqlstate '55000' then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'A OS historica sem veiculo aceitou alteracao.';
  end if;

  raise notice 'OS historica sem veiculo e item sem codigo aceitos; placa vazia, codigo vazio e veiculo sem snapshot recusados.';
end;
$test$;

rollback;
