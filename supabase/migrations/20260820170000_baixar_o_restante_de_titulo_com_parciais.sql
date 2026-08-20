-- Baixar o restante de um título que já tem baixas parciais.
--
-- O QUE QUEBROU
-- No banco do Demir, o título #382 (R$ 758,65) recebeu um pagamento parcial de
-- R$ 37,57. Ao marcar o restante como pago, a baixa era recusada com:
--
--   "O título #382 é pago em partes e o dinheiro dele está nas baixas parciais.
--    Dar banco a ele somaria o mesmo valor duas vezes."
--
-- A trava estava certa; quem chamou é que pediu a coisa errada. `p_valor` nulo
-- significa "baixa de uma vez", e esse caminho grava o banco no próprio título —
-- o que num título que já tem filhas duplicaria o dinheiro. A recusa impediu o
-- estrago, mas deixou o usuário sem como terminar de receber.
--
-- POR QUE `p_valor` CHEGAVA NULO
-- Duas portas mandam nulo, e as duas por bons motivos até aqui:
--
--   - a tela só manda `p_valor` quando o número digitado é MENOR que o saldo;
--     pagando o restante exato ele é igual, e ela mandava nulo para não criar
--     uma filha onde o título daria conta sozinho;
--   - a baixa em lote manda nulo sempre, porque baixa dezenas de títulos com um
--     banco só e não tem como falar de saldo de cada um.
--
-- Corrigir só a tela deixaria o lote quebrado do mesmo jeito, e a próxima porta
-- a aparecer erraria de novo. A regra pertence a quem conhece o estado do
-- título, que é esta função.
--
-- A REGRA
-- Título que JÁ TEM baixas parciais nunca mais volta a carregar banco: o dinheiro
-- dele mora nas filhas, inclusive o da baixa que o fecha. Então `p_valor` nulo
-- num título assim passa a significar "o restante", e a baixa segue pelo caminho
-- da filha. Sem filhas, nulo continua sendo a baixa de uma vez de sempre.
BEGIN;

CREATE OR REPLACE FUNCTION public.baixar_transacao_pendente(
  p_transacao_id bigint,
  p_pago_em timestamp with time zone,
  p_banco_id bigint,
  p_metodopagamento text,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_baixado_por uuid DEFAULT NULL,
  p_valor numeric DEFAULT NULL,
  p_valor_lancado numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_metodo public.metodo_pagamento;
  v_antecipada boolean;
  v_atual public.transacao%ROWTYPE;
  v_liquido numeric(14,2);
  v_saldo numeric(14,2);
  v_filha_id bigint;
  v_lancado numeric(14,2);
  v_valor numeric(14,2);
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_pago_em IS NULL THEN
    RAISE EXCEPTION 'Data do pagamento obrigatória.' USING ERRCODE = '22023';
  END IF;
  IF p_banco_id IS NULL OR p_banco_id <= 0 THEN
    RAISE EXCEPTION 'Banco obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_metodopagamento), '') IS NULL THEN
    RAISE EXCEPTION 'Método de pagamento obrigatório.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_metodo := btrim(p_metodopagamento)::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Método de pagamento inválido: %.', btrim(p_metodopagamento)
      USING ERRCODE = '22023';
  END;

  SELECT * INTO v_atual FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_atual.pendente, false) THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  v_antecipada := v_atual.adiantamento_id IS NOT NULL;
  v_liquido := round(coalesce(nullif(v_atual."valorLiquido", 0), v_atual.valor, 0), 2);
  v_saldo := round(v_liquido - coalesce(v_atual.valor_baixado, 0), 2);
  v_lancado := round(coalesce(p_valor_lancado, 0), 2);
  v_valor := p_valor;

  /*
   * Quem já foi pago em partes termina em partes.
   *
   * O título com filhas não pode voltar a carregar banco — seria o mesmo dinheiro
   * no título e nas baixas dele. Então quem chama sem dizer o valor (a tela
   * pagando o restante exato, a baixa em lote) está pedindo "termina de receber",
   * e é isso que a função entrega: o saldo, pelo caminho da filha.
   *
   * Antecipado fica de fora: lá a filha é repasse de caixa e não quitação, e o
   * `valor_baixado` dele não é saldo a pagar.
   */
  IF v_valor IS NULL
     AND NOT coalesce(v_antecipada, false)
     AND coalesce(v_atual.valor_baixado, 0) > 0 THEN
    v_valor := v_saldo;
  END IF;

  IF p_valor_lancado IS NOT NULL THEN
    IF NOT coalesce(v_antecipada, false) THEN
      RAISE EXCEPTION
        'Só título antecipado escolhe quanto da baixa entra no caixa: neste o banco já é sempre gravado.'
        USING ERRCODE = '22023';
    END IF;
    IF v_lancado < 0 THEN
      RAISE EXCEPTION 'O valor lançado não pode ser negativo.' USING ERRCODE = '22023';
    END IF;
    IF v_lancado > v_liquido THEN
      RAISE EXCEPTION
        'O valor lançado (%) passa do valor do título (%).', v_lancado, v_liquido
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_valor IS NOT NULL THEN
    IF round(v_valor, 2) <= 0 THEN
      RAISE EXCEPTION 'O valor da baixa deve ser maior que zero.' USING ERRCODE = '22023';
    END IF;
    IF round(v_valor, 2) > v_saldo THEN
      RAISE EXCEPTION
        'A baixa de % passa do saldo em aberto do título, que é de %.',
        round(v_valor, 2), v_saldo USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_antecipada, false) THEN
      RAISE EXCEPTION
        'Título antecipado ainda não aceita baixa parcial.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- --------------------------------------------------------------- parcial
  IF v_valor IS NOT NULL
     AND (round(v_valor, 2) < v_saldo OR coalesce(v_atual.valor_baixado, 0) > 0) THEN

    -- O banco que estava no título era a conta PREVISTA, escolhida no
    -- lançamento. A partir daqui o dinheiro mora nas baixas, e cada uma sabe por
    -- onde entrou de verdade.
    IF v_atual.banco_id IS NOT NULL THEN
      UPDATE public.transacao SET banco_id = NULL, updated_at = now()
       WHERE id = p_transacao_id;
    END IF;

    v_filha_id := public.registrar_baixa_filha(
      v_atual, round(v_valor, 2), p_pago_em, p_banco_id, v_metodo,
      p_plano_de_conta_id, p_centro_custo_id, p_baixado_por, false
    );

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
    ) VALUES (
      v_atual.id, coalesce(v_atual.vencimento_em, v_atual.data), p_pago_em,
      p_baixado_por, p_banco_id, v_metodo
    );

    SELECT * INTO v_transacao FROM public.transacao WHERE id = p_transacao_id;

    IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_transacao.id,
      'baixa_id', v_filha_id,
      'valor_baixado', v_transacao.valor_baixado,
      'saldo', round(v_liquido - v_transacao.valor_baixado, 2),
      'pendente', v_transacao.pendente,
      'parcial', true
    );
  END IF;

  -- ------------------------------------------------------------- de uma vez
  UPDATE public.transacao
  SET vencimento_em = coalesce(vencimento_em, data),
      data = p_pago_em,
      pago_em = p_pago_em,
      baixado_por = p_baixado_por,
      banco_id = CASE WHEN coalesce(v_antecipada, false) THEN NULL ELSE p_banco_id END,
      metodopagamento = v_metodo,
      plano_de_conta_id = p_plano_de_conta_id,
      centro_custo_id = p_centro_custo_id,
      pendente = false,
      updated_at = now()
  WHERE id = p_transacao_id
    AND pendente = true
    AND is_deleted = false
  RETURNING * INTO v_transacao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  IF coalesce(v_antecipada, false) AND v_lancado > 0 THEN
    v_filha_id := public.registrar_baixa_filha(
      v_atual, v_lancado, p_pago_em, p_banco_id, v_metodo,
      p_plano_de_conta_id, p_centro_custo_id, p_baixado_por, true
    );
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    v_transacao.baixado_por,
    CASE WHEN v_filha_id IS NOT NULL THEN p_banco_id ELSE v_transacao.banco_id END,
    v_transacao.metodopagamento
  );

  IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
    IF v_transacao.ordemservicoid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
    END IF;

    IF v_transacao.vendaid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
    END IF;

    IF v_transacao.pagamento_multiplo_id IS NOT NULL THEN
      PERFORM public.recalcular_documentos_da_transacao(v_transacao.id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pago_em', v_transacao.pago_em,
    'vencimento_em', v_transacao.vencimento_em,
    'pendente', false,
    'parcial', false,
    'baixa_id', v_filha_id,
    'valor_lancado', coalesce(v_lancado, 0)
  );
END;
$function$;

ALTER FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, numeric, numeric
) OWNER TO postgres;

COMMENT ON FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, numeric, numeric
) IS
  'Dá baixa num título em aberto. p_valor diz quanto está sendo liquidado; nulo é a baixa de uma vez, salvo em título que já tem baixas parciais, onde significa o restante. p_valor_lancado diz quanto entra na conta, e só título antecipado responde.';

COMMIT;
