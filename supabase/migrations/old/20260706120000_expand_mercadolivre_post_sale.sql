ALTER TABLE public.mercadolivre_order
  ADD COLUMN IF NOT EXISTS shipment_cost numeric,
  ADD COLUMN IF NOT EXISTS raw_shipment_costs jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS raw_shipment_items jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE TABLE IF NOT EXISTS public.mercadolivre_claim (
  id bigserial PRIMARY KEY,
  empresa_id integer NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  account_id bigint REFERENCES public.mercadolivre_account(id) ON DELETE SET NULL,
  order_id bigint REFERENCES public.mercadolivre_order(id) ON DELETE SET NULL,
  ml_order_id bigint,
  ml_shipment_id bigint,
  ml_claim_id text NOT NULL,
  status text,
  stage text,
  claim_type text,
  reason text,
  title text,
  due_date timestamptz,
  resource text,
  raw_claim jsonb DEFAULT '{}'::jsonb NOT NULL,
  last_error text,
  synced_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (ml_claim_id)
);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_claim_empresa
  ON public.mercadolivre_claim(empresa_id);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_claim_order
  ON public.mercadolivre_claim(order_id);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_claim_status
  ON public.mercadolivre_claim(status);

ALTER TABLE public.mercadolivre_claim ENABLE ROW LEVEL SECURITY;
