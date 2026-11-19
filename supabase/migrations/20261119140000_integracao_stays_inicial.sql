BEGIN;
ALTER TABLE public.imovel_canal_calendario DROP CONSTRAINT imovel_canal_calendario_canal_check;
ALTER TABLE public.imovel_canal_calendario ADD CONSTRAINT imovel_canal_calendario_canal_check CHECK(canal IN ('AIRBNB','BOOKING','STAYS'));

CREATE TABLE public.imovel_stays_vinculo (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conta text NOT NULL,
 imovel_id bigint NOT NULL UNIQUE REFERENCES public.imovel(id) ON DELETE CASCADE,
 listing_id text NOT NULL,
 listing_codigo text NOT NULL,
 listing_titulo text NOT NULL,
 canal_id bigint NOT NULL UNIQUE REFERENCES public.imovel_canal_calendario(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conta,listing_id)
);
ALTER TABLE public.imovel_stays_vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imovel_stays_vinculo FROM anon,authenticated;
GRANT ALL ON public.imovel_stays_vinculo TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.imovel_stays_vinculo_id_seq TO service_role;

CREATE TABLE public.stays_webhook_recebimento (
 conta text NOT NULL,
 recibo text NOT NULL,
 acao text NOT NULL,
 listing_id text,
 recebido_em timestamptz NOT NULL DEFAULT now(),
 processado_em timestamptz,
 erro text,
 PRIMARY KEY(conta,recibo)
);
ALTER TABLE public.stays_webhook_recebimento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stays_webhook_recebimento FROM anon,authenticated;
GRANT ALL ON public.stays_webhook_recebimento TO service_role;

CREATE FUNCTION public.imob_vincular_stays(p_conta text,p_imovel_id bigint,p_listing_id text,p_codigo text,p_titulo text,p_url text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_canal bigint; v_id bigint; old public.imovel_stays_vinculo;
BEGIN
 PERFORM 1 FROM public.imovel WHERE id=p_imovel_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Imóvel não encontrado.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO old FROM public.imovel_stays_vinculo WHERE imovel_id=p_imovel_id FOR UPDATE;
 IF old.id IS NOT NULL THEN
  IF old.conta=p_conta AND old.listing_id=p_listing_id THEN RETURN old.id; END IF;
  RAISE EXCEPTION 'Desvincule o anúncio atual antes de trocar a conexão Stays.';
 END IF;
 INSERT INTO public.imovel_canal_calendario(imovel_id,canal,calendario_url,anuncio)
 VALUES(p_imovel_id,'STAYS',p_url,p_titulo) RETURNING id INTO v_canal;
 INSERT INTO public.imovel_stays_vinculo(conta,imovel_id,listing_id,listing_codigo,listing_titulo,canal_id)
 VALUES(p_conta,p_imovel_id,p_listing_id,p_codigo,p_titulo,v_canal) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.imob_vincular_stays(text,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.imob_vincular_stays(text,bigint,text,text,text,text) TO service_role;

-- Webhooks não aguardam a janela de polling do iCal; a lease continua impedindo snapshots concorrentes.
CREATE OR REPLACE FUNCTION public.imob_claim_calendario(p_id bigint,p_token uuid,p_forcar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.imovel_canal_calendario;
BEGIN
 UPDATE public.imovel_canal_calendario SET sincronizacao_token=p_token,
 sincronizacao_ate=now()+interval '2 minutes',ultima_tentativa=now()
 WHERE id=p_id AND (sincronizacao_ate IS NULL OR sincronizacao_ate<now())
 AND ((p_forcar AND canal='STAYS') OR ultima_tentativa IS NULL OR ultima_tentativa<now()-CASE
 WHEN p_forcar THEN interval '30 seconds' ELSE interval '15 minutes' END)
 RETURNING * INTO c;
 RETURN CASE WHEN c.id IS NULL THEN NULL ELSE to_jsonb(c) END;
END $$;
COMMIT;
