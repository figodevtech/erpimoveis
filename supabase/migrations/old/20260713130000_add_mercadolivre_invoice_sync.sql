ALTER TABLE public.mercadolivre_order
  ADD COLUMN IF NOT EXISTS nfe_id bigint REFERENCES public.nfe(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ml_invoice_id text,
  ADD COLUMN IF NOT EXISTS invoice_status text,
  ADD COLUMN IF NOT EXISTS invoice_fiscal_key text,
  ADD COLUMN IF NOT EXISTS invoice_error text,
  ADD COLUMN IF NOT EXISTS invoice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_invoice jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_nfe_id
  ON public.mercadolivre_order(nfe_id);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_order_invoice_status
  ON public.mercadolivre_order(invoice_status);
