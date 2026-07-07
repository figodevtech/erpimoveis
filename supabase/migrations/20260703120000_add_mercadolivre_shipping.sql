ALTER TABLE public.mercadolivre_order
  ADD COLUMN IF NOT EXISTS ml_shipment_id bigint,
  ADD COLUMN IF NOT EXISTS shipment_status text,
  ADD COLUMN IF NOT EXISTS shipment_substatus text,
  ADD COLUMN IF NOT EXISTS shipping_mode text,
  ADD COLUMN IF NOT EXISTS logistic_type text,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS tracking_method text,
  ADD COLUMN IF NOT EXISTS raw_shipment jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS shipment_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_shipment_id
  ON public.mercadolivre_order(ml_shipment_id);
