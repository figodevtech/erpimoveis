ALTER TABLE public.telegram_usuario_preferencia
  ADD COLUMN IF NOT EXISTS notificar_financeiro_diario boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS horario_resumo_financeiro time NOT NULL DEFAULT time '08:00',
  ADD COLUMN IF NOT EXISTS financeiro_incluir_atrasadas boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS financeiro_enviar_sem_contas boolean NOT NULL DEFAULT false;

ALTER TABLE public.telegram_dispatch_configuracao
  ADD COLUMN IF NOT EXISTS financeiro_endpoint_url text;

ALTER TABLE public.telegram_dispatch_configuracao
  DROP CONSTRAINT IF EXISTS telegram_dispatch_financeiro_endpoint_check;
ALTER TABLE public.telegram_dispatch_configuracao
  ADD CONSTRAINT telegram_dispatch_financeiro_endpoint_check
  CHECK (financeiro_endpoint_url IS NULL OR financeiro_endpoint_url ~ '^https://');

CREATE TABLE IF NOT EXISTS public.telegram_resumo_financeiro_envio (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  referencia_data date NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'ENVIADO', 'SEM_MOVIMENTO', 'ERRO')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proxima_tentativa_em timestamptz,
  locked_at timestamptz,
  mensagens jsonb,
  proxima_mensagem integer NOT NULL DEFAULT 0 CHECK (proxima_mensagem >= 0),
  quantidade_atrasadas integer NOT NULL DEFAULT 0,
  quantidade_hoje integer NOT NULL DEFAULT 0,
  total_atrasado numeric(14,2) NOT NULL DEFAULT 0,
  total_hoje numeric(14,2) NOT NULL DEFAULT 0,
  telegram_message_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, referencia_data)
);

CREATE INDEX IF NOT EXISTS idx_telegram_resumo_financeiro_fila
  ON public.telegram_resumo_financeiro_envio(status, proxima_tentativa_em, referencia_data, id);

ALTER TABLE public.telegram_resumo_financeiro_envio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_resumo_financeiro_envio FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_reservar_resumos_financeiros_telegram(
  p_referencia_data date,
  p_horario_local time,
  p_limit integer DEFAULT 20
)
RETURNS SETOF public.telegram_resumo_financeiro_envio
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.telegram_resumo_financeiro_envio (usuario_id, referencia_data)
  SELECT preferencia.usuario_id, p_referencia_data
    FROM public.telegram_usuario_preferencia preferencia
    JOIN public.usuario usuario ON usuario.id = preferencia.usuario_id AND usuario.ativo = true
   WHERE preferencia.ativo = true
     AND preferencia.chat_id IS NOT NULL
     AND preferencia.notificar_financeiro_diario = true
     AND preferencia.horario_resumo_financeiro <= p_horario_local
     AND EXISTS (
       SELECT 1
         FROM public.perfilpermissao perfil_permissao
         JOIN public.permissao permissao ON permissao.id = perfil_permissao.permissaoid
        WHERE perfil_permissao.perfilid = usuario.perfilid
          AND upper(btrim(permissao.nome)) = 'FINANCEIRO:VISUALIZAR'
     )
  ON CONFLICT (usuario_id, referencia_data) DO NOTHING;

  RETURN QUERY
  WITH selecionados AS (
    SELECT envio.id
      FROM public.telegram_resumo_financeiro_envio envio
      JOIN public.telegram_usuario_preferencia preferencia
        ON preferencia.usuario_id = envio.usuario_id
       AND preferencia.ativo = true
       AND preferencia.chat_id IS NOT NULL
       AND preferencia.notificar_financeiro_diario = true
      JOIN public.usuario usuario ON usuario.id = envio.usuario_id AND usuario.ativo = true
     WHERE envio.referencia_data = p_referencia_data
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

REVOKE ALL ON FUNCTION public.fn_reservar_resumos_financeiros_telegram(date, time, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reservar_resumos_financeiros_telegram(date, time, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_agendar_resumo_financeiro_telegram()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_endpoint_url text;
  v_bearer_token text;
BEGIN
  SELECT financeiro_endpoint_url, bearer_token
    INTO v_endpoint_url, v_bearer_token
    FROM public.telegram_dispatch_configuracao
   WHERE id = 1 AND ativo = true;

  IF v_endpoint_url IS NULL OR v_bearer_token IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_endpoint_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_bearer_token
    ),
    body := jsonb_build_object('origem', 'PG_CRON'),
    timeout_milliseconds := 5000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao agendar resumo financeiro Telegram: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_agendar_resumo_financeiro_telegram()
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'telegram-resumo-financeiro-diario'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'telegram-resumo-financeiro-diario',
    '*/5 * * * *',
    'SELECT public.fn_agendar_resumo_financeiro_telegram()'
  );
END;
$$;

COMMENT ON TABLE public.telegram_resumo_financeiro_envio IS
  'Controle idempotente do resumo diario de contas a pagar enviado pelo Telegram.';
