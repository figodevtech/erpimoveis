BEGIN;

-- Resumo diario de contas a receber, separado do de contas a pagar.
--
-- Quem cobra nao e quem paga: cada lado tem o seu liga/desliga e o seu horario.
-- O controle diario, que ate aqui admitia um envio por pessoa por dia, passa a
-- distinguir os dois pelo tipo.
ALTER TABLE public.telegram_usuario_preferencia
  ADD COLUMN IF NOT EXISTS notificar_receber_diario boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS horario_resumo_receber time NOT NULL DEFAULT time '08:00',
  ADD COLUMN IF NOT EXISTS receber_incluir_vencidas boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS receber_enviar_sem_contas boolean NOT NULL DEFAULT false;

ALTER TABLE public.telegram_resumo_financeiro_envio
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'A_PAGAR';

ALTER TABLE public.telegram_resumo_financeiro_envio
  DROP CONSTRAINT IF EXISTS telegram_resumo_financeiro_envio_tipo_check;
ALTER TABLE public.telegram_resumo_financeiro_envio
  ADD CONSTRAINT telegram_resumo_financeiro_envio_tipo_check
  CHECK (tipo IN ('A_PAGAR', 'A_RECEBER'));

-- As linhas ja gravadas sao todas de contas a pagar, entao a chave nova nao
-- colide com nada: o default preenche o tipo antes de a restricao valer.
ALTER TABLE public.telegram_resumo_financeiro_envio
  DROP CONSTRAINT IF EXISTS telegram_resumo_financeiro_envio_usuario_id_referencia_data_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'telegram_resumo_financeiro_envio_usuario_data_tipo_key'
  ) THEN
    ALTER TABLE public.telegram_resumo_financeiro_envio
      ADD CONSTRAINT telegram_resumo_financeiro_envio_usuario_data_tipo_key
      UNIQUE (usuario_id, referencia_data, tipo);
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_telegram_resumo_financeiro_fila;
CREATE INDEX IF NOT EXISTS idx_telegram_resumo_financeiro_fila
  ON public.telegram_resumo_financeiro_envio(tipo, status, proxima_tentativa_em, referencia_data, id);

-- A assinatura ganha o tipo. Nao da para criar uma sobrecarga com o parametro
-- novo e um default: a chamada de tres argumentos ficaria ambigua entre as duas
-- versoes. Por isso a antiga sai antes.
DROP FUNCTION IF EXISTS public.fn_reservar_resumos_financeiros_telegram(date, time, integer);

CREATE OR REPLACE FUNCTION public.fn_reservar_resumos_financeiros_telegram(
  p_referencia_data date,
  p_horario_local time,
  p_limit integer DEFAULT 20,
  p_tipo text DEFAULT 'A_PAGAR'
)
RETURNS SETOF public.telegram_resumo_financeiro_envio
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tipo NOT IN ('A_PAGAR', 'A_RECEBER') THEN
    RAISE EXCEPTION 'Tipo de resumo invalido: %', p_tipo USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.telegram_resumo_financeiro_envio (usuario_id, referencia_data, tipo)
  SELECT preferencia.usuario_id, p_referencia_data, p_tipo
    FROM public.telegram_usuario_preferencia preferencia
    JOIN public.usuario usuario ON usuario.id = preferencia.usuario_id AND usuario.ativo = true
   WHERE preferencia.ativo = true
     AND preferencia.chat_id IS NOT NULL
     AND CASE WHEN p_tipo = 'A_RECEBER'
              THEN preferencia.notificar_receber_diario
              ELSE preferencia.notificar_financeiro_diario
         END = true
     AND CASE WHEN p_tipo = 'A_RECEBER'
              THEN preferencia.horario_resumo_receber
              ELSE preferencia.horario_resumo_financeiro
         END <= p_horario_local
     AND EXISTS (
       SELECT 1
         FROM public.perfilpermissao perfil_permissao
         JOIN public.permissao permissao ON permissao.id = perfil_permissao.permissaoid
        WHERE perfil_permissao.perfilid = usuario.perfilid
          AND upper(btrim(permissao.nome)) = 'FINANCEIRO:VISUALIZAR'
     )
  ON CONFLICT (usuario_id, referencia_data, tipo) DO NOTHING;

  RETURN QUERY
  WITH selecionados AS (
    SELECT envio.id
      FROM public.telegram_resumo_financeiro_envio envio
      JOIN public.telegram_usuario_preferencia preferencia
        ON preferencia.usuario_id = envio.usuario_id
       AND preferencia.ativo = true
       AND preferencia.chat_id IS NOT NULL
       AND CASE WHEN p_tipo = 'A_RECEBER'
                THEN preferencia.notificar_receber_diario
                ELSE preferencia.notificar_financeiro_diario
           END = true
      JOIN public.usuario usuario ON usuario.id = envio.usuario_id AND usuario.ativo = true
     WHERE envio.referencia_data = p_referencia_data
       AND envio.tipo = p_tipo
       AND (
         envio.status = 'PENDENTE'
         OR (envio.status = 'ERRO' AND coalesce(envio.proxima_tentativa_em, now()) <= now())
         OR (envio.status = 'PROCESSANDO' AND envio.locked_at < now() - interval '10 minutes')
       )
       AND envio.tentativas < 5
       AND EXISTS (
         SELECT 1
           FROM public.perfilpermissao perfil_permissao
           JOIN public.permissao permissao ON permissao.id = perfil_permissao.permissaoid
          WHERE perfil_permissao.perfilid = usuario.perfilid
            AND upper(btrim(permissao.nome)) = 'FINANCEIRO:VISUALIZAR'
       )
     ORDER BY envio.id
     FOR UPDATE OF envio SKIP LOCKED
     LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 100)
  )
  UPDATE public.telegram_resumo_financeiro_envio envio
     SET status = 'PROCESSANDO',
         tentativas = envio.tentativas + 1,
         locked_at = now(),
         erro = NULL,
         updated_at = now()
    FROM selecionados
   WHERE envio.id = selecionados.id
  RETURNING envio.*;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reservar_resumos_financeiros_telegram(date, time, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reservar_resumos_financeiros_telegram(date, time, integer, text)
  TO service_role;

COMMENT ON COLUMN public.telegram_resumo_financeiro_envio.tipo IS
  'Qual resumo diario esta linha controla: A_PAGAR ou A_RECEBER.';
COMMENT ON COLUMN public.telegram_usuario_preferencia.notificar_receber_diario IS
  'Resumo diario de contas a receber, independente do de contas a pagar.';

COMMIT;

NOTIFY pgrst, 'reload schema';
