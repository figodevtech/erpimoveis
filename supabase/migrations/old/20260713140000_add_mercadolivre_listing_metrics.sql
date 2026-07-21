ALTER TABLE public.mercadolivre_product_link
  ADD COLUMN IF NOT EXISTS visits_total bigint,
  ADD COLUMN IF NOT EXISTS sold_quantity integer,
  ADD COLUMN IF NOT EXISTS available_quantity integer,
  ADD COLUMN IF NOT EXISTS listing_type_id text,
  ADD COLUMN IF NOT EXISTS item_condition text,
  ADD COLUMN IF NOT EXISTS health numeric,
  ADD COLUMN IF NOT EXISTS catalog_listing boolean,
  ADD COLUMN IF NOT EXISTS stop_time timestamptz,
  ADD COLUMN IF NOT EXISTS metrics_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_product_link_metrics_updated_at
  ON public.mercadolivre_product_link(metrics_updated_at);
