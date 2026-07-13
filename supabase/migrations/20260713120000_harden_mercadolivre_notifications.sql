ALTER TABLE public.mercadolivre_notification
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS processing_attempts integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

UPDATE public.mercadolivre_notification
SET dedupe_key = 'legacy:' || id::text
WHERE dedupe_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mercadolivre_notification_dedupe_key
  ON public.mercadolivre_notification(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_notification_retry
  ON public.mercadolivre_notification(status, next_retry_at, created_at);
