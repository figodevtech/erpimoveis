-- Desfazer uma antecipação.
--
-- Até aqui as duas pontas do adiantamento eram intocáveis: nem o lançamento da
-- antecipação nem os títulos que ela liquidou podiam ser excluídos. O motivo era
-- real — tirar a antecipação deixaria os títulos pagos por um dinheiro que não
-- existe mais —, mas a saída escolhida foi recusar tudo, e quem errou o
-- lançamento ficava sem caminho nenhum.
--
-- Agora existe a operação que faltava: excluir a antecipação **devolve** os
-- títulos para em aberto, no mesmo movimento. Uma coisa só, no banco, porque
-- meia execução deixaria títulos quitados sem origem ou dinheiro no caixa sem
-- contrapartida.
--
-- A outra ponta continua fechada, e agora por escolha e não por falta de opção:
-- um título antecipado não sai sozinho, porque o bruto da antecipação é a soma
-- dos líquidos dele e dos irmãos — tirar um faria o lançamento cobrir valor que
-- ninguém deve. Quem quiser mexer nele desfaz a antecipação primeiro.
BEGIN;

CREATE OR REPLACE FUNCTION public.desfazer_adiantamento(
  p_id bigint,
  p_deleted_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_adiantamento public.transacao%ROWTYPE;
  v_titulos bigint[];
  v_documentos jsonb;
  v_titulo record;
BEGIN
  SELECT * INTO v_adiantamento
    FROM public.transacao
   WHERE id = p_id AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento #% não encontrado.', p_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_adiantamento.eh_adiantamento, false) THEN
    RAISE EXCEPTION 'O lançamento #% não é uma antecipação.', p_id USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(id) INTO v_titulos
    FROM public.transacao
   WHERE adiantamento_id = p_id AND is_deleted = false;

  -- Quais documentos serão afetados, capturado antes de soltar o vínculo.
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
           'tipo', CASE WHEN t.ordemservicoid IS NOT NULL THEN 'OS' ELSE 'VENDA' END,
           'id', coalesce(t.ordemservicoid, t.vendaid))), '[]'::jsonb)
    INTO v_documentos
    FROM public.transacao t
   WHERE t.id = ANY (coalesce(v_titulos, ARRAY[]::bigint[]))
     AND coalesce(t.ordemservicoid, t.vendaid) IS NOT NULL;

  IF v_titulos IS NOT NULL THEN
    -- O título volta ao estado anterior à antecipação: em aberto, sem data de
    -- pagamento e sem quem baixou. O banco já era nulo — o dinheiro tinha
    -- entrado pela antecipação, não por ele.
    UPDATE public.transacao
       SET pendente = true,
           pago_em = NULL,
           baixado_por = NULL,
           adiantamento_id = NULL,
           updated_at = now()
     WHERE id = ANY (v_titulos);

    -- O histórico de baixa NÃO é tocado: o sistema o trata como imutável, e com
    -- razão — ele registra que aquela baixa aconteceu, e ela aconteceu mesmo. O
    -- desfazimento é um fato novo, não uma correção do passado. Quem abrir o
    -- título vai ver que foi baixado por antecipação e depois reaberto.
  END IF;

  UPDATE public.transacao
     SET is_deleted = true,
         deleted_at = now(),
         deleted_by = p_deleted_by,
         updated_at = now()
   WHERE id = p_id;

  -- Título reaberto muda o que a OS ou a venda tem de recebido.
  FOR v_titulo IN
    SELECT DISTINCT t.ordemservicoid, t.vendaid
      FROM public.transacao t
     WHERE t.id = ANY (coalesce(v_titulos, ARRAY[]::bigint[]))
  LOOP
    IF v_titulo.ordemservicoid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_os(v_titulo.ordemservicoid);
    ELSIF v_titulo.vendaid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_venda(v_titulo.vendaid);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'id', p_id,
    'titulos_revertidos', coalesce(array_length(v_titulos, 1), 0),
    'titulos', coalesce(to_jsonb(v_titulos), '[]'::jsonb),
    'documentos', v_documentos,
    'tipo', v_adiantamento.tipo::text
  );
END;
$function$;

ALTER FUNCTION public.desfazer_adiantamento(bigint, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.desfazer_adiantamento(bigint, uuid) IS
  'Exclui a transação de antecipação e devolve os títulos que ela liquidou para em aberto, numa operação só.';

REVOKE ALL ON FUNCTION public.desfazer_adiantamento(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desfazer_adiantamento(bigint, uuid) TO service_role;

COMMIT;
