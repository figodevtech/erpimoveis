-- A observação fiscal acompanha a ida ao pagamento, nos dois modos.
--
-- Roda em transacao e desfaz tudo no fim. A observação é preenchida no cadastro
-- da OS e volta a ser editável no diálogo que encerra a execução e no que envia
-- para faturamento. A rota grava o campo num UPDATE próprio, porque as duas RPC
-- de faturamento escrevem apenas as condições acertadas com o cliente. O que
-- está sendo provado é justamente isso: nenhum caminho da transição apaga ou
-- sobrescreve a observação.
--
--   1) modo padrao: encerrar a execucao grava status e observacao juntos;
--   2) modo faturamento: o encerramento continua sendo um UPDATE comum;
--   3) a RPC que recebe as condicoes nao toca na observacao;
--   4) o reenvio que preserva o acordo tambem nao toca;
--   5) limpar a observacao e escolha valida, e nao volta sozinha.
begin;

do $test$
declare
  v_cliente integer;
  v_usuario uuid;
  v_os integer;
  v_obs text;
  v_status text;
  v_condicoes jsonb;
begin
  select id into v_cliente from public.cliente order by id limit 1;
  select id into v_usuario from public.usuario where ativo order by id limit 1;
  if v_cliente is null or v_usuario is null then
    raise exception 'O banco de teste precisa de cliente e usuario ativos.';
  end if;

  -- 1) Modo padrao -----------------------------------------------------------
  update public.config_geral set habilitar_faturamento_os = false;

  insert into public.ordemservico(usuariocriadorid, clienteid, status, orcamentototal,
    subtotal, valor_frete, dataentrada, observacoes_fiscais)
  values (v_usuario, v_cliente, 'ORCAMENTO', 100, 100, 0, now(), 'Do cadastro')
  returning id into v_os;
  update public.ordemservico set status = 'ORCAMENTO_APROVADO' where id = v_os;
  update public.ordemservico set status = 'EM_ANDAMENTO' where id = v_os;

  update public.ordemservico
     set status = 'PAGAMENTO', observacoes_fiscais = 'Alterada no pagamento'
   where id = v_os;
  select status::text, observacoes_fiscais into v_status, v_obs
    from public.ordemservico where id = v_os;
  if v_status <> 'PAGAMENTO' or v_obs <> 'Alterada no pagamento' then
    raise exception 'Modo padrao: status % com observacao %', v_status, v_obs;
  end if;

  -- 2) Modo faturamento, encerramento da execucao -----------------------------
  update public.config_geral set habilitar_faturamento_os = true;

  update public.ordemservico set status = 'ORCAMENTO' where id = v_os;
  update public.ordemservico set status = 'ORCAMENTO_APROVADO' where id = v_os;
  update public.ordemservico set status = 'EM_ANDAMENTO' where id = v_os;
  update public.ordemservico
     set status = 'PAGAMENTO', observacoes_fiscais = 'Escrita ao encerrar'
   where id = v_os;
  select status::text, observacoes_fiscais into v_status, v_obs
    from public.ordemservico where id = v_os;
  if v_status <> 'PAGAMENTO' or v_obs <> 'Escrita ao encerrar' then
    raise exception 'Modo faturamento, encerramento: status % com observacao %', v_status, v_obs;
  end if;

  -- 3) Envio ao faturamento com condicoes -------------------------------------
  update public.ordemservico set observacoes_fiscais = 'Escrita ao faturar' where id = v_os;
  v_condicoes := '{"pagamentos_previstos":[{"metodo":"PIX","valor":100,"parcelas":null}],
    "forma_pagamento":"PIX","parcelas_pagamento":null,"descricao_financeiro":"Acordo"}'::jsonb;
  perform public.transicionar_faturamento_os(v_os, 'FATURAMENTO', v_condicoes);
  select status::text, observacoes_fiscais into v_status, v_obs
    from public.ordemservico where id = v_os;
  if v_status <> 'FATURAMENTO' or v_obs <> 'Escrita ao faturar' then
    raise exception 'A RPC de condicoes deixou status % com observacao %', v_status, v_obs;
  end if;

  -- 4) Reenvio sem alterar as condicoes ---------------------------------------
  perform public.transicionar_faturamento_os(v_os, 'PAGAMENTO');
  update public.ordemservico set observacoes_fiscais = 'Corrigida no reenvio' where id = v_os;
  perform public.transicionar_faturamento_os(v_os, 'FATURAMENTO');
  select status::text, observacoes_fiscais into v_status, v_obs
    from public.ordemservico where id = v_os;
  if v_status <> 'FATURAMENTO' or v_obs <> 'Corrigida no reenvio' then
    raise exception 'O reenvio deixou status % com observacao %', v_status, v_obs;
  end if;
  if (select pagamentos_previstos from public.ordemservico where id = v_os)
     is distinct from v_condicoes->'pagamentos_previstos' then
    raise exception 'O reenvio perdeu o acordo ja salvo.';
  end if;

  -- 5) Limpar a observacao ----------------------------------------------------
  perform public.transicionar_faturamento_os(v_os, 'PAGAMENTO');
  update public.ordemservico set observacoes_fiscais = null where id = v_os;
  perform public.transicionar_faturamento_os(v_os, 'FATURAMENTO');
  if (select observacoes_fiscais from public.ordemservico where id = v_os) is not null then
    raise exception 'A observacao apagada voltou sozinha.';
  end if;

  raise notice 'Observacao fiscal: encerramento, envio ao faturamento, reenvio e limpeza validados nos dois modos.';
end;
$test$;

rollback;
