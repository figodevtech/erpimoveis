-- Exclusão definitiva da reserva (20261120120000). Sempre revertido.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.exigir(p_ok boolean,p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALHOU: %',p_msg; END IF; RAISE NOTICE 'OK: %',p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cpf(p_base text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text:=p_base; s integer; d integer; j integer; k integer;
BEGIN FOR k IN 10..11 LOOP s:=0; FOR j IN 1..k-1 LOOP s:=s+substring(v,j,1)::integer*(k+1-j); END LOOP; d:=(s*10)%11; IF d=10 THEN d:=0; END IF; v:=v||d; END LOOP; RETURN v; END $$;

DO $test$
DECLARE
  actor uuid; c integer; p bigint; i bigint; r bigint; r2 bigint; b bigint; tx bigint; extra bigint; repasse bigint;
  conta bigint; despesa bigint; e bigint; grupo bigint; item integer; j jsonb; recusou boolean; mov bigint;
  txs bigint[]; lancs bigint[]; eventos bigint[]; movs bigint[];
BEGIN
  SELECT id INTO actor FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  PERFORM pg_temp.exigir(actor IS NOT NULL,'usuário ativo disponível para testar');
  PERFORM set_config('app.audit_user_id',actor::text,true);
  INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,status)
    VALUES('FISICA',pg_temp.cpf('995120001'),'Teste exclusão de reserva','ATIVO') RETURNING id INTO c;
  INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,created_by)
    VALUES('Proprietário teste exclusão de reserva',pg_temp.cpf('995120002'),actor) RETURNING id INTO p;
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,taxa_limpeza,percentual_admin,created_by)
    VALUES(p,'Imóvel teste exclusão de reserva',gen_random_uuid()::text,ARRAY['TEMPORADA'],2,100,0,10,actor) RETURNING id INTO i;
  INSERT INTO public.bancoconta(titulo,valorinicial,created_at,updated_at) VALUES('Banco teste exclusão de reserva',0,now(),now()) RETURNING id INTO b;

  -- 1) Reserva só com a cobrança em aberto: sai sem pedir confirmação de valores.
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date+30,'fim',current_date+32,
      'hospedes',1,'origem','ERP','ignorar_regras',true,'idempotency_key',gen_random_uuid()),actor);
  r:=(j->>'id')::bigint;
  -- A reserva do ERP nasce sem cobrança: o pagamento é lançado no financeiro, ligado a ela.
  PERFORM public.imob_criar_titulo(i,p,c,200,current_date+30,10,'TESTE:'||gen_random_uuid(),'Recebimento da reserva',actor,r);
  j:=public.imob_excluir_reserva(r,actor);
  PERFORM pg_temp.exigir(NOT (j->>'excluido')::boolean AND NOT (j->>'movimentou')::boolean AND jsonb_array_length(j->'bloqueios')=0
      AND (j#>>'{itens,a_receber,quantidade}')::int=1 AND (j#>>'{itens,a_receber,valor}')::numeric=200,
    'impacto de reserva só com cobrança em aberto: sem bloqueio e sem dinheiro movimentado');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r),'o impacto não apaga nada');
  j:=public.imob_excluir_reserva(r,actor,true,false);
  PERFORM pg_temp.exigir((j->>'excluido')::boolean
      AND NOT EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r)
      AND NOT EXISTS(SELECT 1 FROM public.transacao WHERE reserva_imovel_id=r)
      AND NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE reserva_id=r),
    'reserva só com cobrança em aberto sai com a cobrança e libera o calendário');

  -- 2) Reserva com tudo: recebida (parte em baixa parcial), repasse pago, despesa do proprietário,
  --    custo lançado no financeiro, consumo de estoque, check-out com limpeza e arquivo.
  j:=public.imob_salvar_reserva(jsonb_build_object('imovel_id',i,'cliente_id',c,'inicio',current_date,'fim',current_date+2,
      'hospedes',1,'origem','ERP','ignorar_regras',true,'idempotency_key',gen_random_uuid()),actor);
  r2:=(j->>'id')::bigint;
  tx:=public.imob_criar_titulo(i,p,c,200,current_date,10,'TESTE:'||gen_random_uuid(),'Recebimento da reserva',actor,r2);
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  extra:=public.imob_criar_titulo(i,p,c,50,current_date,10,'TESTE:'||gen_random_uuid(),'Taxa extra da reserva',actor,r2);
  PERFORM public.baixar_transacao_pendente(extra,now(),b,'PIX',NULL,NULL,actor,20);
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.transacao WHERE baixa_de_transacao_id=extra),'cenário: baixa parcial da taxa extra');

  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','REPASSE','valor',100,'descricao','Repasse da reserva','imovel_id',i,
      'proprietario_id',p,'reserva_id',r2,'idempotency_key',gen_random_uuid()),actor);
  conta:=(j->>'id')::bigint;
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador)
    VALUES('Repasse da reserva',100,100,now(),'DESPESA',true,true,actor,'Proprietário','NAO INFORMADO') RETURNING id INTO repasse;
  PERFORM public.imob_vincular_lancamento(conta,repasse);
  PERFORM public.baixar_transacao_pendente(repasse,now(),b,'PIX',NULL,NULL,actor);
  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','DESPESA_PROPRIETARIO','valor',30,'descricao','Despesa do proprietário','imovel_id',i,
      'proprietario_id',p,'reserva_id',r2,'idempotency_key',gen_random_uuid()),actor);
  despesa:=(j->>'id')::bigint;

  j:=public.imob_criar_evento_reserva(r2,'Faxina terceirizada',NULL,40,current_date,actor); e:=(j->>'id')::bigint;
  grupo:=public.registrar_lancamento_de_eventos(jsonb_build_object('eventos_ids',jsonb_build_array(e),'created_by',actor,'pendente',true,
    'linhas',jsonb_build_array(jsonb_build_object('parcela',1,'valor',40))));

  -- Banco sem os tipos do estoque: o produto de teste precisa de um grupo e da unidade 1 (default de produto).
  IF NOT EXISTS(SELECT 1 FROM public.produtogrupo) THEN INSERT INTO public.produtogrupo(nome) VALUES('GRUPO TESTE EXCLUSÃO DE RESERVA'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.unidademedida WHERE id=1) THEN
    INSERT INTO public.unidademedida(id,sigla,descricao) OVERRIDING SYSTEM VALUE VALUES(1,'UN','UNIDADE');
  END IF;
  INSERT INTO public.tipos_motivo_saida(codigo,nome,descricao,escopo)
    VALUES('CONSUMO_EM_RESERVA','Consumo em reserva','Material gasto numa reserva.','AMBOS')
  ON CONFLICT(codigo) DO UPDATE SET ativo=true;
  INSERT INTO public.produto(titulo,precovenda,estoque,grupo_produto_id)
    VALUES('Material teste exclusão de reserva',10,5,(SELECT min(id) FROM public.produtogrupo)) RETURNING id INTO item;
  PERFORM public.imob_registrar_consumo_reserva(jsonb_build_object('reserva_id',r2,'escopo','PRODUTO','item_id',item,'quantidade',2,'valor',4,'created_by',actor));
  PERFORM pg_temp.exigir((SELECT estoque=3 FROM public.produto WHERE id=item),'cenário: consumo baixa o estoque');

  PERFORM public.imob_acao_reserva(r2,'CHECKIN','{}',actor);
  PERFORM public.imob_acao_reserva(r2,'CHECKOUT',jsonb_build_object('solicitar_limpeza',true,'responsavel_limpeza_id',actor),actor);
  INSERT INTO public.imovel_arquivo(imovel_id,reserva_id,tipo,bucket,path,nome,created_by)
    VALUES(i,r2,'DOCUMENTO','imoveis-documentos','teste/reservas/'||r2||'/'||gen_random_uuid()||'/contrato.pdf','contrato.pdf',actor);
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.imovel_movimento WHERE proprietario_id=p)
      AND EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r2 AND origem='RECEITA_RESERVA')
      AND EXISTS(SELECT 1 FROM public.imovel_servico WHERE reserva_id=r2),
    'cenário: extrato do proprietário, receita da reserva na DRE e limpeza');

  SELECT array_agg(id) INTO txs FROM public.transacao
   WHERE reserva_imovel_id=r2 OR id IN (repasse,extra) OR lancamento_id=grupo OR baixa_de_transacao_id IN (tx,extra);
  SELECT array_agg(id) INTO lancs FROM public.imovel_lancamento WHERE reserva_id=r2;
  SELECT array_agg(id) INTO eventos FROM public.eventos_financeiros
   WHERE (source_type='RESERVA' AND source_id=r2) OR (source_type='IMOVEL_TAXA' AND source_id=ANY(txs));
  SELECT array_agg(id) INTO movs FROM public.imovel_movimento WHERE proprietario_id=p;

  -- O extrato continua histórico fora da exclusão da reserva.
  SELECT id INTO mov FROM public.imovel_movimento WHERE proprietario_id=p ORDER BY id LIMIT 1;
  BEGIN
    DELETE FROM public.imovel_movimento WHERE id=mov;
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'fora da exclusão da reserva o extrato do proprietário não se apaga');

  j:=public.imob_excluir_reserva(r2,actor);
  PERFORM pg_temp.exigir((j->>'movimentou')::boolean AND jsonb_array_length(j->'bloqueios')=0,'reserva com dinheiro movimentado pede confirmação e não tem bloqueio');
  PERFORM pg_temp.exigir((j#>>'{itens,recebido,valor}')::numeric=220 AND (j#>>'{itens,a_receber,valor}')::numeric=30
      AND (j#>>'{itens,pago,valor}')::numeric=100 AND (j#>>'{itens,a_pagar,valor}')::numeric=40
      AND (j#>>'{itens,lancamentos_proprietario,quantidade}')::int=2 AND (j#>>'{itens,consumo,quantidade}')::int=1
      AND (j#>>'{itens,servicos,quantidade}')::int=1 AND (j#>>'{itens,arquivos,quantidade}')::int=1
      AND (j#>>'{itens,extrato,quantidade}')::int>0,
    'impacto lista recebido, em aberto, pago, a pagar, lançamentos, consumo, limpeza, arquivo e extrato: '||(j->'itens')::text);

  BEGIN
    PERFORM public.imob_excluir_reserva(r2,actor,true,false);
    recusou:=false;
  EXCEPTION WHEN others THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou AND EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r2),'sem confirmar os valores a exclusão é recusada');

  j:=public.imob_excluir_reserva(r2,actor,true,true);
  PERFORM pg_temp.exigir((j->>'excluido')::boolean AND NOT EXISTS(SELECT 1 FROM public.reserva_imovel WHERE id=r2),'reserva com valores confirmados é excluída');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.transacao WHERE id=ANY(txs)) AND NOT EXISTS(SELECT 1 FROM public.transacao WHERE banco_id=b),
    'cobranças, recebimentos, baixas, repasse e custo saem do financeiro e do banco');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_movimento WHERE proprietario_id=p),'extrato do proprietário fica sem nada da reserva');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_lancamento WHERE id=ANY(lancs))
      AND NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE id=ANY(eventos))
      AND NOT EXISTS(SELECT 1 FROM public.eventos_financeiros WHERE source_type='RESERVA' AND source_id=r2)
      AND NOT EXISTS(SELECT 1 FROM public.lancamento_de_eventos WHERE id=grupo),
    'lançamentos do proprietário, eventos da DRE e o lançamento de custos saem');
  PERFORM pg_temp.exigir((SELECT estoque=5 FROM public.produto WHERE id=item),'consumo de estoque volta ao estoque');
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_servico WHERE reserva_id=r2)
      AND NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE reserva_id=r2)
      AND NOT EXISTS(SELECT 1 FROM public.imovel_arquivo WHERE reserva_id=r2)
      AND jsonb_array_length(j->'arquivos')=1,
    'limpeza, calendário e arquivo saem; a API recebe o arquivo para limpar o storage');
  PERFORM pg_temp.exigir((SELECT count(*)=cardinality(movs) FROM public.auditoria_evento
      WHERE tabela='imovel_movimento' AND operacao='DELETE' AND registro_id=ANY(SELECT unnest(movs)::text)),
    'a auditoria guarda cada linha apagada do extrato');
  PERFORM pg_temp.exigir(EXISTS(SELECT 1 FROM public.auditoria_evento WHERE tabela='reserva_imovel' AND operacao='DELETE' AND registro_id=r2::text),
    'a auditoria guarda a reserva excluída');
  PERFORM pg_temp.exigir(coalesce(current_setting('app.imob_excluir_movimentos',true),'')='','a exceção do extrato não fica ligada depois da exclusão');

  BEGIN
    PERFORM public.imob_excluir_reserva(r2,actor);
    recusou:=false;
  EXCEPTION WHEN no_data_found THEN recusou:=true;
  END;
  PERFORM pg_temp.exigir(recusou,'reserva excluída não é encontrada de novo');
END $test$;
ROLLBACK;
