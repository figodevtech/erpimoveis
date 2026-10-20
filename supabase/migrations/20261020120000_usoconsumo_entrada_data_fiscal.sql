BEGIN;

-- Nota que entrou só nos estoques de uso e consumo ou geral não tem `entrada`.
-- Para o SPED ela é compra como qualquer outra e precisa da mesma data de
-- escrituração confirmada. Nota mista continua confirmada pela `entrada`.
ALTER TABLE public.usoconsumo_entrada
  ADD COLUMN IF NOT EXISTS data_entrada_fiscal date,
  ADD COLUMN IF NOT EXISTS data_entrada_fiscal_confirmada_em timestamptz,
  ADD COLUMN IF NOT EXISTS data_entrada_fiscal_confirmada_por uuid
    REFERENCES public.usuario(id) ON DELETE SET NULL;

ALTER TABLE public.usoconsumo_entrada
  DROP CONSTRAINT IF EXISTS usoconsumo_entrada_data_fiscal_confirmacao_chk;
ALTER TABLE public.usoconsumo_entrada
  ADD CONSTRAINT usoconsumo_entrada_data_fiscal_confirmacao_chk CHECK (
    (data_entrada_fiscal IS NULL
      AND data_entrada_fiscal_confirmada_em IS NULL
      AND data_entrada_fiscal_confirmada_por IS NULL)
    OR
    (data_entrada_fiscal IS NOT NULL
      AND data_entrada_fiscal_confirmada_em IS NOT NULL
      AND data_entrada_fiscal_confirmada_por IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS usoconsumo_entrada_fiscal_competencia_idx
  ON public.usoconsumo_entrada(data_entrada_fiscal, status, id)
  WHERE fiscal AND data_entrada_fiscal IS NOT NULL;

CREATE INDEX IF NOT EXISTS usoconsumo_entrada_fiscal_pendente_data_idx
  ON public.usoconsumo_entrada(status, created_at, id)
  WHERE fiscal AND data_entrada_fiscal IS NULL;

COMMENT ON COLUMN public.usoconsumo_entrada.data_entrada_fiscal IS
  'Data civil de escrituração da entrada que foi só para uso e consumo ou geral. Nunca é inferida de created_at.';

COMMIT;
