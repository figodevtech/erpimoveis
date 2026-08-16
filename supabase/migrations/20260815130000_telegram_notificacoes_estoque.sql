BEGIN;

-- Preferencias de estoque ficam separadas das regras de OS. Array vazio mantem
-- os destinatarios existentes sem novos avisos depois da migration.
ALTER TABLE public.telegram_usuario_preferencia
  ADD COLUMN IF NOT EXISTS estoque_eventos_selecionados text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.telegram_usuario_preferencia
  DROP CONSTRAINT IF EXISTS telegram_preferencia_estoque_eventos_check;
ALTER TABLE public.telegram_usuario_preferencia
  ADD CONSTRAINT telegram_preferencia_estoque_eventos_check CHECK (
    estoque_eventos_selecionados <@ ARRAY[
      'ENTRADA_REGISTRO',
      'ENTRADA_ESTORNO',
      'SAIDA_MANUAL_REGISTRO',
      'SAIDA_MANUAL_ESTORNO',
      'VENDA_REGISTRO',
      'VENDA_ESTORNO',
      'ORDEM_SERVICO_REGISTRO',
      'ORDEM_SERVICO_ESTORNO'
    ]::text[]
  );

-- Classificacao unica usada pelo gatilho e pela reserva da fila. Movimentos
-- sem origem identificada permanecem somente no historico/auditoria.
CREATE OR REPLACE FUNCTION public.fn_tipo_evento_notificacao_estoque(
  p_origem text,
  p_acao text,
  p_sentido text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_origem = 'ENTRADA' AND p_acao = 'REGISTRO' AND p_sentido = 'ENTRADA'
      THEN 'ENTRADA_REGISTRO'
    WHEN p_origem = 'ENTRADA' AND p_acao = 'ESTORNO' AND p_sentido = 'SAIDA'
      THEN 'ENTRADA_ESTORNO'
    WHEN p_origem = 'SAIDA_MANUAL' AND p_acao = 'REGISTRO' AND p_sentido = 'SAIDA'
      THEN 'SAIDA_MANUAL_REGISTRO'
    WHEN p_origem = 'SAIDA_MANUAL' AND p_acao = 'ESTORNO' AND p_sentido = 'ENTRADA'
      THEN 'SAIDA_MANUAL_ESTORNO'
    WHEN p_origem = 'VENDA' AND p_acao = 'REGISTRO' AND p_sentido = 'SAIDA'
      THEN 'VENDA_REGISTRO'
    WHEN p_origem = 'VENDA' AND p_acao = 'ESTORNO' AND p_sentido = 'ENTRADA'
      THEN 'VENDA_ESTORNO'
    WHEN p_origem = 'ORDEM_SERVICO' AND p_acao = 'REGISTRO' AND p_sentido = 'SAIDA'
      THEN 'ORDEM_SERVICO_REGISTRO'
    WHEN p_origem = 'ORDEM_SERVICO' AND p_acao = 'ESTORNO' AND p_sentido = 'ENTRADA'
      THEN 'ORDEM_SERVICO_ESTORNO'
    ELSE NULL
  END;
$$;

CREATE TABLE IF NOT EXISTS public.telegram_estoque_entrega (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  movimento_id bigint NOT NULL REFERENCES public.estoque_movimento(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  evento_tipo text NOT NULL CHECK (evento_tipo IN (
    'ENTRADA_REGISTRO',
    'ENTRADA_ESTORNO',
    'SAIDA_MANUAL_REGISTRO',
    'SAIDA_MANUAL_ESTORNO',
    'VENDA_REGISTRO',
    'VENDA_ESTORNO',
    'ORDEM_SERVICO_REGISTRO',
    'ORDEM_SERVICO_ESTORNO'
  )),
  status text NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'ERRO', 'DESCARTADO')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  next_retry_at timestamptz,
  locked_at timestamptz,
  telegram_message_id bigint,
  erro_codigo text,
  erro_mensagem text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (movimento_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_estoque_entrega_fila
  ON public.telegram_estoque_entrega(status, next_retry_at, id);
CREATE INDEX IF NOT EXISTS idx_telegram_estoque_entrega_usuario
  ON public.telegram_estoque_entrega(usuario_id, created_at DESC);

ALTER TABLE public.telegram_estoque_entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_estoque_entrega NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_estoque_entrega FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_estoque_entrega TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.telegram_estoque_entrega_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.fn_enfileirar_notificacao_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento_tipo text;
  v_quantidade_entregas integer := 0;
  v_endpoint_url text;
  v_bearer_token text;
BEGIN
  v_evento_tipo := public.fn_tipo_evento_notificacao_estoque(
    NEW.origem,
    NEW.acao,
    NEW.sentido
  );

  IF v_evento_tipo IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.telegram_estoque_entrega (
    movimento_id,
    usuario_id,
    chat_id,
    evento_tipo
  )
  SELECT
    NEW.id,
    preferencia.usuario_id,
    preferencia.chat_id,
    v_evento_tipo
  FROM public.telegram_usuario_preferencia preferencia
  JOIN public.usuario usuario
    ON usuario.id = preferencia.usuario_id
   AND usuario.ativo = true
  WHERE preferencia.ativo = true
    AND preferencia.chat_id IS NOT NULL
    AND v_evento_tipo = ANY(preferencia.estoque_eventos_selecionados)
    AND EXISTS (
      SELECT 1
      FROM public.perfilpermissao perfil_permissao
      JOIN public.permissao permissao
        ON permissao.id = perfil_permissao.permissaoid
      WHERE perfil_permissao.perfilid = usuario.perfilid
        AND upper(btrim(permissao.nome)) = 'ESTOQUE:VISUALIZAR'
    )
  ON CONFLICT (movimento_id, usuario_id) DO NOTHING;

  GET DIAGNOSTICS v_quantidade_entregas = ROW_COUNT;
  IF v_quantidade_entregas = 0 THEN
    RETURN NEW;
  END IF;

  SELECT endpoint_url, bearer_token
    INTO v_endpoint_url, v_bearer_token
    FROM public.telegram_dispatch_configuracao
   WHERE id = 1 AND ativo = true;

  IF v_endpoint_url IS NULL OR v_bearer_token IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_endpoint_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_bearer_token
      ),
      body := jsonb_build_object(
        'origem', 'ESTOQUE',
        'movimento_id', NEW.id
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- A entrega continua pendente e pode ser recuperada pelo cron ou pelo botao
    -- de processamento manual.
    RAISE WARNING 'Falha ao agendar notificacao Telegram do movimento de estoque %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enfileirar_notificacao_estoque ON public.estoque_movimento;
CREATE TRIGGER trg_enfileirar_notificacao_estoque
AFTER INSERT ON public.estoque_movimento
FOR EACH ROW
EXECUTE FUNCTION public.fn_enfileirar_notificacao_estoque();

CREATE OR REPLACE FUNCTION public.fn_reservar_entregas_notificacao_estoque(
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.telegram_estoque_entrega
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Preferencia, vinculo, usuario ou permissao removidos antes do envio tornam a
  -- entrega inelegivel em vez de deixarem dados de estoque seguirem para o chat.
  UPDATE public.telegram_estoque_entrega entrega
     SET status = 'DESCARTADO',
         locked_at = NULL,
         next_retry_at = NULL,
         erro_codigo = 'INELIGIVEL',
         erro_mensagem = 'Destinatario sem preferencia, vinculo ou permissao de estoque.',
         updated_at = now()
   WHERE (
     entrega.status IN ('PENDENTE', 'ERRO')
     OR (
       entrega.status = 'ENVIANDO'
       AND entrega.locked_at < now() - interval '10 minutes'
     )
   )
     AND NOT EXISTS (
       SELECT 1
       FROM public.telegram_usuario_preferencia preferencia
       JOIN public.usuario usuario
         ON usuario.id = preferencia.usuario_id
        AND usuario.ativo = true
       WHERE preferencia.usuario_id = entrega.usuario_id
         AND preferencia.ativo = true
         AND preferencia.chat_id = entrega.chat_id
         AND entrega.evento_tipo = ANY(preferencia.estoque_eventos_selecionados)
         AND EXISTS (
           SELECT 1
           FROM public.perfilpermissao perfil_permissao
           JOIN public.permissao permissao
             ON permissao.id = perfil_permissao.permissaoid
           WHERE perfil_permissao.perfilid = usuario.perfilid
             AND upper(btrim(permissao.nome)) = 'ESTOQUE:VISUALIZAR'
         )
     );

  RETURN QUERY
  WITH selecionadas AS (
    SELECT entrega.id
    FROM public.telegram_estoque_entrega entrega
    WHERE (
      entrega.status IN ('PENDENTE', 'ERRO')
      OR (
        entrega.status = 'ENVIANDO'
        AND entrega.locked_at < now() - interval '10 minutes'
      )
    )
      AND (entrega.next_retry_at IS NULL OR entrega.next_retry_at <= now())
      AND entrega.tentativas < 5
    ORDER BY entrega.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  )
  UPDATE public.telegram_estoque_entrega entrega
     SET status = 'ENVIANDO',
         tentativas = entrega.tentativas + 1,
         locked_at = now(),
         erro_codigo = NULL,
         erro_mensagem = NULL,
         updated_at = now()
    FROM selecionadas
   WHERE entrega.id = selecionadas.id
  RETURNING entrega.*;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tipo_evento_notificacao_estoque(text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_enfileirar_notificacao_estoque()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reservar_entregas_notificacao_estoque(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reservar_entregas_notificacao_estoque(integer)
  TO service_role;

COMMENT ON COLUMN public.telegram_usuario_preferencia.estoque_eventos_selecionados IS
  'Eventos do razao de estoque que o destinatario escolheu receber pelo Telegram.';
COMMENT ON TABLE public.telegram_estoque_entrega IS
  'Fila idempotente de notificacoes Telegram, uma por movimento de estoque e destinatario.';

COMMIT;

NOTIFY pgrst, 'reload schema';
