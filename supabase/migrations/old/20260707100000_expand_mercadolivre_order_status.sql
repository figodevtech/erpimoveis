ALTER TABLE public.mercadolivre_order
  ADD COLUMN IF NOT EXISTS status_detail text,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_status_detail text,
  ADD COLUMN IF NOT EXISTS order_tags text[] DEFAULT '{}'::text[] NOT NULL,
  ADD COLUMN IF NOT EXISTS date_closed timestamptz,
  ADD COLUMN IF NOT EXISTS raw_payments jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

ALTER TABLE public.mercadolivre_claim
  ADD COLUMN IF NOT EXISTS resolution text,
  ADD COLUMN IF NOT EXISTS available_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS players jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_payment_status
  ON public.mercadolivre_order(payment_status);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_last_synced_at
  ON public.mercadolivre_order(last_synced_at);
