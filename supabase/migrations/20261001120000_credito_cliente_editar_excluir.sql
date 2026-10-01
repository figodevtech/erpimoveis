-- Crédito do cliente: editar e excluir o lançamento manual.
--
-- Até aqui o razão `cliente_saldo_movimento` era append-only por inteiro: quem
-- digitasse errado o valor ou o motivo de um ajuste feito na aba do cadastro
-- não tinha como corrigir. Decisão de produto: o ajuste MANUAL pode ser
-- editado e excluído de verdade — a linha muda ou some, o "saldo após" das
-- linhas seguintes é recalculado e o rastro fica na auditoria.
--
-- O QUE CONTINUA IMUTÁVEL
-- A linha que veio de transação (origem = 'TRANSACAO') não é do usuário: ela
-- espelha uma baixa, e desfazê-la é estornar a baixa no financeiro, que já
-- devolve o crédito com linha própria. Também continua valendo que ninguém
-- escreve no razão por fora: só as duas RPCs abaixo ligam a permissão de
-- reescrita, e só dentro da própria transação.
--
-- O LIMITE
-- Reescrever o passado não pode deixar a carteira negativa em ponto nenhum:
-- se o crédito lançado já foi consumido por uma cobrança, reduzi-lo ou
-- excluí-lo é recusado.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Quem mexeu por último
-- ---------------------------------------------------------------------------

ALTER TABLE public.cliente_saldo_movimento
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

COMMENT ON TABLE public.cliente_saldo_movimento IS
  'Razão do crédito do cliente. O ajuste MANUAL pode ser editado ou excluído pelas RPCs editar/excluir_movimento_saldo_cliente, que recalculam o razão; a linha de TRANSACAO é imutável (estorno é linha nova).';

-- ---------------------------------------------------------------------------
-- 2) Imutabilidade, agora com uma porta
-- ---------------------------------------------------------------------------
--
-- Sem a flag de sessão, o comportamento é o de sempre: qualquer UPDATE ou
-- DELETE é recusado — inclusive o SET NULL que a exclusão de uma transação
-- tentaria em `transacao_id`. Com a flag (só as RPCs a ligam):
--   * DELETE apenas de MANUAL/REGISTRO;
--   * UPDATE em MANUAL/REGISTRO só não pode trocar dono, origem, ação,
--     transação e autoria;
--   * UPDATE em qualquer outra linha só pode regravar a fotografia do saldo.

CREATE OR REPLACE FUNCTION public.tg_cliente_saldo_movimento_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_manual boolean := old.origem = 'MANUAL' AND old.acao = 'REGISTRO';
BEGIN
  IF coalesce(current_setting('app.razao_credito_reescrita', true), '') <> 'on' THEN
    RAISE EXCEPTION 'O razao do credito do cliente so muda pela aba de credito do cliente.'
      USING ERRCODE = '42501';
  END IF;

  IF tg_op = 'DELETE' THEN
    IF NOT v_manual THEN
      RAISE EXCEPTION 'So o lancamento manual de credito pode ser excluido.'
        USING ERRCODE = '42501';
    END IF;
    RETURN old;
  END IF;

  IF v_manual THEN
    IF (new.cliente_id, new.origem, new.acao, new.transacao_id, new.created_by, new.created_at)
       IS DISTINCT FROM
       (old.cliente_id, old.origem, old.acao, old.transacao_id, old.created_by, old.created_at) THEN
      RAISE EXCEPTION 'Na edicao do lancamento manual so mudam sentido, valor e motivo.'
        USING ERRCODE = '42501';
    END IF;
    RETURN new;
  END IF;

  IF (to_jsonb(new) - 'saldo_anterior' - 'saldo_resultante')
     IS DISTINCT FROM
     (to_jsonb(old) - 'saldo_anterior' - 'saldo_resultante') THEN
    RAISE EXCEPTION 'O lancamento gerado por transacao e imutavel: estorne a baixa no financeiro.'
      USING ERRCODE = '42501';
  END IF;
  RETURN new;
END;
$$;

ALTER FUNCTION public.tg_cliente_saldo_movimento_imutavel() OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 3) Reconstruir o razão de um cliente
-- ---------------------------------------------------------------------------
--
-- Percorre as linhas na ordem em que foram registradas e regrava a fotografia
-- de cada uma. Quem chama já travou a linha do cliente e ligou a flag.

CREATE OR REPLACE FUNCTION public.reconstruir_razao_credito_cliente(p_cliente_id integer)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_linha record;
  v_saldo numeric(14,2) := 0;
  v_depois numeric(14,2);
BEGIN
  FOR v_linha IN
    SELECT m.id, m.sentido, m.valor, m.origem, m.transacao_id,
           m.saldo_anterior, m.saldo_resultante
      FROM public.cliente_saldo_movimento m
     WHERE m.cliente_id = p_cliente_id
     ORDER BY m.id
  LOOP
    v_depois := round(
      CASE WHEN v_linha.sentido = 'CREDITO' THEN v_saldo + v_linha.valor ELSE v_saldo - v_linha.valor END,
      2
    );

    IF v_depois < 0 THEN
      IF v_linha.origem = 'TRANSACAO' AND v_linha.transacao_id IS NOT NULL THEN
        RAISE EXCEPTION
          'Este crédito já foi usado no título #%: com a alteração o cliente ficaria com R$ % negativos ali.',
          v_linha.transacao_id, to_char(-v_depois, 'FM999999990.00')
          USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION
        'Com a alteração o saldo do cliente ficaria negativo (R$ %) no lançamento #%.',
        to_char(v_depois, 'FM999999990.00'), v_linha.id
        USING ERRCODE = '22023';
    END IF;

    IF (v_linha.saldo_anterior, v_linha.saldo_resultante) IS DISTINCT FROM (v_saldo, v_depois) THEN
      UPDATE public.cliente_saldo_movimento
         SET saldo_anterior = v_saldo,
             saldo_resultante = v_depois
       WHERE id = v_linha.id;
    END IF;

    v_saldo := v_depois;
  END LOOP;

  RETURN public.recalcular_saldo_credito_cliente(p_cliente_id);
END;
$function$;

ALTER FUNCTION public.reconstruir_razao_credito_cliente(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconstruir_razao_credito_cliente(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconstruir_razao_credito_cliente(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Editar o lançamento manual
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.editar_movimento_saldo_cliente(
  p_cliente_id integer,
  p_movimento_id bigint,
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
  v_movimento public.cliente_saldo_movimento%ROWTYPE;
  v_sentido text;
  v_valor numeric(14,2);
  v_motivo text;
  v_saldo numeric(14,2);
BEGIN
  v_sentido := upper(btrim(coalesce(p_sentido, '')));
  IF v_sentido NOT IN ('CREDITO', 'DEBITO') THEN
    RAISE EXCEPTION 'Informe se o lançamento adiciona (CREDITO) ou remove (DEBITO) saldo.'
      USING ERRCODE = '22023';
  END IF;

  v_valor := round(coalesce(p_valor, 0), 2);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'O valor do lançamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');

  -- Mesma trava do ajuste: duas mexidas simultâneas no mesmo cliente não
  -- podem reconstruir o razão cada uma por cima da outra.
  PERFORM 1 FROM public.cliente c
   WHERE c.id = p_cliente_id AND c.is_deleted = false
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_movimento
    FROM public.cliente_saldo_movimento m
   WHERE m.id = p_movimento_id AND m.cliente_id = p_cliente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_movimento.origem <> 'MANUAL' OR v_movimento.acao <> 'REGISTRO' THEN
    RAISE EXCEPTION
      'Este lançamento veio de uma baixa e não pode ser editado. Para desfazê-lo, estorne a baixa no financeiro.'
      USING ERRCODE = '22023';
  END IF;

  IF (v_movimento.sentido, v_movimento.valor, v_movimento.motivo)
     IS NOT DISTINCT FROM (v_sentido, v_valor, v_motivo) THEN
    SELECT c.saldo_credito INTO v_saldo FROM public.cliente c WHERE c.id = p_cliente_id;
    RETURN jsonb_build_object('movimento_id', v_movimento.id, 'alterado', false, 'saldo', v_saldo);
  END IF;

  PERFORM set_config('app.audit_user_id', coalesce(p_usuario::text, ''), true);
  PERFORM set_config('app.razao_credito_reescrita', 'on', true);

  UPDATE public.cliente_saldo_movimento
     SET sentido = v_sentido,
         valor = v_valor,
         motivo = v_motivo,
         updated_at = now(),
         updated_by = p_usuario
   WHERE id = v_movimento.id;

  v_saldo := public.reconstruir_razao_credito_cliente(p_cliente_id);

  PERFORM set_config('app.razao_credito_reescrita', 'off', true);

  RETURN jsonb_build_object('movimento_id', v_movimento.id, 'alterado', true, 'saldo', v_saldo);
END;
$function$;

ALTER FUNCTION public.editar_movimento_saldo_cliente(integer, bigint, text, numeric, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.editar_movimento_saldo_cliente(integer, bigint, text, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_movimento_saldo_cliente(integer, bigint, text, numeric, text, uuid) TO service_role;

COMMENT ON FUNCTION public.editar_movimento_saldo_cliente(integer, bigint, text, numeric, text, uuid) IS
  'Corrige sentido, valor e motivo de um ajuste MANUAL do crédito do cliente e recalcula o razão. Recusa se o saldo ficaria negativo em algum ponto.';

-- ---------------------------------------------------------------------------
-- 5) Excluir o lançamento manual
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.excluir_movimento_saldo_cliente(
  p_cliente_id integer,
  p_movimento_id bigint,
  p_usuario uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_movimento public.cliente_saldo_movimento%ROWTYPE;
  v_saldo numeric(14,2);
BEGIN
  PERFORM 1 FROM public.cliente c
   WHERE c.id = p_cliente_id AND c.is_deleted = false
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_movimento
    FROM public.cliente_saldo_movimento m
   WHERE m.id = p_movimento_id AND m.cliente_id = p_cliente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_movimento.origem <> 'MANUAL' OR v_movimento.acao <> 'REGISTRO' THEN
    RAISE EXCEPTION
      'Este lançamento veio de uma baixa e não pode ser excluído. Para desfazê-lo, estorne a baixa no financeiro.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.audit_user_id', coalesce(p_usuario::text, ''), true);
  PERFORM set_config('app.razao_credito_reescrita', 'on', true);

  DELETE FROM public.cliente_saldo_movimento WHERE id = v_movimento.id;

  v_saldo := public.reconstruir_razao_credito_cliente(p_cliente_id);

  PERFORM set_config('app.razao_credito_reescrita', 'off', true);

  RETURN jsonb_build_object('movimento_id', v_movimento.id, 'excluido', true, 'saldo', v_saldo);
END;
$function$;

ALTER FUNCTION public.excluir_movimento_saldo_cliente(integer, bigint, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.excluir_movimento_saldo_cliente(integer, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_movimento_saldo_cliente(integer, bigint, uuid) TO service_role;

COMMENT ON FUNCTION public.excluir_movimento_saldo_cliente(integer, bigint, uuid) IS
  'Exclui um ajuste MANUAL do crédito do cliente e recalcula o razão. Recusa se o saldo ficaria negativo em algum ponto.';

-- ---------------------------------------------------------------------------
-- 6) Auditoria
-- ---------------------------------------------------------------------------
--
-- Como a linha some de verdade, a auditoria é o único lugar que lembra dela.
-- Só a mudança de conteúdo do manual: a regravação da fotografia do saldo nas
-- outras linhas é consequência, não ato de ninguém.

DROP TRIGGER IF EXISTS auditoria_cliente_saldo_movimento_update ON public.cliente_saldo_movimento;
CREATE TRIGGER auditoria_cliente_saldo_movimento_update
AFTER UPDATE ON public.cliente_saldo_movimento
FOR EACH ROW
WHEN (
  old.origem = 'MANUAL'
  AND (old.sentido, old.valor, old.motivo) IS DISTINCT FROM (new.sentido, new.valor, new.motivo)
)
EXECUTE FUNCTION public.registrar_auditoria();

DROP TRIGGER IF EXISTS auditoria_cliente_saldo_movimento_delete ON public.cliente_saldo_movimento;
CREATE TRIGGER auditoria_cliente_saldo_movimento_delete
AFTER DELETE ON public.cliente_saldo_movimento
FOR EACH ROW
WHEN (old.origem = 'MANUAL')
EXECUTE FUNCTION public.registrar_auditoria();

COMMIT;
