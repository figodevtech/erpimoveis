-- A taxa de comissao acompanha o cadastro ate a execucao encerrar.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) mudar a taxa do usuario e mexer na OS em andamento traz a taxa nova;
--   2) entrar em PAGAMENTO congela com a taxa do dia da entrega;
--   3) depois de congelado, mudar a taxa nao mexe mais no valor;
--   4) reabrir a OS volta a acompanhar o cadastro;
--   5) servico sem comissao continua carimbando zero.
begin;

do $test$
declare
  v_cliente_id integer;
  v_usuario uuid;
  v_servico_id integer;
  v_servico_sem integer;
  v_os_id integer;
  v_pct numeric;
  v_comissao numeric;
begin
  select id into v_cliente_id from public.cliente order by id limit 1;
  select id into v_usuario from public.usuario where ativo order by id limit 1;
  if v_cliente_id is null or v_usuario is null then
    raise exception 'O banco de teste precisa de cliente e usuario ativos.';
  end if;

  if to_regprocedure('public.recarimbar_comissao_osservico(integer,integer)') is null then
    raise exception 'recarimbar_comissao_osservico nao foi criada';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'ordemservico' and t.tgname = 'trg_congelar_comissao_ao_encerrar_execucao'
  ) then
    raise exception 'o gatilho de congelamento nao foi criado';
  end if;

  update public.usuario set comissao_percent = 5 where id = v_usuario;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-TAXA-' || floor(random() * 1000000)::text, 'SERVICO DE TESTE TAXA', 1000, true)
  returning id into v_servico_id;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-SEM-' || floor(random() * 1000000)::text, 'SERVICO SEM COMISSAO', 500, false)
  returning id into v_servico_sem;

  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (v_cliente_id, v_usuario, 'ORCAMENTO_APROVADO', 1500, 0)
  returning id into v_os_id;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_id, 1, 1000, 1000), (v_os_id, v_servico_sem, 1, 500, 500);

  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os_id, v_servico_id, v_usuario), (v_os_id, v_servico_sem, v_usuario);

  -- Carimbo inicial: 5% no que comissiona, zero no que nao comissiona.
  select comissao_percent_aplicada into v_pct from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id;
  if v_pct <> 5 then
    raise exception 'Carimbo inicial deveria ser 5, veio %', v_pct;
  end if;

  select comissao_percent_aplicada into v_pct from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_sem;
  if v_pct <> 0 then
    raise exception 'Servico sem comissao deveria carimbar 0, veio %', v_pct;
  end if;

  -- A OS entra em execucao.
  update public.ordemservico set status = 'EM_ANDAMENTO' where id = v_os_id;

  -- 1) A taxa sobe no meio do caminho e algo mexe na OS -----------------------
  update public.usuario set comissao_percent = 10 where id = v_usuario;
  perform public.recalcular_comissao_osservico(v_os_id, v_servico_id);

  select comissao_percent_aplicada, valor_comissao into v_pct, v_comissao
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id;
  if v_pct <> 10 then
    raise exception 'Com a execucao aberta o carimbo deveria virar 10, veio %', v_pct;
  end if;
  if v_comissao <> 100 then
    raise exception 'Comissao deveria ser 100 (10%% de 1000), veio %', v_comissao;
  end if;

  -- 5) Servico sem comissao continua zerado, mesmo com o cadastro a 10%.
  select comissao_percent_aplicada, valor_comissao into v_pct, v_comissao
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_sem;
  if v_pct <> 0 or v_comissao <> 0 then
    raise exception 'Servico sem comissao deveria seguir zerado, veio %%% e %', v_pct, v_comissao;
  end if;

  -- 2) A taxa sobe de novo e a OS e entregue sem ninguem mexer nela ----------
  update public.usuario set comissao_percent = 12 where id = v_usuario;
  update public.ordemservico set status = 'PAGAMENTO' where id = v_os_id;

  select comissao_percent_aplicada, valor_comissao into v_pct, v_comissao
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id;
  if v_pct <> 12 then
    raise exception 'Ao encerrar, o carimbo deveria virar 12 (taxa do dia da entrega), veio %', v_pct;
  end if;
  if v_comissao <> 120 then
    raise exception 'Comissao congelada deveria ser 120, veio %', v_comissao;
  end if;

  -- 3) Depois de congelado, o cadastro nao alcanca mais -----------------------
  update public.usuario set comissao_percent = 30 where id = v_usuario;
  perform public.recalcular_comissao_osservico(v_os_id, v_servico_id);

  select comissao_percent_aplicada, valor_comissao into v_pct, v_comissao
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id;
  if v_pct <> 12 or v_comissao <> 120 then
    raise exception 'Execucao encerrada nao deveria acompanhar o cadastro, veio %%% e %', v_pct, v_comissao;
  end if;

  -- 4) Reabrir a OS volta a acompanhar ---------------------------------------
  update public.ordemservico set status = 'EM_ANDAMENTO' where id = v_os_id;
  perform public.recalcular_comissao_osservico(v_os_id, v_servico_id);

  select comissao_percent_aplicada, valor_comissao into v_pct, v_comissao
    from public.osservico_realizador
   where ordemservicoid = v_os_id and servicoid = v_servico_id;
  if v_pct <> 30 or v_comissao <> 300 then
    raise exception 'OS reaberta deveria voltar a acompanhar o cadastro, veio %%% e %', v_pct, v_comissao;
  end if;

  raise notice 'OK: a taxa acompanha ate a entrega e congela depois dela.';
end;
$test$;

rollback;
