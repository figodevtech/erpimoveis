ALTER TABLE public.mercadolivre_order
  ADD COLUMN IF NOT EXISTS cancel_group text,
  ADD COLUMN IF NOT EXISTS cancel_code text,
  ADD COLUMN IF NOT EXISTS cancel_description text,
  ADD COLUMN IF NOT EXISTS cancel_requested_by text,
  ADD COLUMN IF NOT EXISTS cancel_date timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_sale jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_cancel_code
  ON public.mercadolivre_order(cancel_code)
  WHERE cancel_code IS NOT NULL;

ALTER TABLE public.mercadolivre_claim
  ADD COLUMN IF NOT EXISTS return_id text,
  ADD COLUMN IF NOT EXISTS return_status text,
  ADD COLUMN IF NOT EXISTS return_tracking_number text,
  ADD COLUMN IF NOT EXISTS return_shipment_id bigint,
  ADD COLUMN IF NOT EXISTS raw_return jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS partial_refund_offers jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS return_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_claim_return_id
  ON public.mercadolivre_claim(return_id)
  WHERE return_id IS NOT NULL;
