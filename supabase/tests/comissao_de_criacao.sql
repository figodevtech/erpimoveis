-- Comissao paga a quem criou a OS.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado, numa OS com
-- um servico de R$ 1.000 e um produto de R$ 500, criada por quem recebe 1% dos
-- servicos e 0,5% dos produtos:
--   1) o snapshot nasce com base bruta e paga R$ 10 + R$ 2,50 = R$ 12,50;
--   2) a reconciliacao lanca UM evento COMISSAO com chave CRIACAO:<uuid>,
--      convivendo com o da realizacao sem colidir;
--   3) com 10% de desconto na OS a base encolhe junto — mesmo fator da
--      comissao de realizacao — e o detalhe diz isso;
--   4) criador sem percentual nenhum: nao ha linha nem evento;
--   5) `somente_comissionaveis` tira da base o servico com gera_comissao=false;
--   6) encerrada a execucao, mexer no cadastro nao move o valor apurado.
begin;

do $test$
declare
  v_cliente_id integer;
  v_criador uuid;
  v_realizador uuid;
  v_servico_id integer;
  v_servico_sem_comissao integer;
  v_produto_id integer;
  v_os_id integer;
  v_valor numeric;
  v_base_s numeric;
  v_base_p numeric;
  v_detalhe text;
  v_qtd integer;
begin
  select id into v_cliente_id from public.cliente order by id limit 1;
  if v_cliente_id is null then
    raise exception 'O banco de teste precisa de ao menos um cliente.';
  end if;

  if to_regprocedure('public.recalcular_comissao_criacao_os(integer)') is null then
    raise exception 'recalcular_comissao_criacao_os nao foi criada';
  end if;

  -- `usuario` tem FK para o auth, entao o teste nao cria gente: pega dois
  -- ativos e carimba as taxas. Tudo volta no rollback.
  select id into v_criador from public.usuario where ativo order by id limit 1;
  select id into v_realizador from public.usuario
   where ativo and id <> v_criador order by id limit 1;
  if v_realizador is null then
    raise exception 'O banco de teste precisa de ao menos dois usuarios ativos.';
  end if;

  update public.usuario
     set comissao_criacao_servico_percent = 1,
         comissao_criacao_produto_percent = 0.5,
         comissao_criacao_somente_comissionaveis = false
   where id = v_criador;
  update public.usuario set comissao_percent = 5 where id = v_realizador;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-CRIACAO-' || floor(random() * 1000000)::text, 'SERVICO CRIACAO', 1000, true)
  returning id into v_servico_id;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-CRIACAO-SC-' || floor(random() * 1000000)::text, 'SERVICO SEM COMISSAO', 400, false)
  returning id into v_servico_sem_comissao;

  select id into v_produto_id from public.produto order by id limit 1;
  if v_produto_id is null then
    raise exception 'O banco de teste precisa de ao menos um produto.';
  end if;

  -- Total = 1500 e frete 0: fator 1, base bruta.
  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (v_cliente_id, v_criador, 'EM_ANDAMENTO', 1500, 0)
  returning id into v_os_id;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_id, 1, 1000, 1000);

  insert into public.osproduto (ordemservicoid, produtoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_produto_id, 1, 500, 500);

  -- 1) O snapshot ------------------------------------------------------------
  select base_servicos, base_produtos, valor_comissao
    into v_base_s, v_base_p, v_valor
    from public.os_comissao_criacao where ordemservicoid = v_os_id;

  if v_base_s is null then
    raise exception 'A comissao de criacao nao foi apurada para a OS %', v_os_id;
  end if;
  if v_base_s <> 1000 or v_base_p <> 500 then
    raise exception 'Bases deveriam ser 1000/500, vieram %/%', v_base_s, v_base_p;
  end if;
  if v_valor <> 12.50 then
    raise exception 'Comissao de criacao deveria ser 12.50, veio %', v_valor;
  end if;

  -- 2) Um evento, com chave propria, ao lado do da realizacao ----------------
  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os_id, v_servico_id, v_realizador);

  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);

  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO'
     and chave_origem = 'CRIACAO:' || v_criador;
  if v_qtd <> 1 then
    raise exception 'Deveria existir 1 evento de comissao de criacao, existem %', v_qtd;
  end if;

  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO';
  if v_qtd <> 2 then
    raise exception 'Criacao e realizacao deveriam coexistir (2 eventos), existem %', v_qtd;
  end if;

  select valor, valor_base_snapshot into v_valor, v_base_s
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and chave_origem = 'CRIACAO:' || v_criador;
  if v_valor <> 12.50 then
    raise exception 'Evento de criacao deveria valer 12.50, veio %', v_valor;
  end if;
  if v_base_s <> 1500 then
    raise exception 'A base do evento deveria ser 1500 (servicos + produtos), veio %', v_base_s;
  end if;

  -- 3) Desconto da OS encolhe a base, e o detalhe diz isso -------------------
  update public.ordemservico set orcamentototal = 1350 where id = v_os_id;

  select base_servicos, base_produtos, valor_comissao
    into v_base_s, v_base_p, v_valor
    from public.os_comissao_criacao where ordemservicoid = v_os_id;

  if v_base_s <> 900 or v_base_p <> 450 then
    raise exception 'Com 10%% de desconto as bases deveriam ser 900/450, vieram %/%',
      v_base_s, v_base_p;
  end if;
  if v_valor <> 11.25 then
    raise exception 'Com desconto a comissao deveria ser 11.25, veio %', v_valor;
  end if;

  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);
  select detalhe into v_detalhe
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and chave_origem = 'CRIACAO:' || v_criador;
  if v_detalhe not like '%desconto da OS%' then
    raise exception 'O detalhe deveria mencionar o desconto da OS, veio "%"', v_detalhe;
  end if;

  -- 5) A flag tira o servico nao comissionavel da base -----------------------
  -- (antes do 4 de proposito: o 4 desliga o beneficio e apaga a linha)
  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_sem_comissao, 1, 400, 400);
  update public.ordemservico set orcamentototal = 1900 where id = v_os_id;

  select base_servicos into v_base_s
    from public.os_comissao_criacao where ordemservicoid = v_os_id;
  if v_base_s <> 1400 then
    raise exception 'Sem a flag, os dois servicos entram (1400), veio %', v_base_s;
  end if;

  update public.usuario set comissao_criacao_somente_comissionaveis = true where id = v_criador;
  perform public.recalcular_comissao_criacao_os(v_os_id);

  select base_servicos into v_base_s
    from public.os_comissao_criacao where ordemservicoid = v_os_id;
  if v_base_s <> 1000 then
    raise exception 'Com a flag, so o servico comissionavel entra (1000), veio %', v_base_s;
  end if;

  -- 6) Execucao encerrada congela o valor ------------------------------------
  update public.ordemservico set execucao_fim_em = now() where id = v_os_id;

  select valor_comissao into v_valor
    from public.os_comissao_criacao where ordemservicoid = v_os_id;

  update public.usuario set comissao_criacao_servico_percent = 50 where id = v_criador;
  perform public.recalcular_comissao_criacao_os(v_os_id);

  select valor_comissao into v_base_p
    from public.os_comissao_criacao where ordemservicoid = v_os_id;
  if v_base_p <> v_valor then
    raise exception 'Execucao encerrada: o valor nao podia mudar (era %, virou %)',
      v_valor, v_base_p;
  end if;

  -- 4) Criador sem percentual: nao ha linha nem evento -----------------------
  update public.usuario
     set comissao_criacao_servico_percent = null,
         comissao_criacao_produto_percent = null
   where id = v_criador;
  -- A OS ja esta com a execucao encerrada, e ali os percentuais vem do
  -- snapshot. Uma OS nova prova o caso de quem nunca teve o beneficio.
  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (v_cliente_id, v_criador, 'EM_ANDAMENTO', 1000, 0)
  returning id into v_os_id;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_id, 1, 1000, 1000);

  select count(*) into v_qtd
    from public.os_comissao_criacao where ordemservicoid = v_os_id;
  if v_qtd <> 0 then
    raise exception 'Criador sem percentual nao devia ter linha, tem %', v_qtd;
  end if;

  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);
  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO'
     and chave_origem like 'CRIACAO:%' and status = 'ATIVO';
  if v_qtd <> 0 then
    raise exception 'Criador sem percentual nao devia gerar evento, gerou %', v_qtd;
  end if;

  -- 7) OS ja encerrada e nunca apurada nao ganha comissao retroativa ---------
  -- Simula ligar o beneficio depois que a ordem fechou: mexer nela nao pode
  -- criar comissao num mes ja publicado.
  update public.ordemservico set execucao_fim_em = now(), status = 'CONCLUIDO' where id = v_os_id;
  update public.usuario
     set comissao_criacao_servico_percent = 1,
         comissao_criacao_produto_percent = 0.5
   where id = v_criador;

  perform public.recalcular_comissao_criacao_os(v_os_id);

  select count(*) into v_qtd
    from public.os_comissao_criacao where ordemservicoid = v_os_id;
  if v_qtd <> 0 then
    raise exception 'OS encerrada sem apuracao nao devia ganhar comissao depois, ganhou %', v_qtd;
  end if;

  raise notice 'OK: comissao de criacao — base, desconto, flag, congelamento, ausencia e nao-retroatividade.';
end;
$test$;

rollback;
