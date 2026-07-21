ALTER TABLE public.mercadolivre_notification
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mercadolivre_notification_processing
  ON public.mercadolivre_notification(status, locked_at, next_retry_at, created_at);

CREATE OR REPLACE FUNCTION public.fn_reservar_notificacoes_mercadolivre(
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  notification_id bigint,
  processing_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH selected AS (
    SELECT notification.id
      FROM public.mercadolivre_notification notification
     WHERE (
       (
         notification.status IN ('RECEBIDA', 'ERRO')
         AND (notification.next_retry_at IS NULL OR notification.next_retry_at <= now())
       )
       OR (
         notification.status = 'PROCESSANDO'
         AND (notification.locked_at IS NULL OR notification.locked_at < now() - interval '10 minutes')
       )
     )
     ORDER BY notification.created_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
  )
  UPDATE public.mercadolivre_notification notification
     SET status = 'PROCESSANDO',
         processing_attempts = notification.processing_attempts + 1,
         locked_at = now(),
         error = NULL
    FROM selected
   WHERE notification.id = selected.id
  RETURNING notification.id, notification.processing_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reservar_notificacoes_mercadolivre(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reservar_notificacoes_mercadolivre(integer) TO service_role;
