BEGIN;

-- Avisos instantaneos do fluxo de caixa.
--
-- O gatilho fica em `transacao`, e nao no livro `transacao_baixa_historico`:
-- todo caminho de baixa termina mexendo em `pendente` da linha, mas nem todos
-- escrevem no livro — `desfazer_adiantamento` devolve titulo para em aberto sem
-- passar por la. O livro entra so para enriquecer a mensagem.
ALTER TABLE public.telegram_usuario_preferencia
  ADD COLUMN IF NOT EXISTS financeiro_eventos_selecionados text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS financeiro_valor_minimo numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financeiro_origens_selecionadas text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS financeiro_bancos_selecionados bigint[] NOT NULL DEFAULT '{}'::bigint[];

ALTER TABLE public.telegram_usuario_preferencia
  DROP CONSTRAINT IF EXISTS telegram_preferencia_financeiro_eventos_check;
ALTER TABLE public.telegram_usuario_preferencia
  ADD CONSTRAINT telegram_preferencia_financeiro_eventos_check CHECK (
    financeiro_eventos_selecionados <@ ARRAY[
      'CONTA_PAGAR_CRIADA',
      'CONTA_RECEBER_CRIADA',
      'MOVIMENTO_CAIXA_CRIADO',
      'CONTA_PAGAR_LIQUIDADA',
      'CONTA_RECEBER_LIQUIDADA',
      'BAIXA_ESTORNADA',
      'LANCAMENTO_EXCLUIDO',
      'TRANSFERENCIA_ENTRE_CONTAS'
    ]::text[]
  );

ALTER TABLE public.telegram_usuario_preferencia
  DROP CONSTRAINT IF EXISTS telegram_preferencia_financeiro_origens_check;
ALTER TABLE public.telegram_usuario_preferencia
  ADD CONSTRAINT telegram_preferencia_financeiro_origens_check CHECK (
    financeiro_origens_selecionadas <@ ARRAY[
      'AVULSO', 'ORDEM_SERVICO', 'VENDA', 'ENTRADA'
    ]::text[]
  );

ALTER TABLE public.telegram_usuario_preferencia
  DROP CONSTRAINT IF EXISTS telegram_preferencia_financeiro_valor_minimo_check;
ALTER TABLE public.telegram_usuario_preferencia
  ADD CONSTRAINT telegram_preferencia_financeiro_valor_minimo_check
  CHECK (financeiro_valor_minimo >= 0);

COMMENT ON COLUMN public.telegram_usuario_preferencia.financeiro_valor_minimo IS
  'Piso do aviso instantaneo. Zero significa sem piso.';
COMMENT ON COLUMN public.telegram_usuario_preferencia.financeiro_origens_selecionadas IS
  'Origens que geram aviso. Vazio significa todas. Transferencia nao entra aqui: e governada pelo proprio evento.';
COMMENT ON COLUMN public.telegram_usuario_preferencia.financeiro_bancos_selecionados IS
  'Contas bancarias que geram aviso. Vazio significa todas. Lancamento sem banco definido nunca e excluido por este filtro.';

CREATE TABLE IF NOT EXISTS public.telegram_financeiro_entrega (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transacao_id bigint NOT NULL,
  evento_tipo text NOT NULL CHECK (evento_tipo IN (
    'CONTA_PAGAR_CRIADA',
    'CONTA_RECEBER_CRIADA',
    'MOVIMENTO_CAIXA_CRIADO',
    'CONTA_PAGAR_LIQUIDADA',
    'CONTA_RECEBER_LIQUIDADA',
    'BAIXA_ESTORNADA',
    'LANCAMENTO_EXCLUIDO',
    'TRANSFERENCIA_ENTRE_CONTAS'
  )),
  -- Identidade do fato. Baixar, estornar e baixar de novo sao tres fatos do
  -- mesmo titulo, entao o carimbo de alteracao entra na chave. A transferencia
  -- e a excecao: as duas pernas sao um fato so, e a chave e a transferencia.
  dedupe_chave text NOT NULL,
  ator_usuario_id uuid,
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
  UNIQUE (usuario_id, evento_tipo, dedupe_chave)
);

CREATE INDEX IF NOT EXISTS idx_telegram_financeiro_entrega_fila
  ON public.telegram_financeiro_entrega(status, next_retry_at, id);
CREATE INDEX IF NOT EXISTS idx_telegram_financeiro_entrega_usuario
  ON public.telegram_financeiro_entrega(usuario_id, created_at DESC);

ALTER TABLE public.telegram_financeiro_entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_financeiro_entrega NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_financeiro_entrega FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_financeiro_entrega TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.telegram_financeiro_entrega_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.fn_notificar_telegram_transacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento text;
  v_origem text;
  v_valor numeric(14,2);
  v_dedupe text;
  v_ator uuid;
  v_quantidade_entregas integer := 0;
  v_endpoint_url text;
  v_bearer_token text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.is_deleted, false) THEN
      RETURN NEW;
    END IF;
    IF NEW.transferencia_id IS NOT NULL THEN
      v_evento := 'TRANSFERENCIA_ENTRE_CONTAS';
    ELSIF coalesce(NEW.pendente, false) THEN
      v_evento := CASE WHEN upper(coalesce(NEW.tipo::text, '')) = 'RECEITA'
                       THEN 'CONTA_RECEBER_CRIADA' ELSE 'CONTA_PAGAR_CRIADA' END;
    ELSE
      v_evento := 'MOVIMENTO_CAIXA_CRIADO';
    END IF;
  ELSE
    -- Exclusao vem antes da baixa: a linha sai do fluxo, e o que aconteceu com
    -- `pendente` no mesmo update deixa de importar.
    IF coalesce(NEW.is_deleted, false) AND NOT coalesce(OLD.is_deleted, false) THEN
      v_evento := 'LANCAMENTO_EXCLUIDO';
    ELSIF coalesce(NEW.is_deleted, false) THEN
      RETURN NEW;
    ELSIF coalesce(OLD.pendente, false) AND NOT coalesce(NEW.pendente, false) THEN
      v_evento := CASE WHEN upper(coalesce(NEW.tipo::text, '')) = 'RECEITA'
                       THEN 'CONTA_RECEBER_LIQUIDADA' ELSE 'CONTA_PAGAR_LIQUIDADA' END;
    ELSIF NOT coalesce(OLD.pendente, false) AND coalesce(NEW.pendente, false) THEN
      v_evento := 'BAIXA_ESTORNADA';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  v_origem := CASE
    WHEN NEW.ordemservicoid IS NOT NULL THEN 'ORDEM_SERVICO'
    WHEN NEW.vendaid IS NOT NULL THEN 'VENDA'
    WHEN NEW.entrada_id IS NOT NULL OR NEW.usoconsumo_entrada_id IS NOT NULL THEN 'ENTRADA'
    ELSE 'AVULSO'
  END;
  v_valor := abs(coalesce(NEW.valor, 0));
  v_ator := public.auditoria_usuario_requisicao();

  v_dedupe := CASE
    WHEN NEW.transferencia_id IS NOT NULL THEN 'TRANSF:' || NEW.transferencia_id::text
    ELSE 'TX:' || NEW.id::text || ':' || v_evento || ':'
         || to_char(coalesce(NEW.updated_at, now()), 'YYYYMMDDHH24MISSUS')
  END;

  INSERT INTO public.telegram_financeiro_entrega (
    transacao_id, evento_tipo, dedupe_chave, ator_usuario_id, usuario_id, chat_id
  )
  SELECT NEW.id, v_evento, v_dedupe, v_ator, preferencia.usuario_id, preferencia.chat_id
  FROM public.telegram_usuario_preferencia preferencia
  JOIN public.usuario usuario
    ON usuario.id = preferencia.usuario_id
   AND usuario.ativo = true
  WHERE preferencia.ativo = true
    AND preferencia.chat_id IS NOT NULL
    AND v_evento = ANY(preferencia.financeiro_eventos_selecionados)
    AND v_valor >= coalesce(preferencia.financeiro_valor_minimo, 0)
    -- Transferencia passa direto pelo filtro de origem: ela ja tem evento proprio,
    -- e some-la a lista faria quem escolhe origens perde-la sem perceber.
    AND (
      NEW.transferencia_id IS NOT NULL
      OR coalesce(array_length(preferencia.financeiro_origens_selecionadas, 1), 0) = 0
      OR v_origem = ANY(preferencia.financeiro_origens_selecionadas)
    )
    -- Titulo ainda sem banco definido nunca e excluido pelo filtro de contas:
    -- conta a pagar costuma nascer assim, e o banco so aparece na baixa.
    AND (
      coalesce(array_length(preferencia.financeiro_bancos_selecionados, 1), 0) = 0
      OR NEW.banco_id IS NULL
      OR NEW.banco_id = ANY(preferencia.financeiro_bancos_selecionados)
    )
    AND EXISTS (
      SELECT 1
      FROM public.perfilpermissao perfil_permissao
      JOIN public.permissao permissao
        ON permissao.id = perfil_permissao.permissaoid
      WHERE perfil_permissao.perfilid = usuario.perfilid
        AND upper(btrim(permissao.nome)) = 'FINANCEIRO:VISUALIZAR'
    )
  ON CONFLICT (usuario_id, evento_tipo, dedupe_chave) DO NOTHING;

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
      body := jsonb_build_object('origem', 'FINANCEIRO', 'transacao_id', NEW.id),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Lancamento e baixa nunca falham por causa do aviso: a entrega fica
    -- pendente e o cron ou o botao de processar recuperam.
    RAISE WARNING 'Falha ao agendar notificacao Telegram da transacao %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_telegram_transacao ON public.transacao;
CREATE TRIGGER trg_notificar_telegram_transacao
AFTER INSERT OR UPDATE OF pendente, is_deleted ON public.transacao
FOR EACH ROW
EXECUTE FUNCTION public.fn_notificar_telegram_transacao();

CREATE OR REPLACE FUNCTION public.fn_reservar_entregas_notificacao_financeiro(
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.telegram_financeiro_entrega
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Preferencia, vinculo, usuario ou permissao removidos entre o enfileiramento
  -- e o envio tornam a entrega inelegivel, em vez de deixarem dado financeiro
  -- seguir para o chat.
  UPDATE public.telegram_financeiro_entrega entrega
     SET status = 'DESCARTADO',
         locked_at = NULL,
         next_retry_at = NULL,
         erro_codigo = 'INELIGIVEL',
         erro_mensagem = 'Destinatario sem preferencia, vinculo ou permissao financeira.',
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
         AND entrega.evento_tipo = ANY(preferencia.financeiro_eventos_selecionados)
         AND EXISTS (
           SELECT 1
           FROM public.perfilpermissao perfil_permissao
           JOIN public.permissao permissao
             ON permissao.id = perfil_permissao.permissaoid
           WHERE perfil_permissao.perfilid = usuario.perfilid
             AND upper(btrim(permissao.nome)) = 'FINANCEIRO:VISUALIZAR'
         )
     );

  RETURN QUERY
  WITH selecionadas AS (
    SELECT entrega.id
    FROM public.telegram_financeiro_entrega entrega
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
  UPDATE public.telegram_financeiro_entrega entrega
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

REVOKE ALL ON FUNCTION public.fn_notificar_telegram_transacao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reservar_entregas_notificacao_financeiro(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reservar_entregas_notificacao_financeiro(integer)
  TO service_role;

COMMENT ON TABLE public.telegram_financeiro_entrega IS
  'Fila idempotente dos avisos instantaneos do fluxo de caixa, uma entrega por fato e destinatario.';

COMMIT;

NOTIFY pgrst, 'reload schema';
