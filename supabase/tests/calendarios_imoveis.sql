DO $$
DECLARE owner_id bigint; property_id bigint; channel_id bigint; other_id bigint;
 token uuid:=gen_random_uuid(); token2 uuid:=gen_random_uuid(); q jsonb; r jsonb; occupation_id bigint;
BEGIN
 SELECT id INTO owner_id FROM public.proprietario LIMIT 1;
 IF owner_id IS NULL THEN RAISE EXCEPTION 'Teste requer um proprietário existente.'; END IF;
 INSERT INTO public.imovel(proprietario_id,titulo,slug,diaria) VALUES(owner_id,'Teste iCal isolado',gen_random_uuid()::text,100) RETURNING id INTO property_id;
 INSERT INTO public.imovel_canal_calendario(imovel_id,canal,calendario_url) VALUES(property_id,'AIRBNB','https://www.airbnb.com/calendar/ical/test.ics') RETURNING id INTO channel_id;
 SELECT public.imob_claim_calendario(channel_id,token,true) INTO r;
 IF r IS NULL THEN RAISE EXCEPTION 'Não adquiriu lease.'; END IF;
 IF public.imob_claim_calendario(channel_id,token2,true) IS NOT NULL THEN RAISE EXCEPTION 'Permitiu duas execuções simultâneas.'; END IF;
 PERFORM public.imob_aplicar_calendario(channel_id,token,'https://www.airbnb.com/calendar/ical/test.ics','[{"uid":"one","inicio":"2090-01-10","fim":"2090-01-13"}]');
 SELECT id INTO occupation_id FROM public.imovel_ocupacao WHERE canal_calendario_id=channel_id AND ativo;
 IF occupation_id IS NULL THEN RAISE EXCEPTION 'Não bloqueou disponibilidade.'; END IF;
 SELECT public.imob_cotar_reserva(property_id,'2090-01-10','2090-01-12',1) INTO q;
 IF (q->>'disponivel')::boolean THEN RAISE EXCEPTION 'Cotação do site ignorou calendário externo.'; END IF;
 BEGIN
  INSERT INTO public.imovel_ocupacao(imovel_id,tipo,inicio,fim,motivo) VALUES(property_id,'BLOQUEIO','2090-01-11','2090-01-12','teste');
  RAISE EXCEPTION 'Permitiu ocupação interna sobre externa.';
 EXCEPTION WHEN exclusion_violation THEN NULL; END;
 UPDATE public.imovel_canal_calendario SET ultima_tentativa=NULL WHERE id=channel_id;
 PERFORM public.imob_claim_calendario(channel_id,token,true);
 PERFORM public.imob_aplicar_calendario(channel_id,token,'https://www.airbnb.com/calendar/ical/test.ics','[{"uid":"one","inicio":"2090-01-11","fim":"2090-01-14"}]');
 IF NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE id=occupation_id AND inicio='2090-01-11' AND fim='2090-01-14') THEN RAISE EXCEPTION 'Não atualizou período de UID existente.'; END IF;
 INSERT INTO public.imovel_canal_calendario(imovel_id,canal,calendario_url) VALUES(property_id,'BOOKING','https://ical.booking.com/v1/export?t=test') RETURNING id INTO other_id;
 PERFORM public.imob_claim_calendario(other_id,token2,true);
 SELECT public.imob_aplicar_calendario(other_id,token2,'https://ical.booking.com/v1/export?t=test','[{"uid":"two","inicio":"2090-01-12","fim":"2090-01-15"}]') INTO r;
 IF (r->>'conflitos')::integer<>1 THEN RAISE EXCEPTION 'Não registrou conflito entre canais.'; END IF;
 UPDATE public.imovel_canal_calendario SET ultima_tentativa=NULL WHERE id=channel_id;
 PERFORM public.imob_claim_calendario(channel_id,token,true);
 -- Uma URL alterada enquanto a leitura acontece não pode aplicar um snapshot antigo.
 BEGIN
  PERFORM public.imob_aplicar_calendario(channel_id,token,'https://www.airbnb.com/calendar/ical/old.ics','[]');
  RAISE EXCEPTION 'Não rejeitou URL antiga.';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Não rejeitou URL antiga.' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE id=occupation_id AND ativo) THEN RAISE EXCEPTION 'Falha liberou ocupação.'; END IF;
 PERFORM public.imob_aplicar_calendario(channel_id,token,'https://www.airbnb.com/calendar/ical/test.ics','[]');
 IF EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE id=occupation_id AND ativo) THEN RAISE EXCEPTION 'Cancelamento não liberou a origem.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE canal_calendario_id=other_id AND ativo) THEN RAISE EXCEPTION 'Cancelamento liberou outro canal.'; END IF;
 SELECT public.imob_cotar_reserva(property_id,'2090-01-12','2090-01-14',1) INTO q;
 IF (q->>'disponivel')::boolean THEN RAISE EXCEPTION 'Cancelamento de uma origem reabriu datas da outra.'; END IF;
 DELETE FROM public.imovel_canal_calendario WHERE id=other_id;
 IF EXISTS(SELECT 1 FROM public.imovel_ocupacao WHERE canal_calendario_id=other_id) THEN RAISE EXCEPTION 'Desconexão não limpou ocupações próprias.'; END IF;
 RAISE NOTICE 'Cenários iCal: lease, alteração, conflitos, cotação do site, cancelamento e desconexão passaram.';
END $$;
