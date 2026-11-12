BEGIN;
-- 20261112120000: o repasse liquida a dívida com o proprietário só quando é pago.

CREATE OR REPLACE FUNCTION pg_temp.exigir(p_ok boolean,p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALHOU: %',p_msg; END IF; RAISE NOTICE 'OK: %',p_msg; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cpf(p_base text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text:=p_base; s integer; d integer; j integer; k integer;
BEGIN FOR k IN 10..11 LOOP s:=0; FOR j IN 1..k-1 LOOP s:=s+substring(v,j,1)::integer*(k+1-j); END LOOP; d:=(s*10)%11; IF d=10 THEN d:=0; END IF; v:=v||d; END LOOP; RETURN v; END $$;

DO $test$
DECLARE
  actor uuid; c integer; p bigint; i bigint; r bigint; b bigint; tx bigint; conta bigint; j jsonb;
  saldo numeric;
BEGIN
  SELECT id INTO actor FROM public.usuario WHERE ativo ORDER BY id LIMIT 1;
  PERFORM set_config('app.audit_user_id',actor::text,true);
  INSERT INTO public.cliente(tipopessoa,cpfcnpj,nomerazaosocial,status)
    VALUES('FISICA',pg_temp.cpf('995004001'),'Teste repasse no pagamento','ATIVO') RETURNING id INTO c;
  INSERT INTO public.proprietario(nomerazaosocial,cpfcnpj,created_by)
    VALUES('Proprietário teste repasse',pg_temp.cpf('995004002'),actor) RETURNING id INTO p;
  INSERT INTO public.imovel(proprietario_id,titulo,slug,modalidades,capacidade,diaria,percentual_admin,created_by)
    VALUES(p,'Imóvel teste repasse',gen_random_uuid()::text,ARRAY['TEMPORADA'],2,100,14,actor) RETURNING id INTO i;
  INSERT INTO public.reserva_imovel(imovel_id,cliente_id,proprietario_id,inicio,fim,hospedes,valor_diarias,valor_total,percentual_admin,idempotency_key,payload_hash,created_by)
    VALUES(i,c,p,current_date+40,current_date+42,1,1000,1000,14,gen_random_uuid()::text,'teste',actor) RETURNING id INTO r;
  INSERT INTO public.bancoconta(titulo,valorinicial,created_at,updated_at) VALUES('Banco teste repasse',0,now(),now()) RETURNING id INTO b;

  -- O exemplo: R$ 1.000 recebidos, 14% de taxa, R$ 860 de repasse.
  tx:=public.imob_criar_titulo(i,p,c,1000,current_date,14,'TESTE:'||gen_random_uuid(),'Recebimento da reserva',actor,r);
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  SELECT sum(CASE WHEN tipo='BRUTO_RECEBIDO' THEN valor ELSE -valor END) INTO saldo FROM public.imovel_movimento WHERE proprietario_id=p;
  PERFORM pg_temp.exigir(saldo=860,'recebimento menos a taxa vira dívida com o proprietário');
  PERFORM pg_temp.exigir((SELECT competencia_em=((current_date+42)+time '12:00') AT TIME ZONE 'America/Fortaleza'
      FROM public.eventos_financeiros WHERE source_type='IMOVEL_TAXA' AND source_id=tx AND natureza='RECEITA'),
    'pagamento antecipado: a taxa fica no mês do check-out');

  -- Registrar o repasse não quita a dívida.
  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','REPASSE','valor',860,'descricao','Repasse ao proprietário','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
  conta:=(j->>'id')::bigint;
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_movimento WHERE lancamento_id=conta),'repasse registrado não entra no extrato');

  -- Lançado no financeiro, ainda a pagar: continua devido.
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador)
    VALUES('Repasse ao proprietário',860,860,now(),'DESPESA',true,true,actor,'Proprietário','NAO INFORMADO') RETURNING id INTO tx;
  PERFORM public.imob_vincular_lancamento(conta,tx);
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_movimento WHERE lancamento_id=conta),'repasse a pagar não quita a dívida');

  -- Pago: quita, na data do pagamento e ligado à reserva.
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  PERFORM pg_temp.exigir((SELECT sum(valor)=860 FROM public.imovel_movimento WHERE lancamento_id=conta AND tipo='REPASSE')
    AND NOT EXISTS(SELECT 1 FROM public.imovel_movimento WHERE lancamento_id=conta AND reserva_id IS DISTINCT FROM r),
    'baixa do repasse quita a dívida e o movimento leva a reserva');
  SELECT sum(CASE WHEN tipo='BRUTO_RECEBIDO' THEN valor ELSE -valor END) INTO saldo FROM public.imovel_movimento WHERE proprietario_id=p;
  PERFORM pg_temp.exigir(saldo=0,'depois do repasse pago a dívida com o proprietário é zero');
  PERFORM pg_temp.exigir(NOT public.transacao_gera_evento_de_resultado(tx),'repasse pago não vira despesa na DRE');

  -- Excluída a transação, a dívida volta.
  UPDATE public.transacao SET is_deleted=true WHERE id=tx;
  PERFORM pg_temp.exigir((SELECT sum(valor)=0 FROM public.imovel_movimento WHERE lancamento_id=conta),'transação do repasse excluída devolve a dívida');

  -- Já pago antes de vincular: o vínculo quita na hora.
  INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador)
    VALUES('Repasse refeito',860,860,now(),'DESPESA',true,true,actor,'Proprietário','NAO INFORMADO') RETURNING id INTO tx;
  PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
  PERFORM public.imob_vincular_lancamento(conta,tx);
  PERFORM pg_temp.exigir((SELECT sum(valor)=860 FROM public.imovel_movimento WHERE lancamento_id=conta),'vincular transação já paga quita a dívida');

  -- Repasse estornado sem nunca ter sido pago não deixa rastro no saldo.
  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','REPASSE','valor',50,'descricao','Repasse desistido','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
  conta:=(j->>'id')::bigint;
  PERFORM public.imob_cancelar_lancamento(conta,actor);
  PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_movimento WHERE lancamento_id=conta),'estornar repasse não pago não mexe no extrato');

  -- Tipo REPASSE (20261112130000/130100): só quando o valor do enum já está gravado no banco.
  IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.tipos_transacao'::regtype AND enumlabel='REPASSE') THEN
    j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','REPASSE','valor',200,'descricao','Repasse com tipo próprio','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
    conta:=(j->>'id')::bigint;
    EXECUTE $q$INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador)
      VALUES('Repasse tipo REPASSE',200,200,now(),'REPASSE',true,true,$1,'Proprietário','NAO INFORMADO') RETURNING id$q$ INTO tx USING actor;
    PERFORM public.imob_vincular_lancamento(conta,tx);
    PERFORM pg_temp.exigir(NOT EXISTS(SELECT 1 FROM public.imovel_movimento WHERE lancamento_id=conta),'repasse REPASSE a pagar não quita a dívida');
    PERFORM public.baixar_transacao_pendente(tx,now(),b,'PIX',NULL,NULL,actor);
    PERFORM pg_temp.exigir((SELECT sum(valor)=200 FROM public.imovel_movimento WHERE lancamento_id=conta),'repasse REPASSE pago quita a dívida');
    PERFORM pg_temp.exigir(NOT public.transacao_gera_evento_de_resultado(tx),'tipo REPASSE fica fora da DRE');
    -- Despesa do proprietário não aceita transação REPASSE.
    j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','DESPESA_PROPRIETARIO','valor',10,'descricao','Despesa não é repasse','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
    EXECUTE $q$INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,tipo,pendente,recurso_terceiros,created_by,nomepagador,cpfcnpjpagador)
      VALUES('Tipo errado',10,10,now(),'REPASSE',true,true,$1,'Fornecedor','NAO INFORMADO') RETURNING id$q$ INTO tx USING actor;
    BEGIN
      PERFORM public.imob_vincular_lancamento((j->>'id')::bigint,tx);
      RAISE EXCEPTION 'aceitou REPASSE numa despesa do proprietário';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    PERFORM pg_temp.exigir(true,'despesa do proprietário recusa transação REPASSE');
  ELSE
    RAISE NOTICE 'PULADO: cenários do tipo REPASSE (enum ainda sem o valor gravado)';
  END IF;

  -- Despesa do proprietário continua abatendo na hora, já com a reserva.
  j:=public.imob_registrar_lancamento(jsonb_build_object('tipo','DESPESA_PROPRIETARIO','valor',30,'descricao','Limpeza','imovel_id',i,'proprietario_id',p,'reserva_id',r,'idempotency_key',gen_random_uuid()),actor);
  conta:=(j->>'id')::bigint;
  PERFORM pg_temp.exigir((SELECT sum(valor)=30 AND bool_and(reserva_id=r) FROM public.imovel_movimento WHERE lancamento_id=conta),'despesa do proprietário abate na hora e leva a reserva');
  PERFORM public.imob_cancelar_lancamento(conta,actor);
  PERFORM pg_temp.exigir((SELECT sum(valor)=0 FROM public.imovel_movimento WHERE lancamento_id=conta),'estorno da despesa devolve o valor');
END $test$;
ROLLBACK;
