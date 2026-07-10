ALTER TABLE public.transacao
  ALTER COLUMN banco_id DROP NOT NULL;

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS parcelas integer NOT NULL DEFAULT 1;

ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_parcelas_check;

ALTER TABLE public.transacao
  ADD CONSTRAINT transacao_parcelas_check CHECK (parcelas >= 1);
