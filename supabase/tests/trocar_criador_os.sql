-- Trocar o criador da OS leva a comissao de criacao junto.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) OS entregue: a comissao de quem saiu e cancelada, a de quem entrou sai
--      pela taxa dele, e a comissao de realizacao nao se move;
--   2) OS em orcamento aprovado: so o snapshot muda de dono, sem evento;
--   3) OS encerrada e nunca apurada: quem entra ganha a comissao;
--   4) OS reiniciada, que mantem os eventos: a comissao migra do mesmo jeito;
--   5) recusas: mesmo criador, comissao corrigida a mao, OS cancelada e
--      usuario inativo.
begin;

-- OS de um servico de R$ 1.000, levada ate o status pedido pelo caminho normal.
create function pg_temp.os_de_teste(
  p_cliente integer, p_criador uuid, p_servico integer, p_realizador uuid, p_status text
) returns integer
language plpgsql as $$
declare
  v_os integer;
begin
  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (p_cliente, p_criador, 'ORCAMENTO_APROVADO', 1000, 0)
  returning id into v_os;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os, p_servico, 1, 1000, 1000);
  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os, p_servico, p_realizador);

  if p_status in ('EM_ANDAMENTO', 'PAGAMENTO') then
    update public.ordemservico set status = 'EM_ANDAMENTO' where id = v_os;
  end if;
  if p_status = 'PAGAMENTO' then
    update public.ordemservico set status = 'PAGAMENTO' where id = v_os;
  end if;
  return v_os;
end;
$$;

-- Valor ativo da comissao de criacao de um usuario na OS; nulo se nao houver.
create function pg_temp.criacao_ativa(p_os integer, p_usuario uuid) returns numeric
language sql as $$
  select sum(valor) from public.eventos_financeiros
   where ordemservicoid = p_os and origem = 'COMISSAO' and status = 'ATIVO'
     and chave_origem like 'CRIACAO:' || p_usuario || ':%';
$$;

do $test$
declare
  v_cliente integer;
  v_a uuid;
  v_b uuid;
  v_servico integer;
  v_os integer;
  v_resultado jsonb;
  v_valor numeric;
  v_realizacao_antes text;
  v_realizacao_depois text;
  v_mensagem text;
begin
  select id into v_cliente from public.cliente order by id limit 1;
  select id into v_a from public.usuario where ativo order by id limit 1;
  select id into v_b from public.usuario where ativo and id <> v_a order by id limit 1;
  if v_cliente is null or v_b is null then
    raise exception 'O banco de teste precisa de um cliente e dois usuarios ativos.';
  end if;

  update public.usuario
     set comissao_criacao_servico_percent = 1, comissao_criacao_produto_percent = 0.5,
         comissao_criacao_somente_comissionaveis = false, comissao_percent = 5
   where id = v_a;
  update public.usuario
     set comissao_criacao_servico_percent = 2, comissao_criacao_produto_percent = 1,
         comissao_criacao_somente_comissionaveis = false
   where id = v_b;

  insert into public.servico (codigo, descricao, precohora, gera_comissao)
  values ('TESTE-CRIADOR-' || floor(random() * 1000000)::text, 'SERVICO DE TESTE CRIADOR', 1000, true)
  returning id into v_servico;

  -- 1) OS entregue ------------------------------------------------------------
  v_os := pg_temp.os_de_teste(v_cliente, v_a, v_servico, v_a, 'PAGAMENTO');
  if pg_temp.criacao_ativa(v_os, v_a) is distinct from 10 then
    raise exception 'Antes da troca, A deveria ter R$ 10 de comissao de criacao; tem %', pg_temp.criacao_ativa(v_os, v_a);
  end if;

  select string_agg(chave_origem || '=' || status || ':' || valor, ',' order by chave_origem)
    into v_realizacao_antes
    from public.eventos_financeiros
   where ordemservicoid = v_os and origem = 'COMISSAO' and chave_origem not like 'CRIACAO:%';

  v_resultado := public.trocar_criador_os(v_os, v_b);

  if (select usuariocriadorid from public.ordemservico where id = v_os) is distinct from v_b then
    raise exception 'O criador da OS deveria ser B';
  end if;
  if pg_temp.criacao_ativa(v_os, v_a) is not null then
    raise exception 'A comissao de criacao de A deveria estar cancelada';
  end if;
  if pg_temp.criacao_ativa(v_os, v_b) is distinct from 20 then
    raise exception 'B deveria ter R$ 20 (2%% de R$ 1.000); tem %', pg_temp.criacao_ativa(v_os, v_b);
  end if;
  if (v_resultado ->> 'comissao_anterior')::numeric <> 10
     or (v_resultado ->> 'comissao_nova')::numeric <> 20
     or not (v_resultado ->> 'eventos_publicados')::boolean then
    raise exception 'Resultado inesperado: %', v_resultado;
  end if;

  select string_agg(chave_origem || '=' || status || ':' || valor, ',' order by chave_origem)
    into v_realizacao_depois
    from public.eventos_financeiros
   where ordemservicoid = v_os and origem = 'COMISSAO' and chave_origem not like 'CRIACAO:%';
  if v_realizacao_antes is distinct from v_realizacao_depois then
    raise exception 'A comissao de realizacao nao deveria mudar: % -> %', v_realizacao_antes, v_realizacao_depois;
  end if;

  -- 5a) Mesmo criador -----------------------------------------------------------
  begin
    perform public.trocar_criador_os(v_os, v_b);
    raise exception 'A troca para o mesmo criador deveria ser recusada';
  exception when others then
    v_mensagem := sqlerrm;
  end;
  if v_mensagem not like 'A OS já foi criada por%' then
    raise exception 'Mensagem inesperada para o mesmo criador: %', v_mensagem;
  end if;

  -- 2) Orcamento aprovado ---------------------------------------------------------
  v_os := pg_temp.os_de_teste(v_cliente, v_a, v_servico, v_a, 'ORCAMENTO_APROVADO');
  v_resultado := public.trocar_criador_os(v_os, v_b);

  if exists (select 1 from public.os_comissao_criacao where ordemservicoid = v_os and usuarioid <> v_b) then
    raise exception 'O snapshot da OS em orcamento deveria ser todo de B';
  end if;
  select sum(valor_comissao) into v_valor from public.os_comissao_criacao where ordemservicoid = v_os;
  if v_valor is distinct from 20 then
    raise exception 'O snapshot de B deveria somar R$ 20; soma %', v_valor;
  end if;
  if exists (select 1 from public.eventos_financeiros
              where ordemservicoid = v_os and origem = 'COMISSAO' and status <> 'CANCELADO') then
    raise exception 'OS em orcamento aprovado nao deveria ganhar evento de comissao';
  end if;
  if (v_resultado ->> 'eventos_publicados')::boolean then
    raise exception 'OS em orcamento aprovado nao deveria reconciliar: %', v_resultado;
  end if;

  -- 3) Encerrada e nunca apurada ------------------------------------------------
  update public.usuario
     set comissao_criacao_servico_percent = 0, comissao_criacao_produto_percent = 0
   where id = v_a;
  v_os := pg_temp.os_de_teste(v_cliente, v_a, v_servico, v_a, 'PAGAMENTO');
  update public.usuario
     set comissao_criacao_servico_percent = 1, comissao_criacao_produto_percent = 0.5
   where id = v_a;

  if exists (select 1 from public.os_comissao_criacao where ordemservicoid = v_os) then
    raise exception 'A OS encerrada com criador sem taxa nao deveria ter snapshot';
  end if;

  perform public.trocar_criador_os(v_os, v_b);
  if pg_temp.criacao_ativa(v_os, v_b) is distinct from 20 then
    raise exception 'Na OS encerrada e nunca apurada, B deveria ganhar R$ 20; tem %', pg_temp.criacao_ativa(v_os, v_b);
  end if;

  -- 4) Reiniciada -----------------------------------------------------------------
  v_os := pg_temp.os_de_teste(v_cliente, v_a, v_servico, v_a, 'PAGAMENTO');
  update public.ordemservico set status = 'ORCAMENTO' where id = v_os;
  if pg_temp.criacao_ativa(v_os, v_a) is distinct from 10 then
    raise exception 'A OS reiniciada deveria manter a comissao de A ativa';
  end if;

  perform public.trocar_criador_os(v_os, v_b);
  if pg_temp.criacao_ativa(v_os, v_a) is not null or pg_temp.criacao_ativa(v_os, v_b) is distinct from 20 then
    raise exception 'Na OS reiniciada a comissao deveria migrar de A para B: A %, B %',
      pg_temp.criacao_ativa(v_os, v_a), pg_temp.criacao_ativa(v_os, v_b);
  end if;

  -- 5b) Comissao corrigida a mao ------------------------------------------------
  v_os := pg_temp.os_de_teste(v_cliente, v_a, v_servico, v_a, 'PAGAMENTO');
  update public.eventos_financeiros
     set is_manual = true
   where ordemservicoid = v_os and origem = 'COMISSAO' and chave_origem like 'CRIACAO:%';

  v_mensagem := null;
  begin
    perform public.trocar_criador_os(v_os, v_b);
    raise exception 'A troca com comissao corrigida a mao deveria ser recusada';
  exception when others then
    v_mensagem := sqlerrm;
  end;
  if v_mensagem not like 'A comissão de criação desta OS já foi lançada%' then
    raise exception 'Mensagem inesperada para comissao comprometida: %', v_mensagem;
  end if;
  if (select usuariocriadorid from public.ordemservico where id = v_os) is distinct from v_a then
    raise exception 'A troca recusada nao deveria ter mudado o criador';
  end if;

  -- 5c) OS cancelada ----------------------------------------------------------------
  v_os := pg_temp.os_de_teste(v_cliente, v_a, v_servico, v_a, 'ORCAMENTO_APROVADO');
  update public.ordemservico set status = 'CANCELADO' where id = v_os;

  v_mensagem := null;
  begin
    perform public.trocar_criador_os(v_os, v_b);
    raise exception 'A troca em OS cancelada deveria ser recusada';
  exception when others then
    v_mensagem := sqlerrm;
  end;
  if v_mensagem <> 'Uma OS cancelada não muda de criador.' then
    raise exception 'Mensagem inesperada para OS cancelada: %', v_mensagem;
  end if;

  -- 5d) Usuario inativo -------------------------------------------------------------
  v_os := pg_temp.os_de_teste(v_cliente, v_a, v_servico, v_a, 'ORCAMENTO_APROVADO');
  update public.usuario set ativo = false where id = v_b;

  v_mensagem := null;
  begin
    perform public.trocar_criador_os(v_os, v_b);
    raise exception 'A troca para usuario inativo deveria ser recusada';
  exception when others then
    v_mensagem := sqlerrm;
  end;
  if v_mensagem not like '%está inativo%' then
    raise exception 'Mensagem inesperada para usuario inativo: %', v_mensagem;
  end if;

  raise notice 'OK: trocar o criador leva a comissao de criacao junto, pela taxa de quem entra.';
end;
$test$;

rollback;
