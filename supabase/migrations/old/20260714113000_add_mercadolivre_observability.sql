CREATE TABLE IF NOT EXISTS public.mercadolivre_sync_run (
  id bigserial PRIMARY KEY,
  job_name text NOT NULL DEFAULT 'FULL_SYNC',
  trigger_source text NOT NULL DEFAULT 'CRON',
  status text NOT NULL DEFAULT 'PROCESSANDO',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mercadolivre_sync_run_status_check
    CHECK (status IN ('PROCESSANDO', 'CONCLUIDO', 'PARCIAL', 'ERRO'))
);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_sync_run_started_at
  ON public.mercadolivre_sync_run(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_mercadolivre_sync_run_status
  ON public.mercadolivre_sync_run(status, started_at DESC);

ALTER TABLE public.mercadolivre_sync_run ENABLE ROW LEVEL SECURITY;

