-- Crédito do cliente: a carteira e o razão dela.
--
-- O cliente pode ter saldo a favor dele — sobra de um pagamento, devolução
-- combinada, acordo comercial. Até aqui isso não existia em lugar nenhum: quem
-- controlava anotava fora do sistema, e na hora de abater numa cobrança não
-- havia como registrar.
--
-- O DESENHO
-- O saldo é consequência, nunca um número digitado: `cliente.saldo_credito` é
-- cache mantido por gatilho a partir de `cliente_saldo_movimento`, que é o
-- razão. É o mesmo par que `transacao.valor_baixado` /
-- `recalcular_baixas_transacao` já formam, e o mesmo razão append-only do
-- `estoque_movimento` — corrigir é lançar um movimento novo com
-- `acao = 'ESTORNO'`, nunca apagar ou editar a linha original.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O razão
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cliente_saldo_movimento (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_id integer NOT NULL REFERENCES public.cliente(id) ON DELETE CASCADE,
  -- CREDITO entra na carteira, DEBITO sai dela. O sinal mora aqui e não no
  -- valor: valor negativo em razão é convite a somar errado.
  sentido text NOT NULL CHECK (sentido IN ('CREDITO', 'DEBITO')),
  -- MANUAL é o ajuste feito na aba do cadastro; TRANSACAO é o consumo/geração
  -- automática ao baixar um título com o método Crédito Cliente.
  origem text NOT NULL CHECK (origem IN ('MANUAL', 'TRANSACAO')),
  acao text NOT NULL CHECK (acao IN ('REGISTRO', 'ESTORNO')),
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  -- Fotografia do saldo antes e depois, para o extrato explicar cada linha sem
  -- precisar refazer a soma desde o começo.
  saldo_anterior numeric(14,2),
  saldo_resultante numeric(14,2),
  -- O título que gerou o movimento, quando veio de uma baixa. ON DELETE SET
  -- NULL: se a transação for excluída, o movimento continua valendo — o saldo
  -- do cliente não pode mudar por causa de uma exclusão lá.
  transacao_id bigint REFERENCES public.transacao(id) ON DELETE SET NULL,
  motivo text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cliente_saldo_movimento IS
  'Razão do crédito do cliente. Append-only: estorno é linha nova com acao = ESTORNO, nunca alteração da original.';
COMMENT ON COLUMN public.cliente_saldo_movimento.sentido IS
  'CREDITO entra na carteira do cliente; DEBITO sai dela.';
COMMENT ON COLUMN public.cliente_saldo_movimento.origem IS
  'MANUAL = ajuste na aba do cadastro. TRANSACAO = baixa de título com o método Crédito Cliente.';

CREATE INDEX IF NOT EXISTS cliente_saldo_movimento_cliente_idx
  ON public.cliente_saldo_movimento (cliente_id, id DESC);

CREATE INDEX IF NOT EXISTS cliente_saldo_movimento_transacao_idx
  ON public.cliente_saldo_movimento (transacao_id)
  WHERE transacao_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Imutabilidade
-- ---------------------------------------------------------------------------
--
-- Um razão que pode ser editado não serve de prova. Mesma regra do
-- `estoque_movimento` e do `transacao_baixa_historico`.

CREATE OR REPLACE FUNCTION public.tg_cliente_saldo_movimento_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'O razao do credito do cliente e imutavel: registre um estorno em vez de alterar a linha.'
    USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.tg_cliente_saldo_movimento_imutavel() OWNER TO postgres;

DROP TRIGGER IF EXISTS cliente_saldo_movimento_imutavel_trg ON public.cliente_saldo_movimento;
CREATE TRIGGER cliente_saldo_movimento_imutavel_trg
  BEFORE UPDATE OR DELETE ON public.cliente_saldo_movimento
  FOR EACH ROW EXECUTE FUNCTION public.tg_cliente_saldo_movimento_imutavel();

-- ---------------------------------------------------------------------------
-- 3) O saldo, mantido por gatilho
-- ---------------------------------------------------------------------------
--
-- Coluna e não subconsulta porque a listagem de clientes, o cadastro e o
-- diálogo de baixa precisam do número em toda linha. Gatilho e não conta na
-- aplicação para não haver duas verdades — mesmo desenho de
-- `recalcular_baixas_transacao`.

ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS saldo_credito numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cliente.saldo_credito IS
  'Crédito disponível do cliente. Mantida pelo gatilho cliente_saldo_movimento_trg a partir de cliente_saldo_movimento; não escrever à mão.';

CREATE OR REPLACE FUNCTION public.recalcular_saldo_credito_cliente(p_cliente_id integer)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_saldo numeric(14,2);
BEGIN
  SELECT coalesce(
           sum(CASE WHEN m.sentido = 'CREDITO' THEN m.valor ELSE -m.valor END),
           0
         )
    INTO v_saldo
    FROM public.cliente_saldo_movimento m
   WHERE m.cliente_id = p_cliente_id;

  UPDATE public.cliente
     SET saldo_credito = round(v_saldo, 2),
         updatedat = now()
   WHERE id = p_cliente_id;

  RETURN round(v_saldo, 2);
END;
$function$;

ALTER FUNCTION public.recalcular_saldo_credito_cliente(integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tg_cliente_saldo_movimento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  PERFORM public.recalcular_saldo_credito_cliente(new.cliente_id);
  RETURN new;
END;
$function$;

ALTER FUNCTION public.tg_cliente_saldo_movimento() OWNER TO postgres;

DROP TRIGGER IF EXISTS cliente_saldo_movimento_trg ON public.cliente_saldo_movimento;
CREATE TRIGGER cliente_saldo_movimento_trg
  AFTER INSERT ON public.cliente_saldo_movimento
  FOR EACH ROW EXECUTE FUNCTION public.tg_cliente_saldo_movimento();

-- ---------------------------------------------------------------------------
-- 4) Ajuste manual, pela aba do cadastro
-- ---------------------------------------------------------------------------
--
-- É a única porta para mexer no saldo à mão, e ela grava o movimento junto —
-- não existe caminho que mude o saldo sem deixar linha no razão.

CREATE OR REPLACE FUNCTION public.ajustar_saldo_credito_cliente(
  p_cliente_id integer,
  p_sentido text,
  p_valor numeric,
  p_motivo text DEFAULT NULL,
  p_usuario uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sentido text;
  v_valor numeric(14,2);
  v_saldo_anterior numeric(14,2);
  v_saldo_resultante numeric(14,2);
  v_movimento_id bigint;
BEGIN
  v_sentido := upper(btrim(coalesce(p_sentido, '')));
  IF v_sentido NOT IN ('CREDITO', 'DEBITO') THEN
    RAISE EXCEPTION 'Informe se o ajuste adiciona (CREDITO) ou remove (DEBITO) saldo.'
      USING ERRCODE = '22023';
  END IF;

  v_valor := round(coalesce(p_valor, 0), 2);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'O valor do ajuste deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  -- Trava a linha do cliente: dois ajustes simultâneos não podem ler o mesmo
  -- saldo e gravar cada um o seu.
  SELECT c.saldo_credito INTO v_saldo_anterior
    FROM public.cliente c
   WHERE c.id = p_cliente_id AND c.is_deleted = false
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  v_saldo_anterior := coalesce(v_saldo_anterior, 0);
  v_saldo_resultante := CASE
    WHEN v_sentido = 'CREDITO' THEN v_saldo_anterior + v_valor
    ELSE v_saldo_anterior - v_valor
  END;

  IF v_saldo_resultante < 0 THEN
    RAISE EXCEPTION
      'O cliente tem % de crédito: não dá para remover %.',
      to_char(v_saldo_anterior, 'FM999999990.00'), to_char(v_valor, 'FM999999990.00')
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cliente_saldo_movimento (
    cliente_id, sentido, origem, acao, valor,
    saldo_anterior, saldo_resultante, motivo, created_by
  ) VALUES (
    p_cliente_id, v_sentido, 'MANUAL', 'REGISTRO', v_valor,
    v_saldo_anterior, round(v_saldo_resultante, 2),
    nullif(btrim(coalesce(p_motivo, '')), ''), p_usuario
  ) RETURNING id INTO v_movimento_id;

  RETURN jsonb_build_object(
    'movimento_id', v_movimento_id,
    'cliente_id', p_cliente_id,
    'sentido', v_sentido,
    'valor', v_valor,
    'saldo_anterior', v_saldo_anterior,
    'saldo', round(v_saldo_resultante, 2)
  );
END;
$function$;

ALTER FUNCTION public.ajustar_saldo_credito_cliente(integer, text, numeric, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ajustar_saldo_credito_cliente(integer, text, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_saldo_credito_cliente(integer, text, numeric, text, uuid) TO service_role;

COMMENT ON FUNCTION public.ajustar_saldo_credito_cliente(integer, text, numeric, text, uuid) IS
  'Adiciona ou remove crédito do cliente à mão, gravando o movimento no razão. Recusa remoção que deixaria o saldo negativo.';

-- Só o servidor enxerga o razão, mesma política do `estoque_movimento`.
ALTER TABLE public.cliente_saldo_movimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_saldo_movimento NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cliente_saldo_movimento FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cliente_saldo_movimento TO service_role;

COMMIT;
