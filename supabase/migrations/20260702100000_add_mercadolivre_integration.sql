CREATE TABLE IF NOT EXISTS public.mercadolivre_account (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  ml_user_id bigint NOT NULL,
  nickname text,
  site_id text DEFAULT 'MLB'::text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_type text,
  scope text,
  expires_at timestamptz,
  raw_token jsonb DEFAULT '{}'::jsonb NOT NULL,
  raw_user jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (empresa_id),
  UNIQUE (ml_user_id)
);

CREATE TABLE IF NOT EXISTS public.mercadolivre_notification (
  id bigserial PRIMARY KEY,
  account_id bigint REFERENCES public.mercadolivre_account(id) ON DELETE SET NULL,
  topic text,
  resource text,
  ml_user_id bigint,
  application_id bigint,
  attempts integer,
  sent text,
  received text,
  status text DEFAULT 'RECEBIDA'::text NOT NULL,
  raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  error text,
  processed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_notification_topic
  ON public.mercadolivre_notification(topic);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_notification_ml_user
  ON public.mercadolivre_notification(ml_user_id);

CREATE TABLE IF NOT EXISTS public.mercadolivre_product_link (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  produto_id integer NOT NULL REFERENCES public.produto(id) ON DELETE CASCADE,
  ml_item_id text NOT NULL,
  ml_variation_id bigint,
  title text,
  permalink text,
  status text,
  raw_item jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (empresa_id, produto_id),
  UNIQUE (ml_item_id, ml_variation_id)
);

CREATE TABLE IF NOT EXISTS public.mercadolivre_order (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  account_id bigint REFERENCES public.mercadolivre_account(id) ON DELETE SET NULL,
  venda_id integer REFERENCES public.venda(id) ON DELETE SET NULL,
  ml_order_id bigint NOT NULL,
  status text,
  date_created timestamptz,
  total_amount numeric,
  currency_id text,
  buyer_id bigint,
  raw_order jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (ml_order_id)
);

ALTER TABLE public.mercadolivre_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mercadolivre_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mercadolivre_product_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mercadolivre_order ENABLE ROW LEVEL SECURITY;
