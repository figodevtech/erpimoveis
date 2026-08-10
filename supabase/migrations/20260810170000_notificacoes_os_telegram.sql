-- Mantida após as migrations remotas de 10/08/2026 para não colidir com o histórico aplicado.
CREATE TABLE IF NOT EXISTS public.telegram_usuario_preferencia (
  usuario_id uuid PRIMARY KEY REFERENCES public.usuario(id) ON DELETE CASCADE,
  chat_id bigint UNIQUE,
  telegram_user_id bigint,
  telegram_username text,
  telegram_nome text,
  vinculado_em timestamptz,
  ativo boolean NOT NULL DEFAULT true,
  modo text NOT NULL DEFAULT 'CRIACAO_FINALIZACAO',
  escopo text NOT NULL DEFAULT 'MINHAS',
  notificar_criacao boolean NOT NULL DEFAULT true,
  status_selecionados text[] NOT NULL DEFAULT '{}'::text[],
  ultimo_erro text,
  ultimo_teste_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_preferencia_modo_check CHECK (
    modo IN ('CRIACAO', 'CRIACAO_FINALIZACAO', 'TODOS', 'PERSONALIZADO')
  ),
  CONSTRAINT telegram_preferencia_escopo_check CHECK (
    escopo IN ('TODAS', 'MINHAS', 'MEU_SETOR')
  ),
  CONSTRAINT telegram_preferencia_status_check CHECK (
    status_selecionados <@ ARRAY[
      'AGUARDANDO_CHECKLIST', 'ORCAMENTO', 'APROVACAO_ORCAMENTO',
      'ORCAMENTO_APROVADO', 'ORCAMENTO_RECUSADO', 'EM_ANDAMENTO',
      'PAGAMENTO', 'SEM_COBRANCA', 'CONCLUIDO', 'CANCELADO'
    ]::text[]
  )
);

CREATE TABLE IF NOT EXISTS public.telegram_vinculo_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_vinculo_token_usuario_aberto
  ON public.telegram_vinculo_token(usuario_id, expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS public.os_notificacao_evento (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ordemservico_id integer NOT NULL REFERENCES public.ordemservico(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('CRIADA', 'STATUS_ALTERADO')),
  status_anterior text,
  status_novo text NOT NULL,
  ator_usuario_id uuid REFERENCES public.usuario(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_processamento text NOT NULL DEFAULT 'PENDENTE'
    CHECK (status_processamento IN ('PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'ERRO')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  disponivel_em timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  ultimo_erro text,
  processado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_os_notificacao_evento_fila
  ON public.os_notificacao_evento(status_processamento, disponivel_em, id);

CREATE TABLE IF NOT EXISTS public.os_notificacao_entrega (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id bigint NOT NULL REFERENCES public.os_notificacao_evento(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
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
  UNIQUE (evento_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_os_notificacao_entrega_fila
  ON public.os_notificacao_entrega(status, next_retry_at, updated_at);

CREATE TABLE IF NOT EXISTS public.telegram_webhook_update (
  update_id bigint PRIMARY KEY,
  resultado text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.telegram_processamento_execucao (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origem text NOT NULL DEFAULT 'HTTP_CRON',
  status text NOT NULL CHECK (status IN ('PROCESSANDO', 'CONCLUIDO', 'PARCIAL', 'ERRO')),
  resumo jsonb NOT NULL DEFAULT '{}'::jsonb,
  erro text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer
);

ALTER TABLE public.telegram_usuario_preferencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_vinculo_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_notificacao_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_notificacao_entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_webhook_update ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_processamento_execucao ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_registrar_evento_notificacao_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo text;
  v_status_anterior text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tipo := 'CRIADA';
    v_status_anterior := NULL;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_tipo := 'STATUS_ALTERADO';
    v_status_anterior := OLD.status::text;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.os_notificacao_evento (
    ordemservico_id,
    tipo,
    status_anterior,
    status_novo,
    ator_usuario_id,
    snapshot,
    disponivel_em
  ) VALUES (
    NEW.id,
    v_tipo,
    v_status_anterior,
    NEW.status::text,
    public.auditoria_usuario_requisicao(),
    jsonb_build_object(
      'cliente_id', NEW.clienteid,
      'veiculo_id', NEW.veiculoid,
      'peca_id', NEW.pecaid,
      'alvo_tipo', NEW.alvo_tipo,
      'equipamento_nome', NEW.equipamento_nome,
      'setor_id', NEW.setorid,
      'usuario_criador_id', NEW.usuariocriadorid,
      'prioridade', NEW.prioridade
    ),
    now() + CASE WHEN TG_OP = 'INSERT' THEN interval '10 seconds' ELSE interval '1 second' END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_evento_notificacao_os ON public.ordemservico;
CREATE TRIGGER trg_registrar_evento_notificacao_os
AFTER INSERT OR UPDATE OF status ON public.ordemservico
FOR EACH ROW
EXECUTE FUNCTION public.fn_registrar_evento_notificacao_os();

CREATE OR REPLACE FUNCTION public.fn_reservar_eventos_notificacao_os(p_limit integer DEFAULT 30)
RETURNS SETOF public.os_notificacao_evento
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH selecionados AS (
    SELECT evento.id
    FROM public.os_notificacao_evento evento
    WHERE (
      evento.status_processamento IN ('PENDENTE', 'ERRO')
      OR (
        evento.status_processamento = 'PROCESSANDO'
        AND evento.locked_at < now() - interval '10 minutes'
      )
    )
      AND evento.disponivel_em <= now()
      AND evento.tentativas < 5
    ORDER BY evento.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
  )
  UPDATE public.os_notificacao_evento evento
  SET status_processamento = 'PROCESSANDO',
      tentativas = evento.tentativas + 1,
      locked_at = now(),
      ultimo_erro = NULL
  FROM selecionados
  WHERE evento.id = selecionados.id
  RETURNING evento.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_reservar_entregas_notificacao_os(p_limit integer DEFAULT 50)
RETURNS SETOF public.os_notificacao_entrega
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH selecionadas AS (
    SELECT entrega.id
    FROM public.os_notificacao_entrega entrega
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
  UPDATE public.os_notificacao_entrega entrega
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

REVOKE ALL ON FUNCTION public.fn_registrar_evento_notificacao_os() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reservar_eventos_notificacao_os(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reservar_entregas_notificacao_os(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reservar_eventos_notificacao_os(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_reservar_entregas_notificacao_os(integer) TO service_role;

REVOKE ALL ON TABLE public.telegram_usuario_preferencia FROM anon, authenticated;
REVOKE ALL ON TABLE public.telegram_vinculo_token FROM anon, authenticated;
REVOKE ALL ON TABLE public.os_notificacao_evento FROM anon, authenticated;
REVOKE ALL ON TABLE public.os_notificacao_entrega FROM anon, authenticated;
REVOKE ALL ON TABLE public.telegram_webhook_update FROM anon, authenticated;
REVOKE ALL ON TABLE public.telegram_processamento_execucao FROM anon, authenticated;

COMMENT ON TABLE public.os_notificacao_evento IS
  'Outbox de eventos de OS. O trigger nunca chama o Telegram diretamente.';
COMMENT ON TABLE public.os_notificacao_entrega IS
  'Entregas idempotentes por evento e usuario, processadas fora da transacao da OS.';
