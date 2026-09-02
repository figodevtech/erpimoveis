BEGIN;

-- Avisos fiscais no Telegram: NF-e/NFC-e, NFS-e e notas de terceiros.
--
-- O gatilho fica no banco, e nao nas rotas, porque os tres documentos mudam de
-- estado por caminhos diferentes: a NF-e pelas rotas da SEFAZ, a NFS-e tambem
-- pelo webhook da Focus (assincrono) e a nota de terceiros dentro da RPC de
-- sincronizacao da distribuicao. Hook em rota perderia os dois ultimos.
ALTER TABLE public.telegram_usuario_preferencia
  ADD COLUMN IF NOT EXISTS fiscal_eventos_selecionados text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.telegram_usuario_preferencia
  DROP CONSTRAINT IF EXISTS telegram_preferencia_fiscal_eventos_check;
ALTER TABLE public.telegram_usuario_preferencia
  ADD CONSTRAINT telegram_preferencia_fiscal_eventos_check CHECK (
    fiscal_eventos_selecionados <@ ARRAY[
      'NFE_AUTORIZADA',
      'NFE_REJEITADA',
      'NFE_DENEGADA',
      'NFE_CANCELADA',
      'NFE_RESULTADO_INCERTO',
      'NFSE_AUTORIZADA',
      'NFSE_REJEITADA',
      'NFSE_CANCELADA',
      'DFE_RECEBIDA',
      'DFE_CANCELADA'
    ]::text[]
  );

CREATE TABLE IF NOT EXISTS public.telegram_fiscal_entrega (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  documento_tipo text NOT NULL CHECK (documento_tipo IN ('NFE', 'NFSE', 'DFE')),
  documento_id bigint NOT NULL,
  evento_tipo text NOT NULL CHECK (evento_tipo IN (
    'NFE_AUTORIZADA',
    'NFE_REJEITADA',
    'NFE_DENEGADA',
    'NFE_CANCELADA',
    'NFE_RESULTADO_INCERTO',
    'NFSE_AUTORIZADA',
    'NFSE_REJEITADA',
    'NFSE_CANCELADA',
    'DFE_RECEBIDA',
    'DFE_CANCELADA'
  )),
  -- A mesma nota de terceiro chega duas vezes na distribuicao (o resumo e,
  -- depois, o XML completo), em linhas diferentes de fiscal_dfe_documento. A
  -- deduplicacao e por chave de acesso, nao por id de documento.
  dedupe_chave text NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_telegram_fiscal_entrega_fila
  ON public.telegram_fiscal_entrega(status, next_retry_at, id);
CREATE INDEX IF NOT EXISTS idx_telegram_fiscal_entrega_usuario
  ON public.telegram_fiscal_entrega(usuario_id, created_at DESC);

ALTER TABLE public.telegram_fiscal_entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_fiscal_entrega NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_fiscal_entrega FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.telegram_fiscal_entrega TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.telegram_fiscal_entrega_id_seq TO service_role;

-- Enfileiramento comum aos tres documentos: escolhe os destinatarios que
-- pediram o evento e tem acesso as notas fiscais, e acorda o worker.
CREATE OR REPLACE FUNCTION public.fn_enfileirar_notificacao_fiscal(
  p_documento_tipo text,
  p_documento_id bigint,
  p_evento_tipo text,
  p_dedupe_chave text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quantidade_entregas integer := 0;
  v_endpoint_url text;
  v_bearer_token text;
BEGIN
  INSERT INTO public.telegram_fiscal_entrega (
    documento_tipo,
    documento_id,
    evento_tipo,
    dedupe_chave,
    usuario_id,
    chat_id
  )
  SELECT
    p_documento_tipo,
    p_documento_id,
    p_evento_tipo,
    p_dedupe_chave,
    preferencia.usuario_id,
    preferencia.chat_id
  FROM public.telegram_usuario_preferencia preferencia
  JOIN public.usuario usuario
    ON usuario.id = preferencia.usuario_id
   AND usuario.ativo = true
  WHERE preferencia.ativo = true
    AND preferencia.chat_id IS NOT NULL
    AND p_evento_tipo = ANY(preferencia.fiscal_eventos_selecionados)
    AND EXISTS (
      SELECT 1
      FROM public.perfilpermissao perfil_permissao
      JOIN public.permissao permissao
        ON permissao.id = perfil_permissao.permissaoid
      WHERE perfil_permissao.perfilid = usuario.perfilid
        AND upper(btrim(permissao.nome)) = 'FINANCEIRO:NOTAS_FISCAIS'
    )
  ON CONFLICT (usuario_id, evento_tipo, dedupe_chave) DO NOTHING;

  GET DIAGNOSTICS v_quantidade_entregas = ROW_COUNT;
  IF v_quantidade_entregas = 0 THEN
    RETURN;
  END IF;

  SELECT endpoint_url, bearer_token
    INTO v_endpoint_url, v_bearer_token
    FROM public.telegram_dispatch_configuracao
   WHERE id = 1 AND ativo = true;

  IF v_endpoint_url IS NULL OR v_bearer_token IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_endpoint_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_bearer_token
      ),
      body := jsonb_build_object(
        'origem', 'FISCAL',
        'documento_tipo', p_documento_tipo,
        'documento_id', p_documento_id
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- A entrega continua pendente e e recuperada pelo cron ou pelo botao de
    -- processamento manual. Emissao fiscal nunca falha por causa do aviso.
    RAISE WARNING 'Falha ao agendar notificacao Telegram do documento fiscal % %: %',
      p_documento_tipo, p_documento_id, SQLERRM;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notificar_telegram_nfe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.is_deleted, false) THEN
    RETURN NEW;
  END IF;
  -- Homologacao e teste: nota de teste nao vira aviso. Rascunho antigo sem
  -- ambiente gravado conta como producao para nao engolir aviso legitimo.
  IF coalesce(NEW.ambiente, 'PRODUCAO') <> 'PRODUCAO' THEN
    RETURN NEW;
  END IF;

  v_evento := CASE upper(btrim(coalesce(NEW.status, '')))
    WHEN 'AUTORIZADA' THEN 'NFE_AUTORIZADA'
    WHEN 'REJEITADA' THEN 'NFE_REJEITADA'
    WHEN 'DENEGADA' THEN 'NFE_DENEGADA'
    WHEN 'CANCELADA' THEN 'NFE_CANCELADA'
    WHEN 'RESULTADO_INCERTO' THEN 'NFE_RESULTADO_INCERTO'
    ELSE NULL
  END;

  IF v_evento IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.fn_enfileirar_notificacao_fiscal(
    'NFE', NEW.id::bigint, v_evento, 'NFE:' || NEW.id::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_telegram_nfe ON public.nfe;
CREATE TRIGGER trg_notificar_telegram_nfe
AFTER INSERT OR UPDATE OF status ON public.nfe
FOR EACH ROW
EXECUTE FUNCTION public.fn_notificar_telegram_nfe();

CREATE OR REPLACE FUNCTION public.fn_notificar_telegram_nfse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Denegacao de NFS-e volta com o motivo no mesmo lugar da rejeicao e exige a
  -- mesma correcao: um evento so.
  v_evento := CASE upper(btrim(coalesce(NEW.status, '')))
    WHEN 'AUTORIZADA' THEN 'NFSE_AUTORIZADA'
    WHEN 'REJEITADA' THEN 'NFSE_REJEITADA'
    WHEN 'DENEGADA' THEN 'NFSE_REJEITADA'
    WHEN 'CANCELADA' THEN 'NFSE_CANCELADA'
    ELSE NULL
  END;

  IF v_evento IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.fn_enfileirar_notificacao_fiscal(
    'NFSE', NEW.id::bigint, v_evento, 'NFSE:' || NEW.id::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_telegram_nfse ON public.nfse;
CREATE TRIGGER trg_notificar_telegram_nfse
AFTER INSERT OR UPDATE OF status ON public.nfse
FOR EACH ROW
EXECUTE FUNCTION public.fn_notificar_telegram_nfse();

CREATE OR REPLACE FUNCTION public.fn_notificar_telegram_dfe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chave text;
BEGIN
  -- Evento e manifestacao entram no mesmo razao; so NF-e de terceiro vira aviso.
  IF upper(btrim(coalesce(NEW.tipo_documento, ''))) NOT IN ('RESUMO_NFE', 'PROC_NFE') THEN
    RETURN NEW;
  END IF;

  v_chave := coalesce(nullif(btrim(coalesce(NEW.chave_acesso, '')), ''), 'NSU-' || NEW.nsu);

  IF TG_OP = 'INSERT' THEN
    -- A distribuicao devolve ate 90 dias de documentos na primeira sincronizacao
    -- da empresa. Avisar sobre todos eles seria uma enxurrada de mensagens sobre
    -- notas antigas: so entra o que foi emitido nos ultimos dias, que e o caso em
    -- que alguem ainda precisa manifestar ou dar entrada.
    IF NEW.data_emissao IS NOT NULL AND NEW.data_emissao < now() - interval '3 days' THEN
      RETURN NEW;
    END IF;

    PERFORM public.fn_enfileirar_notificacao_fiscal(
      'DFE', NEW.id::bigint, 'DFE_RECEBIDA', 'DFE:' || v_chave
    );
    RETURN NEW;
  END IF;

  -- 101 cancelada, 110 denegada: a nota deixou de valer depois de ja ter sido
  -- reconhecida aqui, e quem deu entrada nela precisa saber.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND btrim(coalesce(NEW.status, '')) IN ('101', '110') THEN
    PERFORM public.fn_enfileirar_notificacao_fiscal(
      'DFE', NEW.id::bigint, 'DFE_CANCELADA', 'DFE-CANC:' || v_chave
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_telegram_dfe ON public.fiscal_dfe_documento;
CREATE TRIGGER trg_notificar_telegram_dfe
AFTER INSERT OR UPDATE OF status ON public.fiscal_dfe_documento
FOR EACH ROW
EXECUTE FUNCTION public.fn_notificar_telegram_dfe();

CREATE OR REPLACE FUNCTION public.fn_reservar_entregas_notificacao_fiscal(
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.telegram_fiscal_entrega
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Preferencia, vinculo, usuario ou permissao removidos entre o enfileiramento
  -- e o envio tornam a entrega inelegivel, em vez de deixarem dado fiscal
  -- seguir para o chat.
  UPDATE public.telegram_fiscal_entrega entrega
     SET status = 'DESCARTADO',
         locked_at = NULL,
         next_retry_at = NULL,
         erro_codigo = 'INELIGIVEL',
         erro_mensagem = 'Destinatario sem preferencia, vinculo ou permissao de notas fiscais.',
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
         AND entrega.evento_tipo = ANY(preferencia.fiscal_eventos_selecionados)
         AND EXISTS (
           SELECT 1
           FROM public.perfilpermissao perfil_permissao
           JOIN public.permissao permissao
             ON permissao.id = perfil_permissao.permissaoid
           WHERE perfil_permissao.perfilid = usuario.perfilid
             AND upper(btrim(permissao.nome)) = 'FINANCEIRO:NOTAS_FISCAIS'
         )
     );

  RETURN QUERY
  WITH selecionadas AS (
    SELECT entrega.id
    FROM public.telegram_fiscal_entrega entrega
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
  UPDATE public.telegram_fiscal_entrega entrega
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

REVOKE ALL ON FUNCTION public.fn_enfileirar_notificacao_fiscal(text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notificar_telegram_nfe() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notificar_telegram_nfse() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_notificar_telegram_dfe() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reservar_entregas_notificacao_fiscal(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reservar_entregas_notificacao_fiscal(integer)
  TO service_role;

COMMENT ON COLUMN public.telegram_usuario_preferencia.fiscal_eventos_selecionados IS
  'Eventos de documentos fiscais que o destinatario escolheu receber pelo Telegram.';
COMMENT ON TABLE public.telegram_fiscal_entrega IS
  'Fila idempotente de avisos fiscais no Telegram, deduplicada por evento e destinatario.';
COMMENT ON COLUMN public.telegram_fiscal_entrega.dedupe_chave IS
  'Identidade do fato notificado. Na nota de terceiro e a chave de acesso, porque resumo e XML completo sao duas linhas do mesmo documento.';

COMMIT;

NOTIFY pgrst, 'reload schema';
