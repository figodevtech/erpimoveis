ALTER TABLE public.mercadolivre_order
  ADD COLUMN IF NOT EXISTS shipment_label_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shipment_label_error text,
  ADD COLUMN IF NOT EXISTS shipment_label_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipment_handling_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS shipment_estimated_delivery_from timestamptz,
  ADD COLUMN IF NOT EXISTS shipment_estimated_delivery_to timestamptz,
  ADD COLUMN IF NOT EXISTS shipment_last_event_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_shipping_operation
  ON public.mercadolivre_order(empresa_id, shipment_status, shipment_substatus);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_shipping_deadline
  ON public.mercadolivre_order(shipment_handling_deadline)
  WHERE shipment_handling_deadline IS NOT NULL;
