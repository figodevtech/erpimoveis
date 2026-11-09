BEGIN;
-- O runner carrega também os testes de edição, que criam pg_temp.exigir e pg_temp.cpf.
DO $test$
DECLARE
  actor uuid; c integer; p bigint; i bigint; r bigint; r2 bigint; b bigint;
  e bigint; outro bigint; grupo bigint; tx bigint; conta bigint; ajuste bigint; item integer;
  j jsonb; versao timestamptz;
BEGIN
  SELECT id INTO actor FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,status)
    VALUES('FISICA',pg_temp.cpf('995003001'),'Teste exclusão de lançamentos','ATIVO') RETURNING id INTO c;
  INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,created_by)
    VALUES('Proprietário teste exclusão',pg_temp.cpf('995003002'),actor) RETURNING id INTO p;
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,percentual_admin,created_by)
    VALUES(p,'Imóvel teste exclusão',gen_random_uuid()::text,ARRAY['TEMPORADA'],2,100,10,actor) RETURNING id INTO i;
  INSERT INTO public.reserva_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,hospedes,valor_diarias,valor_total,percentual_admin,idempotency_key,payload_hash,created_by)
    VALUES(i,c,p,current_date,current_date+2,1,200,200,10,gen_random_uuid()::text,'teste',actor) RETURNING id INTO r;
  INSERT INTO public.reserva_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,hospedes,valor_diarias,valor_total,percentual_admin,idempotency_key,payload_hash,created_by)
    VALUES(i,c,p,current_date+3,current_date+5,1,200,200,10,gen_random_uuid()::text,'teste',actor) RETURNING id INTO r2;
  INSERT INTO public.bancoconta(titulo,valorinicial,created_at,updated_at) VALUES('Banco teste exclusão',0,now(),now()) RETURNING id INTO b;

  j:=public.imob_criar_evento_reserva(r,'Custo para excluir',NULL,20,current_date,actor); e:=(j->>'id')::bigint;
  BEGIN
    PERFORM public.imob_excluir_evento_reserva(r2,e,'{}',actor);
    RAISE EXCEPTION 'excluiu evento de outra reserva';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM public.imob_excluir_evento_reserva(r,e,'{}',actor);
  PERFORM public.imob_excluir_evento_reserva(r,e,'{}',actor);
  PERFORM pg_temp.exigir((SELECT status='CANCELADO' FROM public.eventos_financeiros WHERE id=e),'exclusão de custo retira da DRE e aceita retry');

  -- Excluir um dos itens do boleto mantém os demais e o valor devido correto.
  j:=public.imob_criar_evento_reserva(r,'Custo 40',NULL,40,current_date,actor); e:=(j->>'id')::bigint;
  j:=public.imob_criar_evento_reserva(r,'Custo 60',NULL,60,current_date,actor); outro:=(j->>'id')::bigint;
  grupo:=public.registrar_lancamento_de_eventos(jsonb_build_object('eventos_ids',jsonb_build_array(e,outro),'created_by',actor,'pendente',true,
    'linhas',jsonb_build_array(jsonb_build_object('parcela',1,'valor',50),jsonb_build_object('parcela',2,'valor',50))));
  BEGIN
    PERFORM public.imob_excluir_evento_reserva(r,e,'{}',actor);
    RAISE EXCEPTION 'excluiu vínculo sem permissão';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.imob_excluir_evento_reserva(r,e,'{"pode_excluir_financeiro":true}',actor);
  PERFORM pg_temp.exigir((SELECT sum(valor)=60 FROM public.transacao WHERE lancamento_id=grupo AND NOT is_deleted)
    AND (SELECT status='CONVERTIDO' AND valor=60 FROM public.eventos_financeiros WHERE id=outro),'excluir item de grupo preserva outros eventos e ajusta parcelas');
  PERFORM public.imob_excluir_evento_reserva(r,outro,'{"pode_excluir_financeiro":true}',actor);
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.transacao WHERE lancamento_id=grupo AND NOT is_deleted),'excluir último item elimina compromissos em aberto');
  PERFORM public.excluir_lancamento_de_eventos(grupo,actor);
  PERFORM pg_temp.exigir((SELECT bool_and(status='CANCELADO') FROM public.eventos_financeiros WHERE id IN(e,outro)),'desfazer grupo não ressuscita custos excluídos');

  j:=public.imob_criar_evento_reserva(r,'Custo pago',NULL,80,current_date,actor); e:=(j->>'id')::bigint;
  grupo:=public.registrar_lancamento_de_eventos(jsonb_build_object('eventos_ids',jsonb_build_array(e),'created_by',actor,'pendente',true,
    'linhas',jsonb_build_array(jsonb_build_object('parcela',1,'valor',80))));
  SELECT id INTO tx FROM public.transacao WHERE lancamento_id=grupo LIMIT 1;
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  j:=public.imob_excluir_evento_reserva(r,e,'{"pode_excluir_financeiro":true}',actor); ajuste:=(j->>'ajuste_transacao_id')::bigint;
  PERFORM public.imob_excluir_evento_reserva(r,e,'{"pode_excluir_financeiro":true}',actor);
  PERFORM pg_temp.exigir((SELECT valor=80 AND NOT pendente AND NOT is_deleted FROM public.transacao WHERE id=tx)
    AND (SELECT tipo::text='RECEITA' AND valor=80 AND pendente FROM public.transacao WHERE id=ajuste)
    AND (SELECT count(*)=2 FROM public.transacao WHERE lancamento_id=grupo AND NOT is_deleted),'excluir custo pago preserva baixa e cria somente um ajuste');

  tx:=public.imob_criar_titulo(i,p,c,100,current_date,10,'TESTE:'||gen_random_uuid(),'Recebimento exclusão taxa',actor,r);
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  SELECT id INTO e FROM public.eventos_financeiros WHERE source_type='IMOVEL_TAXA' AND source_id=tx AND natureza='RECEITA';
  PERFORM public.imob_excluir_evento_reserva(r,e,'{}',actor);
  UPDATE public.transacao SET updated_at=clock_timestamp() WHERE id=tx;
  PERFORM pg_temp.exigir((SELECT status='CANCELADO' AND valor=0 AND (dados_snapshot->>'excluido_manualmente')::boolean FROM public.eventos_financeiros WHERE id=e)
    AND (SELECT sum(valor)=0 FROM public.imovel_movimento WHERE transacao_chave=tx AND tipo='TAXA_ADMIN')
    AND (SELECT sum(valor)=100 FROM public.imovel_movimento WHERE transacao_chave=tx AND tipo='BRUTO_RECEBIDO'),'excluir taxa automática não apaga pagamento e não recria receita');
  PERFORM pg_temp.exigir((SELECT (dados_snapshot->>'taxa_admin_valor_automatico')::numeric=10 FROM public.eventos_financeiros WHERE id=e),'taxa excluída conserva base para corrigir a previsão da reserva');

  INSERT INTO public.produto(titulo,precovenda,estoque,grupo_produto_id)
    VALUES('Material teste exclusão',10,5,(SELECT min(id) FROM public.produtogrupo)) RETURNING id INTO item;
  j:=public.imob_registrar_consumo_reserva(jsonb_build_object('reserva_id',r,'escopo','PRODUTO','item_id',item,'quantidade',2,'valor',4,'created_by',actor));
  e:=(j->>'evento_id')::bigint;
  PERFORM pg_temp.exigir((SELECT estoque=3 FROM public.produto WHERE id=item),'consumo de teste baixa estoque');
  PERFORM public.imob_excluir_evento_reserva(r,e,'{}',actor);
  PERFORM public.imob_excluir_evento_reserva(r,e,'{}',actor);
  PERFORM pg_temp.exigir((SELECT estoque=5 FROM public.produto WHERE id=item) AND (SELECT status='CANCELADO' FROM public.eventos_financeiros WHERE id=e),'excluir consumo devolve estoque uma única vez');

  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','DESPESA_PROPRIETARIO','valor',30,'descricao','Despesa para excluir','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
  conta:=(j->>'id')::bigint; versao:=(j->>'updated_at')::timestamptz;
  j:=public.imob_editar_lancamento_reserva(r,conta,'{"descricao":"Despesa corrigida"}',actor);
  BEGIN
    PERFORM public.imob_excluir_lancamento_reserva(r,conta,jsonb_build_object('atualizado_em',versao),actor);
    RAISE EXCEPTION 'aceitou exclusão de versão antiga';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  PERFORM public.imob_excluir_lancamento_reserva(r,conta,'{}',actor);
  PERFORM pg_temp.exigir((SELECT cancelado_em IS NOT NULL FROM public.imovel_lancamento WHERE id=conta)
    AND (SELECT sum(valor)=0 FROM public.imovel_movimento WHERE lancamento_id=conta),'excluir despesa do proprietário remove efeito do extrato');

  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','REPASSE','valor',70,'descricao','Repasse para excluir','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
  conta:=(j->>'id')::bigint;
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador)
    VALUES('Repasse pago',70,70,now(),'DESPESA',true,true,actor,'Proprietário','NAO INFORMADO') RETURNING id INTO tx;
  PERFORM public.imob_vincular_lancamento(conta,tx);
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  j:=public.imob_excluir_lancamento_reserva(r,conta,'{"pode_excluir_financeiro":true}',actor); ajuste:=(j->>'ajuste_transacao_id')::bigint;
  PERFORM pg_temp.exigir((SELECT sum(valor)=0 FROM public.imovel_movimento WHERE lancamento_id=conta)
    AND (SELECT valor=70 AND NOT pendente AND NOT is_deleted FROM public.transacao WHERE id=tx)
    AND (SELECT valor=70 AND tipo::text='RECEITA' AND pendente AND recurso_terceiros FROM public.transacao WHERE id=ajuste)
    AND NOT public.transacao_gera_evento_de_resultado(ajuste),'excluir repasse pago preserva baixa e mantém ajuste fora da DRE');
  PERFORM pg_temp.exigir(NOT has_function_privilege('anon','public.imob_excluir_evento_reserva(bigint,bigint,jsonb,uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.imob_excluir_lancamento_reserva(bigint,bigint,jsonb,uuid)','EXECUTE'),'exclusão acessível somente pelas APIs do ERP');
END $test$;
ROLLBACK;
