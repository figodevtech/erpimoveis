-- Consumo de produto direto na OS: baixa de estoque + despesa, e o ciclo de
-- vida da ordem em volta disso.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) registrar cria saida, movimento no razao e evento CONSUMO numa so vez;
--   2) o cancelamento pelo Estoque e recusado e aponta a OS;
--   3) o estorno pela OS devolve o saldo e encerra a despesa;
--   4) os tres estoques funcionam;
--   5) falha por saldo nao deixa evento orfao;
--   6) SEM_COBRANCA preserva o consumo como custo;
--   7) CANCELADO devolve o item, menos o consumo ja lancado no financeiro.
begin;

do $test$
declare
  v_cliente_id integer;
  v_usuario_id uuid;
  v_os_id integer;
  v_os2_id integer;
  v_os3_id integer;
  v_produto_id integer;
  v_item_uso integer;
  v_saldo_inicial integer;
  v_saldo integer;
  v_res jsonb;
  v_res2 jsonb;
  v_evento_id bigint;
  v_saida_id bigint;
  v_status text;
  v_total bigint;
  v_bloqueou boolean;
begin
  select id into v_cliente_id from public.cliente order by id limit 1;
  select id into v_usuario_id from public.usuario where ativo = true order by id limit 1;
  if v_cliente_id is null or v_usuario_id is null then
    raise exception 'O banco de teste precisa de cliente e usuario ativos.';
  end if;

  -- Pre-requisitos da migracao -----------------------------------------------
  if to_regprocedure('public.registrar_consumo_produto_os(jsonb)') is null then
    raise exception 'registrar_consumo_produto_os nao foi criada';
  end if;
  if not exists (
    select 1 from public.tipos_motivo_saida where codigo = 'CONSUMO_EM_OS' and ativo
  ) then
    raise exception 'O motivo CONSUMO_EM_OS nao foi semeado';
  end if;
  if not exists (
    select 1 from public.dre_mapeamento m
    join public.dre_linha l on l.id = m.linha_id
    where m.origem_tipo = 'EVENTO_ORIGEM' and m.origem_valor = 'CONSUMO:DESPESA'
      and l.codigo = '4.4'
  ) then
    raise exception 'CONSUMO:DESPESA nao foi mapeado na linha 4.4 da DRE';
  end if;

  -- Massa --------------------------------------------------------------------
  insert into public.produto (titulo, descricao, precovenda, precocompra, ultimovalordecompra, estoque, unidade)
  values ('DESENGRIPANTE DE TESTE', 'consumo em OS', 30, 12, 12, 10, 'UN')
  returning id into v_produto_id;

  select id into v_item_uso from public.criar_item_usoconsumo(
    jsonb_build_object('titulo', 'ESTOPA DE TESTE', 'escopo', 'USOCONSUMO', 'precocompra', 3),
    8, v_usuario_id
  );

  insert into public.ordemservico (clienteid, usuariocriadorid, status, descricao, orcamentototal, subtotal)
  values (v_cliente_id, v_usuario_id, 'EM_ANDAMENTO', 'OS de teste do consumo', 0, 0)
  returning id into v_os_id;

  -- -------------------------------------------------------------------------
  -- 1) Registro: uma chamada, tres efeitos
  -- -------------------------------------------------------------------------
  select estoque into v_saldo_inicial from public.produto where id = v_produto_id;

  v_res := public.registrar_consumo_produto_os(jsonb_build_object(
    'ordemservicoid', v_os_id, 'escopo', 'PRODUTO', 'item_id', v_produto_id,
    'quantidade', 2, 'descricao', 'Consumo - desengripante',
    'observacao', 'teste', 'pode_gerar_transacao', false, 'created_by', v_usuario_id
  ));
  v_evento_id := (v_res->>'evento_id')::bigint;
  v_saida_id  := (v_res->>'saida_id')::bigint;

  select estoque into v_saldo from public.produto where id = v_produto_id;
  if v_saldo <> v_saldo_inicial - 2 then
    raise exception 'O saldo devia cair 2, foi de % para %', v_saldo_inicial, v_saldo;
  end if;

  if not exists (
    select 1 from public.estoque_saida
    where id = v_saida_id and ordemservicoid = v_os_id
      and motivo = 'CONSUMO_EM_OS' and status = 'CONFIRMADA'
  ) then
    raise exception 'A saida nao ficou vinculada a OS com o motivo do consumo';
  end if;

  if not exists (
    select 1 from public.estoque_movimento
    where saida_id = v_saida_id and sentido = 'SAIDA'
      and origem = 'SAIDA_MANUAL' and acao = 'REGISTRO' and quantidade = 2
      and saldo_anterior = v_saldo_inicial and saldo_resultante = v_saldo_inicial - 2
  ) then
    raise exception 'O razao nao registrou a baixa do consumo';
  end if;

  if not exists (
    select 1 from public.eventos_financeiros
    where id = v_evento_id and ordemservicoid = v_os_id and origem = 'CONSUMO'
      and natureza = 'DESPESA' and natureza_dre = 'CUSTO' and status = 'ATIVO'
      and is_manual and pode_gerar_transacao = false
      and consumo_saida_id = v_saida_id and valor = 24.00
      and competencia_em is not null
  ) then
    raise exception 'O evento de consumo nao foi criado como esperado';
  end if;

  -- O historico mostra a OS, e a busca acha por ela.
  if not exists (
    select 1 from public.estoque_movimento_financeiro_historico
    where saida_id = v_saida_id and saida_ordemservicoid = v_os_id
      and busca like '%' || v_os_id::text || '%'
  ) then
    raise exception 'O historico de estoque nao expos a OS do consumo';
  end if;

  -- -------------------------------------------------------------------------
  -- 2) O cancelamento pelo Estoque e recusado
  -- -------------------------------------------------------------------------
  v_bloqueou := false;
  begin
    perform public.cancelar_saida_estoque(v_saida_id, 'tentativa pelo estoque', v_usuario_id);
  exception when sqlstate 'P0001' then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'A saida de consumo foi cancelada pelo Estoque, sem passar pela OS';
  end if;
  select estoque into v_saldo from public.produto where id = v_produto_id;
  if v_saldo <> v_saldo_inicial - 2 then
    raise exception 'A tentativa recusada mexeu no saldo';
  end if;

  -- -------------------------------------------------------------------------
  -- 3) O estorno pela OS devolve o saldo e encerra a despesa
  -- -------------------------------------------------------------------------
  perform public.cancelar_consumo_produto_os(v_evento_id, 'engano do operador', v_usuario_id);

  select estoque into v_saldo from public.produto where id = v_produto_id;
  if v_saldo <> v_saldo_inicial then
    raise exception 'O estorno nao devolveu o saldo: % (esperado %)', v_saldo, v_saldo_inicial;
  end if;
  select status into v_status from public.eventos_financeiros where id = v_evento_id;
  if v_status <> 'CANCELADO' then
    raise exception 'O evento continuou % apos o estorno', v_status;
  end if;
  select status into v_status from public.estoque_saida where id = v_saida_id;
  if v_status <> 'CANCELADA' then
    raise exception 'A saida continuou % apos o estorno', v_status;
  end if;
  if not exists (
    select 1 from public.estoque_movimento
    where saida_id = v_saida_id and acao = 'ESTORNO' and sentido = 'ENTRADA' and quantidade = 2
  ) then
    raise exception 'O razao nao registrou o estorno';
  end if;

  -- Estornar duas vezes nao passa.
  v_bloqueou := false;
  begin
    perform public.cancelar_consumo_produto_os(v_evento_id, 'de novo', v_usuario_id);
  exception when sqlstate 'P0001' then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'O mesmo consumo foi cancelado duas vezes';
  end if;

  -- -------------------------------------------------------------------------
  -- 4) Estoques simples: uso e consumo
  -- -------------------------------------------------------------------------
  v_res := public.registrar_consumo_produto_os(jsonb_build_object(
    'ordemservicoid', v_os_id, 'escopo', 'USOCONSUMO', 'item_id', v_item_uso,
    'quantidade', 3, 'descricao', 'Consumo - estopa', 'created_by', v_usuario_id
  ));
  select estoque into v_saldo from public.usoconsumo_item where id = v_item_uso;
  if v_saldo <> 5 then
    raise exception 'O item de uso e consumo ficou com saldo % (esperado 5)', v_saldo;
  end if;
  if not exists (
    select 1 from public.eventos_financeiros
    where id = (v_res->>'evento_id')::bigint
      and origem = 'CONSUMO' and produtoid is null
      and consumo_usoconsumo_saida_id = (v_res->>'saida_id')::bigint
      and valor = 9.00
  ) then
    raise exception 'O consumo de uso e consumo nao gerou o evento correto';
  end if;
  -- Aqui tambem o Estoque nao cancela.
  v_bloqueou := false;
  begin
    perform public.cancelar_saida_usoconsumo((v_res->>'saida_id')::bigint, 'pelo estoque', v_usuario_id);
  exception when sqlstate 'P0001' then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'A saida de uso e consumo foi cancelada fora da OS';
  end if;

  -- -------------------------------------------------------------------------
  -- 5) Saldo insuficiente nao deixa evento orfao
  -- -------------------------------------------------------------------------
  select count(*) into v_total from public.eventos_financeiros where origem = 'CONSUMO';
  v_bloqueou := false;
  begin
    perform public.registrar_consumo_produto_os(jsonb_build_object(
      'ordemservicoid', v_os_id, 'escopo', 'PRODUTO', 'item_id', v_produto_id,
      'quantidade', 9999, 'descricao', 'Consumo impossivel', 'created_by', v_usuario_id
    ));
  exception when sqlstate '23514' then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'O consumo passou com saldo insuficiente';
  end if;
  if (select count(*) from public.eventos_financeiros where origem = 'CONSUMO') <> v_total then
    raise exception 'A falha por saldo deixou evento orfao';
  end if;

  -- -------------------------------------------------------------------------
  -- 6) SEM_COBRANCA preserva o consumo como custo
  --
  -- E o caso que 20260806250000 descreve: some a receita, sobram as despesas,
  -- "o custo da peca, que foi consumida de verdade".
  -- -------------------------------------------------------------------------
  insert into public.ordemservico (clienteid, usuariocriadorid, status, descricao, orcamentototal, subtotal)
  values (v_cliente_id, v_usuario_id, 'EM_ANDAMENTO', 'OS sem cobranca de teste', 0, 0)
  returning id into v_os2_id;

  v_res := public.registrar_consumo_produto_os(jsonb_build_object(
    'ordemservicoid', v_os2_id, 'escopo', 'PRODUTO', 'item_id', v_produto_id,
    'quantidade', 1, 'descricao', 'Consumo - sem cobranca', 'created_by', v_usuario_id
  ));
  v_evento_id := (v_res->>'evento_id')::bigint;
  select estoque into v_saldo from public.produto where id = v_produto_id;

  update public.ordemservico set status = 'SEM_COBRANCA' where id = v_os2_id;

  if (select status from public.eventos_financeiros where id = v_evento_id) <> 'ATIVO' then
    raise exception 'SEM_COBRANCA cancelou o consumo, que e custo real da OS';
  end if;
  if (select estoque from public.produto where id = v_produto_id) <> v_saldo then
    raise exception 'SEM_COBRANCA devolveu o material ao estoque';
  end if;
  -- Ja finalizada: o estorno passa a exigir reabrir a OS.
  v_bloqueou := false;
  begin
    perform public.cancelar_consumo_produto_os(v_evento_id, 'tarde demais', v_usuario_id);
  exception when sqlstate 'P0001' then
    v_bloqueou := true;
  end;
  if not v_bloqueou then
    raise exception 'O consumo foi cancelado com a OS ja finalizada';
  end if;

  -- -------------------------------------------------------------------------
  -- 7) CANCELADO devolve o material; o consumo com transacao vinculada fica
  -- -------------------------------------------------------------------------
  insert into public.ordemservico (clienteid, usuariocriadorid, status, descricao, orcamentototal, subtotal)
  values (v_cliente_id, v_usuario_id, 'EM_ANDAMENTO', 'OS cancelada de teste', 0, 0)
  returning id into v_os3_id;

  -- (a) consumo comum, que deve voltar
  v_res := public.registrar_consumo_produto_os(jsonb_build_object(
    'ordemservicoid', v_os3_id, 'escopo', 'PRODUTO', 'item_id', v_produto_id,
    'quantidade', 2, 'descricao', 'Consumo que volta', 'created_by', v_usuario_id
  ));
  v_saida_id := (v_res->>'saida_id')::bigint;

  -- (b) consumo ja lancado, que deve permanecer fora do estoque
  v_res2 := public.registrar_consumo_produto_os(jsonb_build_object(
    'ordemservicoid', v_os3_id, 'escopo', 'PRODUTO', 'item_id', v_produto_id,
    'quantidade', 1, 'descricao', 'Consumo ja pago', 'pode_gerar_transacao', true,
    'created_by', v_usuario_id
  ));
  update public.eventos_financeiros
     set status = 'CONVERTIDO'
   where id = (v_res2->>'evento_id')::bigint;

  select estoque into v_saldo from public.produto where id = v_produto_id;

  update public.ordemservico set status = 'CANCELADO' where id = v_os3_id;

  if (select estoque from public.produto where id = v_produto_id) <> v_saldo + 2 then
    raise exception 'O cancelamento da OS nao devolveu exatamente o consumo estornavel';
  end if;
  if (select status from public.estoque_saida where id = v_saida_id) <> 'CANCELADA' then
    raise exception 'A saida do consumo estornavel continuou confirmada';
  end if;
  if (select status from public.estoque_saida where id = (v_res2->>'saida_id')::bigint) <> 'CONFIRMADA' then
    raise exception 'O consumo ja lancado no financeiro foi estornado junto';
  end if;

  raise notice 'Consumo na OS: registro, razao, historico, portao do estoque, estorno manual, SEM_COBRANCA, CANCELADO e consumo lancado validados.';
end;
$test$;

rollback;
