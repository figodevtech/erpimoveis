-- Servico sem comissao mantem evento de R$ 0,00, para constar no historico.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) servico que nao comissiona ganha evento de comissao de R$ 0,00;
--   2) o detalhe diz o motivo, em vez de deixar a ausencia sem explicacao;
--   3) o evento zerado nao pode virar transacao;
--   4) `dados_snapshot` carrega `gera_comissao` para a tela nao adivinhar;
--   5) desligar a flag depois zera o evento que existia, sem cancela-lo;
--   6) servico que comissiona segue intacto na mesma OS.
begin;

do $test$
declare
  v_cliente_id integer;
  v_usuario uuid;
  v_servico_ok integer;
  v_servico_sem integer;
  v_os_id integer;
  v_valor numeric;
  v_pct numeric;
  v_detalhe text;
  v_pode boolean;
  v_flag jsonb;
  v_status text;
begin
  select id into v_cliente_id from public.cliente order by id limit 1;
  select id into v_usuario from public.usuario where ativo order by id limit 1;
  if v_cliente_id is null or v_usuario is null then
    raise exception 'O banco de teste precisa de cliente e usuario ativos.';
  end if;

  update public.usuario set comissao_percent = 10 where id = v_usuario;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-OK-' || floor(random() * 1000000)::text, 'SERVICO QUE COMISSIONA', 1000, true)
  returning id into v_servico_ok;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-SEM-' || floor(random() * 1000000)::text, 'SERVICO SEM COMISSAO', 500, false)
  returning id into v_servico_sem;

  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (v_cliente_id, v_usuario, 'EM_ANDAMENTO', 1500, 0)
  returning id into v_os_id;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_ok, 1, 1000, 1000), (v_os_id, v_servico_sem, 1, 500, 500);

  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os_id, v_servico_ok, v_usuario), (v_os_id, v_servico_sem, v_usuario);

  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);

  -- 1) 2) 3) 4) O servico sem comissao tem linha, zerada e explicada -----------
  select valor, percentual_snapshot, detalhe, pode_gerar_transacao, dados_snapshot, status
    into v_valor, v_pct, v_detalhe, v_pode, v_flag, v_status
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and servicoid = v_servico_sem;

  if v_valor is null then
    raise exception 'O servico sem comissao deveria ter evento de comissao zerado, nao tem nenhum';
  end if;
  if v_status <> 'ATIVO' then
    raise exception 'O evento zerado deveria ficar ATIVO, veio %', v_status;
  end if;
  if v_valor <> 0 or v_pct <> 0 then
    raise exception 'O evento deveria estar zerado, veio valor % e percentual %', v_valor, v_pct;
  end if;
  if v_detalhe not like '%servi_o n_o gera comiss_o%' then
    raise exception 'O detalhe nao explica o motivo: %', v_detalhe;
  end if;
  if v_pode then
    raise exception 'Evento zerado nao pode gerar transacao';
  end if;
  if coalesce((v_flag ->> 'gera_comissao')::boolean, true) then
    raise exception 'dados_snapshot deveria trazer gera_comissao = false';
  end if;

  -- 6) O servico que comissiona na mesma OS nao foi afetado --------------------
  select valor, percentual_snapshot, pode_gerar_transacao
    into v_valor, v_pct, v_pode
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and servicoid = v_servico_ok;

  if v_valor <> 100 or v_pct <> 10 or not v_pode then
    raise exception 'O servico que comissiona deveria seguir em 100 a 10%%, veio % a %', v_valor, v_pct;
  end if;

  -- 5) Desligar a flag depois zera a linha, sem cancelar ----------------------
  update public.servico set gera_comissao = false where id = v_servico_ok;
  perform public.recalcular_comissao_osservico(v_os_id, v_servico_ok);
  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);

  select valor, status, detalhe into v_valor, v_status, v_detalhe
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and servicoid = v_servico_ok;

  if v_status <> 'ATIVO' then
    raise exception 'A linha deveria continuar ATIVA como historico, veio %', v_status;
  end if;
  if v_valor <> 0 then
    raise exception 'A linha deveria ter ido a zero, veio %', v_valor;
  end if;
  if v_detalhe not like '%servi_o n_o gera comiss_o%' then
    raise exception 'A linha zerada deveria explicar o motivo: %', v_detalhe;
  end if;

  raise notice 'OK: servico sem comissao mantem a linha zerada e explicada.';
end;
$test$;

rollback;
