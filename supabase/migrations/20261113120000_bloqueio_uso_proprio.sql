-- Reserva de uso próprio: o proprietário bloqueia dias do próprio imóvel pelo site.
--
-- É um bloqueio comum (imovel_ocupacao, tipo BLOQUEIO): a regra de exclusão da tabela continua
-- impedindo sobreposição com reservas, locações e outros bloqueios, e o ERP o mostra na aba de
-- disponibilidade como qualquer bloqueio. A coluna nova guarda o login do proprietário que o
-- criou: só esses ele pode alterar ou excluir pelo site; bloqueios e manutenções da equipe não.
-- Idempotente (pode rodar de novo sem efeito).
BEGIN;

ALTER TABLE public.imovel_ocupacao
  ADD COLUMN IF NOT EXISTS solicitado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.imovel_ocupacao.solicitado_por IS
  'Login do proprietário que criou este bloqueio de uso próprio pelo site. Nulo: criado pela equipe no ERP.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'imovel_ocupacao_uso_proprio_tipo') THEN
    ALTER TABLE public.imovel_ocupacao
      ADD CONSTRAINT imovel_ocupacao_uso_proprio_tipo CHECK (solicitado_por IS NULL OR tipo = 'BLOQUEIO');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS imovel_ocupacao_solicitado_por_idx
  ON public.imovel_ocupacao (solicitado_por) WHERE solicitado_por IS NOT NULL;

COMMIT;
