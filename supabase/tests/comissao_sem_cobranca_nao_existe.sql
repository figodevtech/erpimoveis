-- OS sem cobranca nao tem comissao nenhuma.
--
-- Roda em transacao e desfaz tudo no fim. Sem receita nao ha o que comissionar,
-- e a linha de R$ 0,00 sai do livro. O que esta sendo provado:
--   1) antes, a OS tem os dois eventos de comissao — realizacao e criacao;
--   2) ao ir para SEM_COBRANCA, nenhum evento COMISSAO fica ATIVO;
--   3) o custo do produto, que foi consumido de verdade, continua la;
--   4) comissao ja CONVERTIDO sobrevive: dinheiro comprometido se desfaz pelo
--      financeiro, nao pela troca de status.
--
-- Nota: o teste zera o orcamento antes de trocar o status, reproduzindo o que
-- a rota `PATCH /api/ordens/[id]/status` faz em dois UPDATEs separados. Sem
-- isso, o gatilho BEFORE publicaria comissao com o valor antigo.
begin;

do $test$
declare
  v_cliente_id integer;
  v_criador uuid;
  v_realizador uuid;
  v_servico_id integer;
  v_produto_id integer;
  v_os_id integer;
  v_transacao_id bigint;
  v_qtd integer;
begin
  select id into v_cliente_id from public.cliente order by id limit 1;
  if v_cliente_id is null then
    raise exception 'O banco de teste precisa de ao menos um cliente.';
  end if;

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
  values ('TESTE-SEMCOB-' || floor(random() * 1000000)::text, 'SERVICO SEM COBRANCA', 1000, true)
  returning id into v_servico_id;

  select id into v_produto_id from public.produto order by id limit 1;
  if v_produto_id is null then
    raise exception 'O banco de teste precisa de ao menos um produto.';
  end if;

  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (v_cliente_id, v_criador, 'EM_ANDAMENTO', 1500, 0)
  returning id into v_os_id;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_id, 1, 1000, 1000);

  insert into public.osproduto (ordemservicoid, produtoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_produto_id, 1, 500, 500);

  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os_id, v_servico_id, v_realizador);

  -- 1) Antes: as duas comissoes existem --------------------------------------
  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);

  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO';
  if v_qtd <> 2 then
    raise exception 'Antes do SEM_COBRANCA deveriam existir 2 comissoes, existem %', v_qtd;
  end if;

  -- 2) Depois: nenhuma ------------------------------------------------------
  -- A zeragem espelha a rota de status: desconto integral, num UPDATE anterior
  -- ao da mudanca de status.
  update public.ordemservico
     set desconto_tipo = 'PORCENTAGEM', desconto = 100, valor_frete = 0, orcamentototal = 0
   where id = v_os_id;

  update public.ordemservico set status = 'SEM_COBRANCA' where id = v_os_id;

  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'ATIVO';
  if v_qtd <> 0 then
    raise exception 'OS sem cobranca nao devia ter comissao ativa, tem %', v_qtd;
  end if;

  -- 3) O custo do produto continua: foi consumido de verdade ----------------
  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'PRODUTO' and natureza = 'DESPESA'
     and status = 'ATIVO';
  if v_qtd < 1 then
    raise exception 'O custo do produto deveria sobreviver ao SEM_COBRANCA';
  end if;

  -- 4) Comissao ja convertida sobrevive -------------------------------------
  insert into public.ordemservico (clienteid, usuariocriadorid, status, orcamentototal, valor_frete)
  values (v_cliente_id, v_criador, 'EM_ANDAMENTO', 1000, 0)
  returning id into v_os_id;

  insert into public.osservico (ordemservicoid, servicoid, quantidade, precounitario, subtotal)
  values (v_os_id, v_servico_id, 1, 1000, 1000);

  insert into public.osservico_realizador (ordemservicoid, servicoid, usuarioid)
  values (v_os_id, v_servico_id, v_realizador);

  perform public.reconciliar_eventos_financeiros_os(v_os_id, true);

  insert into public.transacao (descricao, valor, "valorLiquido", data, tipo, pendente,
                                nomepagador, cpfcnpjpagador, categoria)
  values ('Comissao paga - teste', 50, 50, now(), 'DESPESA', true,
          'Teste', 'NAO INFORMADO', 'NAO RELACIONADO')
  returning id into v_transacao_id;

  update public.eventos_financeiros
     set status = 'CONVERTIDO', transacaoid = v_transacao_id
   where ordemservicoid = v_os_id and origem = 'COMISSAO'
     and chave_origem = 'CRIACAO:' || v_criador;

  update public.ordemservico
     set desconto_tipo = 'PORCENTAGEM', desconto = 100, valor_frete = 0, orcamentototal = 0
   where id = v_os_id;
  update public.ordemservico set status = 'SEM_COBRANCA' where id = v_os_id;

  select count(*) into v_qtd
    from public.eventos_financeiros
   where ordemservicoid = v_os_id and origem = 'COMISSAO' and status = 'CONVERTIDO';
  if v_qtd <> 1 then
    raise exception 'A comissao convertida deveria sobreviver, restaram %', v_qtd;
  end if;

  raise notice 'OK: OS sem cobranca perde as comissoes, preserva custo e o que ja virou transacao.';
end;
$test$;

rollback;
