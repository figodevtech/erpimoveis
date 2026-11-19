DO $$
DECLARE owner_id bigint; p1 bigint; p2 bigint; v_id bigint; repeat_id bigint; source_id bigint; token uuid:=gen_random_uuid(); quote jsonb;
BEGIN
 SELECT id INTO owner_id FROM public.proprietario LIMIT 1;
 IF owner_id IS NULL THEN RAISE EXCEPTION 'Teste requer proprietário.'; END IF;
 INSERT INTO public.imovel(proprietario_id,titulo,slug,diaria) VALUES(owner_id,'Teste Stays 1',gen_random_uuid()::text,100) RETURNING id INTO p1;
 INSERT INTO public.imovel(proprietario_id,titulo,slug,diaria) VALUES(owner_id,'Teste Stays 2',gen_random_uuid()::text,100) RETURNING id INTO p2;
 SELECT public.imob_vincular_stays('test-account',p1,'listing1','CODE1','Teste','https://test.stays.net/external/v1/booking/reservations') INTO v_id;
 SELECT public.imob_vincular_stays('test-account',p1,'listing1','CODE1','Teste','https://test.stays.net/external/v1/booking/reservations') INTO repeat_id;
 IF repeat_id<>v_id THEN RAISE EXCEPTION 'Repetição duplicou vínculo.'; END IF;
 BEGIN
  PERFORM public.imob_vincular_stays('test-account',p2,'listing1','CODE1','Teste','https://test.stays.net/external/v1/booking/reservations');
  RAISE EXCEPTION 'Permitiu anúncio vinculado a dois imóveis.';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.imovel_canal_calendario WHERE imovel_id=p2) THEN RAISE EXCEPTION 'Falha criou origem órfã.'; END IF;
 BEGIN
  PERFORM public.imob_vincular_stays('another-account',p1,'listing2','CODE2','Teste','https://other.stays.net/external/v1/booking/reservations');
  RAISE EXCEPTION 'Permitiu substituir conta silenciosamente.';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Permitiu substituir conta silenciosamente.' THEN RAISE; END IF; END;
 SELECT canal_id INTO source_id FROM public.imovel_stays_vinculo WHERE id=v_id;
 PERFORM public.imob_claim_calendario(source_id,token,true);
 PERFORM public.imob_aplicar_calendario(source_id,token,'https://test.stays.net/external/v1/booking/reservations','[{"uid":"stays:res1","inicio":"2090-01-10","fim":"2090-01-15"}]');
 SELECT public.imob_cotar_reserva(p1,'2090-01-11','2090-01-13',1) INTO quote;
 IF (quote->>'disponivel')::boolean THEN RAISE EXCEPTION 'Site ignorou reserva Stays.'; END IF;
 -- Um novo webhook pode atualizar imediatamente após a consulta anterior, sem aguardar polling.
 IF public.imob_claim_calendario(source_id,token,true) IS NULL THEN RAISE EXCEPTION 'Webhook foi bloqueado pela janela de 30 segundos.'; END IF;
 PERFORM public.imob_aplicar_calendario(source_id,token,'https://test.stays.net/external/v1/booking/reservations','[]');
 IF EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE canal_calendario_id=source_id AND ativo) THEN RAISE EXCEPTION 'Cancelamento Stays não liberou o período.'; END IF;
 INSERT INTO public.stays_webhook_recebimento(conta,recibo,acao,listing_id) VALUES('test-account','receipt','reservation.created','listing1');
 INSERT INTO public.stays_webhook_recebimento(conta,recibo,acao,listing_id) VALUES('test-account','receipt','reservation.created','listing1') ON CONFLICT DO NOTHING;
 IF (SELECT count(*) FROM public.stays_webhook_recebimento WHERE conta='test-account' AND recibo='receipt')<>1 THEN RAISE EXCEPTION 'Recibo duplicado.'; END IF;
 DELETE FROM public.imovel_canal_calendario WHERE id=source_id;
 IF EXISTS(SELECT 1 FROM public.imovel_stays_vinculo WHERE id=v_id) THEN RAISE EXCEPTION 'Desvinculação não removeu vínculo.'; END IF;
 RAISE NOTICE 'Stays: vínculos, isolamento de conta, recibos, ocupação do site e cancelamento passaram.';
END $$;
