-- Exclusao de evento manual da OS: protecoes financeiras e estorno atomico do
-- consumo. Roda em transacao e nao preserva a massa criada.

begin;

do $test$
declare
  v_cliente_id integer;
  v_usuario_id uuid;
  v_os_id integer;
  v_produto_id integer;
  v_evento_id bigint;
  v_saida_id bigint;
  v_saldo_inicial integer;
  v_resultado jsonb;
  v_bloqueou boolean;
begin
  if to_regprocedure('public.excluir_evento_financeiro_manual_os(integer,bigint,text,uuid)') is null then
    raise exception 'excluir_evento_financeiro_manual_os nao foi criada';
  end if;
  if not exists (
    select 1
      from public.dre_mapeamento m
      join public.dre_linha l on l.id = m.linha_id
     where m.origem_tipo = 'EVENTO_ORIGEM'
       and m.origem_valor = 'FRETE:DESPESA'
       and l.codigo = '4.6'
  ) then
    raise exception 'FRETE:DESPESA nao foi mapeado na linha 4.6';
  end if;

  select id into v_cliente_id from public.cliente order by id limit 1;
  select id into v_usuario_id from public.usuario where ativo = true order by id limit 1;
  if v_cliente_id is null or v_usuario_id is null then
    raise exception 'O banco de teste precisa de cliente e usuario ativos.';
  end if;

  insert into public.produto (
    titulo, descricao, precovenda, precocompra, ultimovalordecompra, estoque, unidade
  ) values (
    'PRODUTO TESTE EXCLUSAO EVENTO', 'massa transacional', 30, 12, 12, 10, 'UN'
  ) returning id, estoque into v_produto_id, v_saldo_inicial;

  insert into public.ordemservico (
    clienteid, usuariocriadorid, status, descricao, orcamentototal, subtotal
  ) values (
    v_cliente_id, v_usuario_id, 'EM_ANDAMENTO', 'OS teste exclusao evento manual', 0, 0
  ) returning id into v_os_id;

  -- Consumo: saldo, saida e evento precisam mudar juntos.
  v_resultado := public.registrar_consumo_produto_os(jsonb_build_object(
    'ordemservicoid', v_os_id,
    'escopo', 'PRODUTO',
    'item_id', v_produto_id,
    'quantidade', 2,
    'descricao', 'Consumo a excluir',
    'created_by', v_usuario_id
  ));
  v_evento_id := (v_resultado->>'evento_id')::bigint;
  v_saida_id := (v_resultado->>'saida_id')::bigint;

  v_resultado := public.excluir_evento_financeiro_manual_os(
    v_os_id, v_evento_id, 'item nao utilizado', v_usuario_id
  );
  if coalesce((v_resultado->>'estoque_devolvido')::boolean, false) is not true then
    raise exception 'A funcao nao informou a devolucao do estoque';
  end if;
  if exists (select 1 from public.eventos_financeiros where id = v_evento_id) then
    raise exception 'O evento de consumo continuou existente';
  end if;
  if (select estoque from public.produto where id = v_produto_id) <> v_saldo_inicial then
    raise exception 'O saldo do produto nao voltou ao valor inicial';
  end if;
  if (select status from public.estoque_saida where id = v_saida_id) <> 'CANCELADA' then
    raise exception 'A saida nao permaneceu cancelada no historico';
  end if;
  if not exists (
    select 1
      from public.auditoria_evento
     where tabela = 'eventos_financeiros'
       and registro_id = v_evento_id::text
       and operacao = 'DELETE'
       and usuario_id = v_usuario_id
  ) then
    raise exception 'A exclusao do consumo nao foi atribuida ao usuario na auditoria';
  end if;

  -- Despesa manual de frete e excluivel sem tocar no valor da OS.
  insert into public.eventos_financeiros (
    ordemservicoid, origem, natureza, natureza_dre, chave_origem,
    descricao, valor, is_manual, pode_gerar_transacao, created_by
  ) values (
    v_os_id, 'FRETE', 'DESPESA', 'CUSTO', 'MANUAL:TESTE-FRETE',
    'Transportadora de teste', 25, true, true, v_usuario_id
  ) returning id into v_evento_id;
  perform public.excluir_evento_financeiro_manual_os(v_os_id, v_evento_id, null, v_usuario_id);
  if exists (select 1 from public.eventos_financeiros where id = v_evento_id) then
    raise exception 'A despesa manual de frete nao foi excluida';
  end if;
  if (select valor_frete from public.ordemservico where id = v_os_id) <> 0 then
    raise exception 'A exclusao da despesa alterou o frete cobrado na OS';
  end if;

  -- Receita de frete e comissao corrigida continuam automaticas/protegidas.
  insert into public.eventos_financeiros (
    ordemservicoid, origem, natureza, natureza_dre, chave_origem,
    descricao, valor, is_manual, pode_gerar_transacao, created_by
  ) values (
    v_os_id, 'FRETE', 'RECEITA', 'RECEITA', 'FRETE-TESTE-PROTEGIDO',
    'Receita de frete protegida', 40, false, false, v_usuario_id
  ) returning id into v_evento_id;
  v_bloqueou := false;
  begin
    perform public.excluir_evento_financeiro_manual_os(v_os_id, v_evento_id, null, v_usuario_id);
  exception when sqlstate 'P0001' then
    v_bloqueou := true;
  end;
  if not v_bloqueou or not exists (
    select 1 from public.eventos_financeiros where id = v_evento_id
  ) then
    raise exception 'A receita de frete nao ficou protegida';
  end if;

  insert into public.eventos_financeiros (
    ordemservicoid, origem, natureza, natureza_dre, chave_origem,
    descricao, valor, is_manual, pode_gerar_transacao, created_by
  ) values (
    v_os_id, 'COMISSAO', 'DESPESA', 'CUSTO', 'TESTE:COMISSAO',
    'Comissao corrigida', 10, true, true, v_usuario_id
  ) returning id into v_evento_id;
  v_bloqueou := false;
  begin
    perform public.excluir_evento_financeiro_manual_os(v_os_id, v_evento_id, null, v_usuario_id);
  exception when sqlstate 'P0001' then
    v_bloqueou := true;
  end;
  if not v_bloqueou or not exists (
    select 1 from public.eventos_financeiros where id = v_evento_id
  ) then
    raise exception 'A comissao corrigida a mao nao ficou protegida';
  end if;

  raise notice 'Exclusao manual, frete, comissao, auditoria e devolucao atomica de estoque validados.';
end;
$test$;

rollback;
