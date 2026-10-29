-- Executado por test-base-imoveis.ts na mesma transação revertida da migration.
do $test$
declare
  usuario_id uuid;
  cliente_id integer;
  produto_id integer;
  grupo_id integer;
  unidade_id integer;
  banco_id bigint;
  venda_id integer;
  titulo_id bigint;
begin
  select id into strict usuario_id from public.usuario limit 1;
  insert into public.cliente(nomerazaosocial,tipopessoa,cpfcnpj)
    values('TESTE EXCLUSAO LEGADO','FISICA','52998224725') returning id into cliente_id;
  insert into public.produtogrupo(nome) values('TESTE EXCLUSAO LEGADO') returning id into grupo_id;
  insert into public.unidademedida(sigla) values('TST') returning id into unidade_id;
  insert into public.produto(titulo,precovenda,estoque,grupo_produto_id,tipo_unidade_id)
    values('TESTE EXCLUSAO LEGADO',100,5,grupo_id,unidade_id) returning id into produto_id;
  insert into public.bancoconta(titulo,valorinicial,created_at,updated_at)
    values('TESTE EXCLUSAO LEGADO',0,now(),now()) returning id into banco_id;
  insert into public.venda(clienteid,status,sub_total,valortotal,created_by)
    values(cliente_id,'PAGAMENTO',100,100,usuario_id) returning id into venda_id;

  insert into public.transacao(descricao,valor,"valorLiquido",data,competencia_em,tipo,
    pendente,cliente_id,vendaid,nomepagador,cpfcnpjpagador,categoria)
    values('TESTE ABONO SEM OFICINA',100,100,now(),now(),'RECEITA',true,cliente_id,venda_id,
      'TESTE','52998224725','NÃO RELACIONADO') returning id into titulo_id;
  perform public.abonar_transacao_pendente(titulo_id,usuario_id,'TESTE EM ROLLBACK');
  if not exists(select 1 from public.transacao where id=titulo_id and abonado and not pendente) then
    raise exception 'Abono deixou de funcionar após exclusão da oficina';
  end if;

  insert into public.transacao(descricao,valor,"valorLiquido",data,competencia_em,tipo,
    pendente,nomepagador,cpfcnpjpagador,categoria)
    values('TESTE BAIXA SEM OFICINA',50,50,now(),now(),'DESPESA',true,
      'TESTE','','NÃO RELACIONADO') returning id into titulo_id;
  perform public.baixar_transacao_pendente(titulo_id,now(),banco_id,'PIX',null,null,usuario_id,null,null,'[]'::jsonb);
  if not exists(select 1 from public.transacao t where t.id=titulo_id and not t.pendente and t.banco_id is not null) then
    raise exception 'Baixa deixou de funcionar após exclusão da oficina';
  end if;
  perform public.estornar_baixa_transacao(titulo_id,usuario_id);
  if not exists(select 1 from public.transacao where id=titulo_id and pendente) then
    raise exception 'Estorno deixou de funcionar após exclusão da oficina';
  end if;

  -- Vínculo inexistente é recusado pelo próprio banco, e não vira ID órfão.
  begin
    update public.transacao set ordemservicoid=1 where id=titulo_id;
    raise exception 'Banco aceitou um vínculo com OS removida';
  exception when check_violation then null;
  end;
end $test$;
