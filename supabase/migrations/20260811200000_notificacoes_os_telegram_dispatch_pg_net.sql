-- Aciona o worker Telegram diretamente pelo pg_net. Alguns projetos antigos
-- nao possuem o schema supabase_functions usado pelo Database Webhook do painel.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.telegram_dispatch_configuracao (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  endpoint_url text NOT NULL CHECK (endpoint_url ~ '^https://'),
  bearer_token text NOT NULL CHECK (length(btrim(bearer_token)) > 0),
  ativo boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_dispatch_configuracao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_dispatch_configuracao FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_disparar_processamento_notificacao_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_endpoint_url text;
  v_bearer_token text;
BEGIN
  SELECT endpoint_url, bearer_token
    INTO v_endpoint_url, v_bearer_token
    FROM public.telegram_dispatch_configuracao
   WHERE id = 1 AND ativo = true;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_endpoint_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_bearer_token
      ),
      body := jsonb_build_object('evento_id', NEW.id),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- A OS e o evento permanecem salvos; o processador recorrente pode recuperar a fila.
    RAISE WARNING 'Falha ao agendar processamento Telegram para evento %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_disparar_processamento_notificacao_os() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_disparar_processamento_notificacao_os ON public.os_notificacao_evento;
CREATE TRIGGER trg_disparar_processamento_notificacao_os
AFTER INSERT ON public.os_notificacao_evento
FOR EACH ROW
EXECUTE FUNCTION public.fn_disparar_processamento_notificacao_os();

COMMENT ON TABLE public.telegram_dispatch_configuracao IS
  'Configuracao privada usada pelo pg_net para acionar o worker Telegram em tempo real.';
