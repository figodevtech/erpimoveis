-- OS reiniciada nao e OS concluida.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) PAGAMENTO carimba o fim, e os eventos da OS ganham a competencia;
--   2) voltar para ORCAMENTO apaga o fim e a competencia, e o inicio fica;
--   3) a comissao continua ATIVA — so perde a competencia;
--   4) a OS que volta a andar e entregue de novo ganha carimbo e competencia;
--   5) nenhum status anterior a execucao aceita carimbo, nem gravado a forca.
begin;

do $test$
declare
  v_cliente_id integer;
  v_usuario uuid;
  v_servico_id integer;
  v_os_id integer;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_qtd integer;
  v_status text;
begin
  select id into v_cliente_id from public.cliente order by id limit 1;
  select id into v_usuario from public.usuario where ativo order by id limit 1;
  if v_cliente_id is null or v_usuario is null then
    raise exception 'O banco de teste precisa de cliente e usuario ativos.';
  end if;

  update public.usuario set comissao_percent = 5 where id = v_usuario;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-REINICIO-' || floor(random() * 1000000)::text, 'SERVICO DE TESTE REINICIO', 1000, true)
  returning id into v_servico_id;

  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (v_cliente_id, v_usuario, 'ORCAMENTO_APROVADO', 1000, 0)
  returning id into v_os_id;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_id, 1, 1000, 1000);

  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os_id, v_servico_id, v_usuario);

  update public.ordemservico set status = 'EM_ANDAMENTO' where id = v_os_id;

  -- 1) Entregue ---------------------------------------------------------------
  update public.ordemservico set status = 'PAGAMENTO' where id = v_os_id;

  select execucao_inicio_em, execucao_fim_em into v_inicio, v_fim
    from public.ordemservico where id = v_os_id;
  if v_fim is null then
    raise exception 'PAGAMENTO deveria carimbar execucao_fim_em';
  end if;

  select count(*) into v_qtd from public.eventos_financeiros
   where ordemservicoid = v_os_id and status = 'ATIVO' and origem = 'COMISSAO';
  if v_qtd <> 1 then
    raise exception 'A OS entregue deveria ter 1 comissao ativa, tem %', v_qtd;
  end if;

  select count(*) into v_qtd from public.eventos_financeiros
   where ordemservicoid = v_os_id and status <> 'CANCELADO'
     and competencia_em is distinct from v_fim;
  if v_qtd <> 0 then
    raise exception 'Todo evento da OS entregue deveria ter a competencia do carimbo; % nao tem', v_qtd;
  end if;

  -- 2) Reiniciada ---------------------------------------------------------------
  update public.ordemservico set status = 'ORCAMENTO' where id = v_os_id;

  if exists (select 1 from public.ordemservico where id = v_os_id and execucao_fim_em is not null) then
    raise exception 'Voltar para ORCAMENTO deveria apagar execucao_fim_em';
  end if;
  if not exists (select 1 from public.ordemservico where id = v_os_id and execucao_inicio_em = v_inicio) then
    raise exception 'Voltar para ORCAMENTO nao deveria mexer em execucao_inicio_em';
  end if;

  select count(*) into v_qtd from public.eventos_financeiros
   where ordemservicoid = v_os_id and status <> 'CANCELADO' and competencia_em is not null;
  if v_qtd <> 0 then
    raise exception 'OS reiniciada nao deveria ter evento com competencia; % tem', v_qtd;
  end if;

  -- 3) A comissao fica ----------------------------------------------------------
  select count(*) into v_qtd from public.eventos_financeiros
   where ordemservicoid = v_os_id and status = 'ATIVO' and origem = 'COMISSAO';
  if v_qtd <> 1 then
    raise exception 'A comissao deveria continuar ativa na OS reiniciada, restam %', v_qtd;
  end if;

  -- 4) Volta a andar e e entregue de novo -------------------------------------
  update public.ordemservico set status = 'ORCAMENTO_APROVADO' where id = v_os_id;
  update public.ordemservico set status = 'EM_ANDAMENTO' where id = v_os_id;
  update public.ordemservico set status = 'PAGAMENTO' where id = v_os_id;

  select execucao_fim_em into v_fim from public.ordemservico where id = v_os_id;
  if v_fim is null then
    raise exception 'A nova entrega deveria carimbar execucao_fim_em de novo';
  end if;

  select count(*) into v_qtd from public.eventos_financeiros
   where ordemservicoid = v_os_id and status <> 'CANCELADO'
     and competencia_em is distinct from v_fim;
  if v_qtd <> 0 then
    raise exception 'Na nova entrega todo evento deveria voltar a ter competencia; % nao tem', v_qtd;
  end if;

  -- 5) Nenhum status anterior a execucao guarda carimbo -----------------------
  foreach v_status in array array[
    'AGUARDANDO_CHECKLIST', 'ORCAMENTO', 'APROVACAO_ORCAMENTO',
    'ORCAMENTO_APROVADO', 'ORCAMENTO_RECUSADO'
  ] loop
    update public.ordemservico
       set status = v_status::public.enum_status_os, execucao_fim_em = now()
     where id = v_os_id;
    if exists (select 1 from public.ordemservico where id = v_os_id and execucao_fim_em is not null) then
      raise exception '% nao deveria aceitar execucao_fim_em', v_status;
    end if;
  end loop;

  raise notice 'OK: reiniciar a OS desfaz a conclusao e tira os eventos da DRE.';
end;
$test$;

rollback;
