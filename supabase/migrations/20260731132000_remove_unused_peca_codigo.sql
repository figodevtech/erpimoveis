-- A coluna nao e utilizada pelo dominio atual e ja foi removida dos bancos existentes.
-- Esta migration registra a remocao para novos ambientes criados a partir do baseline.

ALTER TABLE IF EXISTS public.peca
  DROP COLUMN IF EXISTS codigo;
