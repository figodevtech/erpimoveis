BEGIN;

-- URLs iCal podem conter tokens de acesso. Acesso somente pelas rotas autorizadas do ERP.
CREATE TABLE public.imovel_canal_calendario (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  imovel_id bigint NOT NULL REFERENCES public.imovel(id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal IN ('AIRBNB', 'BOOKING')),
  anuncio text NOT NULL DEFAULT '',
  responsavel text NOT NULL DEFAULT '',
  calendario_url text NOT NULL CHECK (calendario_url LIKE 'https://%'),
  exportacao_confirmada boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (imovel_id, canal)
);
ALTER TABLE public.imovel_canal_calendario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imovel_canal_calendario FROM anon, authenticated;
GRANT ALL ON public.imovel_canal_calendario TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.imovel_canal_calendario_id_seq TO service_role;

COMMIT;
