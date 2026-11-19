BEGIN;
ALTER TABLE public.imovel_canal_calendario
 ADD COLUMN ultima_tentativa timestamptz,
 ADD COLUMN ultima_sincronizacao timestamptz,
 ADD COLUMN ultimo_erro text,
 ADD COLUMN eventos_ativos integer NOT NULL DEFAULT 0,
 ADD COLUMN conflitos integer NOT NULL DEFAULT 0,
 ADD COLUMN sincronizacao_token uuid,
 ADD COLUMN sincronizacao_ate timestamptz;

ALTER TABLE public.imovel_ocupacao
 ADD COLUMN canal_calendario_id bigint REFERENCES public.imovel_canal_calendario(id) ON DELETE CASCADE,
 ADD COLUMN calendario_uid text;
CREATE UNIQUE INDEX imovel_ocupacao_calendario_uid ON public.imovel_ocupacao(canal_calendario_id,calendario_uid);
ALTER TABLE public.imovel_ocupacao DROP CONSTRAINT imovel_ocupacao_sem_sobreposicao;
ALTER TABLE public.imovel_ocupacao ADD CONSTRAINT imovel_ocupacao_sem_sobreposicao
 EXCLUDE USING gist (imovel_id WITH =, periodo WITH &&) WHERE (ativo AND canal_calendario_id IS NULL);

-- Importações precisam registrar conflitos existentes sem perder o bloqueio de nenhuma origem.
-- Novas operações internas continuam proibidas sobre qualquer ocupação externa ativa.
CREATE FUNCTION public.imob_proteger_ocupacao_externa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.imovel WHERE id=NEW.imovel_id FOR UPDATE;
 IF NEW.ativo AND NEW.canal_calendario_id IS NULL AND EXISTS (
   SELECT 1 FROM public.imovel_ocupacao o WHERE o.imovel_id=NEW.imovel_id
   AND o.ativo AND o.canal_calendario_id IS NOT NULL AND o.id<>NEW.id
   AND o.periodo && daterange(NEW.inicio,NEW.fim,'[)')
 ) THEN RAISE EXCEPTION 'O imóvel está ocupado por um calendário externo neste período.' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER imob_proteger_ocupacao_externa BEFORE INSERT OR UPDATE ON public.imovel_ocupacao
 FOR EACH ROW EXECUTE FUNCTION public.imob_proteger_ocupacao_externa();

CREATE FUNCTION public.imob_claim_calendario(p_id bigint,p_token uuid,p_forcar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.imovel_canal_calendario;
BEGIN
 UPDATE public.imovel_canal_calendario SET sincronizacao_token=p_token,
 sincronizacao_ate=now()+interval '2 minutes',ultima_tentativa=now()
 WHERE id=p_id AND (sincronizacao_ate IS NULL OR sincronizacao_ate<now())
 AND (ultima_tentativa IS NULL OR ultima_tentativa<now()-CASE WHEN p_forcar THEN interval '30 seconds' ELSE interval '15 minutes' END)
 RETURNING * INTO c;
 RETURN CASE WHEN c.id IS NULL THEN NULL ELSE to_jsonb(c) END;
END $$;

CREATE FUNCTION public.imob_aplicar_calendario(p_id bigint,p_token uuid,p_url text,p_eventos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.imovel_canal_calendario; e jsonb; v_count integer; v_conflicts integer;
BEGIN
 SELECT * INTO c FROM public.imovel_canal_calendario WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR c.sincronizacao_token IS DISTINCT FROM p_token OR c.calendario_url<>p_url
 OR c.sincronizacao_ate<now() THEN RAISE EXCEPTION 'Sincronização desatualizada.'; END IF;
 IF jsonb_typeof(p_eventos)<>'array' OR jsonb_array_length(p_eventos)>10000 THEN RAISE EXCEPTION 'Calendário inválido.'; END IF;
 PERFORM 1 FROM public.imovel WHERE id=c.imovel_id FOR UPDATE;
 FOR e IN SELECT value FROM jsonb_array_elements(p_eventos) LOOP
  INSERT INTO public.imovel_ocupacao(imovel_id,tipo,inicio,fim,ativo,motivo,canal_calendario_id,calendario_uid)
  VALUES(c.imovel_id,'BLOQUEIO',(e->>'inicio')::date,(e->>'fim')::date,true,'Reserva/bloqueio · '||c.canal,c.id,e->>'uid')
  ON CONFLICT(canal_calendario_id,calendario_uid) DO UPDATE SET
   inicio=EXCLUDED.inicio,fim=EXCLUDED.fim,ativo=true,updated_at=now();
 END LOOP;
 UPDATE public.imovel_ocupacao SET ativo=false,updated_at=now()
 WHERE canal_calendario_id=c.id AND ativo AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_eventos) AS incoming(value) WHERE incoming.value->>'uid'=calendario_uid);
 SELECT count(*) INTO v_count FROM public.imovel_ocupacao WHERE canal_calendario_id=c.id AND ativo;
 SELECT count(*) INTO v_conflicts FROM public.imovel_ocupacao a WHERE a.canal_calendario_id=c.id AND a.ativo
 AND EXISTS (SELECT 1 FROM public.imovel_ocupacao b WHERE b.imovel_id=a.imovel_id AND b.ativo AND b.id<>a.id
 AND b.canal_calendario_id IS DISTINCT FROM a.canal_calendario_id AND b.periodo&&a.periodo);
 UPDATE public.imovel_canal_calendario SET ultima_sincronizacao=now(),ultimo_erro=NULL,eventos_ativos=v_count,conflitos=v_conflicts,
 sincronizacao_token=NULL,sincronizacao_ate=NULL WHERE id=c.id;
 RETURN jsonb_build_object('eventos',v_count,'conflitos',v_conflicts);
END $$;

REVOKE ALL ON FUNCTION public.imob_proteger_ocupacao_externa() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.imob_claim_calendario(bigint,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.imob_aplicar_calendario(bigint,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_claim_calendario(bigint,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.imob_aplicar_calendario(bigint,uuid,text,jsonb) TO service_role;
COMMIT;
