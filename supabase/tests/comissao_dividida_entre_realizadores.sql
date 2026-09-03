-- Comissao de servico dividido entre realizadores.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado, no exemplo
-- de um servico de R$ 1.000 com dois realizadores, um a 10% e outro a 5%:
--   1) o snapshot adota o MAIOR percentual e divide a base por N -> R$ 50 cada;
--   2) a reconciliacao lanca DOIS eventos de comissao, um por pessoa;
--   3) percentual_snapshot x valor_base_snapshot = valor, em ambas as linhas;
--   4) o detalhe explica a taxa aplicada, a divisao e a taxa propria;
--   5) com N = 3 a base divide por 3 e o texto acompanha;
--   6) sair o realizador de taxa maior nao deixa o outro herdando a taxa dele.
begin;

do $test$
declare
  v_cliente_id integer;
  v_usuario_a uuid;
  v_usuario_b uuid;
  v_usuario_c uuid;
  v_servico_id integer;
  v_os_id integer;
  v_base numeric;
  v_comissao numeric;
  v_pct numeric;
  v_detalhe text;
  v_qtd integer;
begin
  select id into v_cliente_id from public.cliente order by id limit 1;
  if v_cliente_id is null then
    raise exception 'O banco de teste precisa de ao menos um cliente.';
  end if;

  if to_regprocedure('public.formatar_percentual_comissao(numeric)') is null then
    raise exception 'formatar_percentual_comissao nao foi criada';
  end if;

  -- Massa. `usuario` tem FK para o auth, entao o teste nao cria gente: pega
  -- tres ativos e carimba a taxa que interessa. Tudo volta no rollback, e o
  -- gatilho le `comissao_percent` no INSERT do vinculo, depois deste update.
  select id into v_usuario_a from public.usuario where ativo order by id limit 1;
  select id into v_usuario_b from public.usuario where ativo and id <> v_usuario_a order by id limit 1;
  select id into v_usuario_c from public.usuario
   where ativo and id not in (v_usuario_a, v_usuario_b) order by id limit 1;

  if v_usuario_c is null then
    raise exception 'O banco de teste precisa de ao menos tres usuarios ativos.';
  end if;

  update public.usuario set comissao_percent = 10 where id = v_usuario_a;
  update public.usuario set comissao_percent = 5 where id = v_usuario_b;
  update public.usuario set comissao_percent = 8 where id = v_usuario_c;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-COMISSAO-' || floor(random() * 1000000)::text, 'SERVICO DE TESTE COMISSAO', 1000, true)
  returning id into v_servico_id;

  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (v_cliente_id, v_usuario_a, 'EM_ANDAMENTO', 1000, 0)
  returning id into v_os_id;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_id, 1, 1000, 1000);

  -- 1) Dois realizadores: maior percentual sobre a base dividida -------------
  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os_id, v_servico_id, v_usuario_a), (v_os_id, v_servico_id, v_usuario_b);

  select valor_base, valor_comissao, comissao_percent_efetiva
    into v_base, v_comissao, v_pct
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id and usuarioid = v_usuario_b;

  if v_base <> 500 then
    raise exception 'Base do realizador B deveria ser 500 (1000 / 2), veio %', v_base;
  end if;
  if v_pct <> 10 then
    raise exception 'Percentual efetivo deveria ser 10 (o maior), veio %', v_pct;
  end if;
  if v_comissao <> 50 then
    raise exception 'Comissao do realizador B deveria ser 50, veio %', v_comissao;
  end if;

  select valor_comissao into v_comissao
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id and usuarioid = v_usuario_a;
  if v_comissao <> 50 then
    raise exception 'Comissao do realizador A deveria ser 50, veio %', v_comissao;
  end if;

  -- 2) Reconciliacao lanca um evento por pessoa ------------------------------
  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);

  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO';
  if v_qtd <> 2 then
    raise exception 'Deveriam existir 2 eventos de comissao, existem %', v_qtd;
  end if;

  -- 3) A conta do evento fecha nas duas linhas -------------------------------
  if exists (
    select 1 from public.eventos_financeiros
     where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO'
       and round(valor_base_snapshot * percentual_snapshot / 100.0, 2) <> valor
  ) then
    raise exception 'Ha evento de comissao onde base x percentual nao da o valor';
  end if;

  -- 4) O detalhe explica a divisao e a taxa propria ---------------------------
  select detalhe, valor, percentual_snapshot
    into v_detalhe, v_comissao, v_pct
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO'
     and usuarioid = v_usuario_b;

  if v_comissao <> 50 or v_pct <> 10 then
    raise exception 'Evento do realizador B: esperado 50 a 10 por cento, veio % a %', v_comissao, v_pct;
  end if;
  if v_detalhe not like '%(maior entre 2 realizadores) sobre 1/2 do servi_o%' then
    raise exception 'Detalhe do realizador B nao explica a divisao: %', v_detalhe;
  end if;
  if v_detalhe not like '%taxa pr_pria 5%' then
    raise exception 'Detalhe do realizador B nao cita a taxa propria: %', v_detalhe;
  end if;

  -- Quem tem a taxa maior nao ganha o sufixo de taxa propria, que seria ruido.
  select detalhe into v_detalhe
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO'
     and usuarioid = v_usuario_a;
  if v_detalhe like '%taxa pr_pria%' then
    raise exception 'Detalhe do realizador A nao deveria citar taxa propria: %', v_detalhe;
  end if;

  -- 5) Entrando o terceiro, a base divide por 3 -------------------------------
  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os_id, v_servico_id, v_usuario_c);

  select valor_base, valor_comissao into v_base, v_comissao
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id and usuarioid = v_usuario_c;
  if round(v_base, 2) <> 333.33 then
    raise exception 'Base com 3 realizadores deveria ser 333.33, veio %', v_base;
  end if;
  if round(v_comissao, 2) <> 33.33 then
    raise exception 'Comissao com 3 realizadores deveria ser 33.33, veio %', v_comissao;
  end if;

  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);

  select detalhe into v_detalhe
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO'
     and usuarioid = v_usuario_c;
  if v_detalhe not like '%sobre 1/3 do servi_o%' then
    raise exception 'Detalhe com 3 realizadores nao acompanhou a divisao: %', v_detalhe;
  end if;
  if v_detalhe not like '%taxa pr_pria 8%' then
    raise exception 'Detalhe do realizador C nao cita a taxa propria: %', v_detalhe;
  end if;

  -- 6) Saindo quem tem a taxa maior, ninguem herda os 10% ---------------------
  delete from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id and usuarioid = v_usuario_a;

  select comissao_percent_efetiva, valor_base, valor_comissao
    into v_pct, v_base, v_comissao
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id and usuarioid = v_usuario_b;

  if v_pct <> 8 then
    raise exception 'Sem o realizador A, o maior passa a ser 8, veio %', v_pct;
  end if;
  if round(v_base, 2) <> 500 or round(v_comissao, 2) <> 40 then
    raise exception 'Com 2 realizadores a 8 por cento: esperado base 500 e comissao 40, veio % e %', v_base, v_comissao;
  end if;

  -- A reconciliacao encerra o evento de quem saiu.
  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);

  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO';
  if v_qtd <> 2 then
    raise exception 'Apos a saida deveriam sobrar 2 eventos ativos, existem %', v_qtd;
  end if;

  raise notice 'OK: comissao dividida entre realizadores, eventos e textos conferidos.';
end;
$test$;

rollback;
