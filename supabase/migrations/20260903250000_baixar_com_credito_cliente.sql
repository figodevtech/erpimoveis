-- Baixar um título com o crédito do cliente.
--
-- É uma baixa como qualquer outra do ponto de vista do documento — a OS/venda
-- fica quitada —, mas nenhum dinheiro se move: em vez do banco, quem paga é a
-- carteira do cliente (`cliente.saldo_credito`).
--
-- POR QUE UMA RPC PRÓPRIA, E NÃO UM RAMO EM `baixar_transacao_pendente`
-- Aquela função já carrega três caminhos entrelaçados (baixa de uma vez, baixa
-- parcial com filha, repasse de título antecipado) e começa exigindo banco em
-- toda chamada. Crédito Cliente não tem banco, não cria filha e quita sempre o
-- título inteiro — é o mesmo desenho do `abonar_transacao_pendente`, que já
-- resolveu esse dilema com função separada. A rota é que escolhe qual chamar,
-- então para quem usa continua sendo o mesmo diálogo de baixa.
--
-- DE QUEM É O TÍTULO
-- `transacao.cliente_id` quase sempre é nulo em pagamento de OS/venda: o que se
-- grava é `ordemservicoid`/`vendaid`. A precedência
-- `coalesce(cliente_id, os.clienteid, v.clienteid)` é a mesma da view
-- `transacao_cliente` (20260824140000), que já governa a dívida e o Score —
-- reaproveitada aqui para não existir uma segunda resposta para a mesma
-- pergunta.
--
-- OS DOIS SENTIDOS
-- A receber quitado com crédito CONSOME a carteira, e exige saldo que cubra o
-- título inteiro. A pagar (uma despesa ligada ao cliente, tipicamente uma
-- devolução) quitado com crédito faz o contrário: em vez de devolver dinheiro,
-- CREDITA a carteira — é uma das formas de o cliente ganhar saldo.
BEGIN;

CREATE OR REPLACE FUNCTION public.baixar_com_credito_cliente(
  p_transacao_id bigint,
  p_pago_em timestamp with time zone,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_baixado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_atual public.transacao%ROWTYPE;
  v_transacao public.transacao%ROWTYPE;
  v_tipo text;
  v_cliente_id integer;
  v_sentido text;
  v_valor numeric(14,2);
  v_saldo_anterior numeric(14,2);
  v_saldo_resultante numeric(14,2);
  v_movimento_id bigint;
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_pago_em IS NULL THEN
    RAISE EXCEPTION 'Data do pagamento obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(v_atual.pendente, false) THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  v_tipo := upper(v_atual.tipo::text);
  IF v_tipo NOT IN ('RECEITA', 'DESPESA') THEN
    RAISE EXCEPTION
      'Crédito do cliente vale para título a receber ou a pagar, não para depósito ou saque.'
      USING ERRCODE = '22023';
  END IF;

  -- As mesmas recusas do abono: são conjuntos que se liquidam juntos, e mexer
  -- numa perna sozinha desmonta a conta do grupo.
  IF v_atual.baixa_de_transacao_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta linha é o dinheiro de uma baixa parcial, não um título.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.adiantamento_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Este título está ligado à antecipação #%. Desfaça a antecipação primeiro.',
      v_atual.adiantamento_id USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_atual.eh_adiantamento, false) THEN
    RAISE EXCEPTION 'Isto é uma antecipação, não uma cobrança avulsa.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta cobrança faz parte do pagamento múltiplo #%. Desfaça o grupo primeiro.',
      v_atual.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;
  IF v_atual.transferencia_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta linha é uma perna de transferência entre contas.' USING ERRCODE = '22023';
  END IF;
  -- O crédito quita o título inteiro, então um título que já recebeu pagamento
  -- em partes não entra: o resto dele mora nas filhas, e fechá-lo por aqui
  -- deixaria o dinheiro contado duas vezes.
  IF coalesce(v_atual.valor_baixado, 0) > 0 THEN
    RAISE EXCEPTION
      'Este título já foi pago em partes. O crédito do cliente só quita título inteiro.'
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------- de quem é
  IF v_tipo = 'RECEITA' THEN
    v_cliente_id := coalesce(
      v_atual.cliente_id,
      (SELECT os.clienteid FROM public.ordemservico os WHERE os.id = v_atual.ordemservicoid),
      (SELECT vd.clienteid FROM public.venda vd WHERE vd.id = v_atual.vendaid)
    );
  ELSE
    -- Numa despesa o vínculo com OS/venda é do fornecedor, não do cliente: o
    -- único dono possível é o que foi gravado na própria linha.
    v_cliente_id := v_atual.cliente_id;
  END IF;

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION
      'Este lançamento não tem cliente vinculado. Informe o cliente nele antes de usar o crédito.'
      USING ERRCODE = '22023';
  END IF;

  v_valor := round(coalesce(nullif(v_atual."valorLiquido", 0), v_atual.valor, 0), 2);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'O título não tem valor a baixar.' USING ERRCODE = '22023';
  END IF;

  -- A receber consome a carteira; a pagar abastece.
  v_sentido := CASE WHEN v_tipo = 'RECEITA' THEN 'DEBITO' ELSE 'CREDITO' END;

  SELECT c.saldo_credito INTO v_saldo_anterior
    FROM public.cliente c
   WHERE c.id = v_cliente_id AND c.is_deleted = false
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
      'O cliente tem R$ % de crédito e este título é de R$ %.',
      to_char(v_saldo_anterior, 'FM999999990.00'),
      to_char(v_valor, 'FM999999990.00')
      USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------- a baixa
  UPDATE public.transacao
     SET vencimento_em = coalesce(vencimento_em, data),
         data = p_pago_em,
         pago_em = p_pago_em,
         pendente = false,
         -- Nunca passa por conta: é isto que mantém a linha fora do Fluxo e do
         -- saldo dos bancos, como já acontece no título quitado por antecipação
         -- e no abonado.
         banco_id = NULL,
         metodopagamento = 'CREDITO CLIENTE'::public.metodo_pagamento,
         baixado_por = p_baixado_por,
         plano_de_conta_id = coalesce(p_plano_de_conta_id, plano_de_conta_id),
         centro_custo_id = coalesce(p_centro_custo_id, centro_custo_id),
         updated_at = now()
   WHERE id = p_transacao_id
     AND pendente = true
     AND is_deleted = false
  RETURNING * INTO v_transacao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.cliente_saldo_movimento (
    cliente_id, sentido, origem, acao, valor,
    saldo_anterior, saldo_resultante, transacao_id, motivo, created_by
  ) VALUES (
    v_cliente_id, v_sentido, 'TRANSACAO', 'REGISTRO', v_valor,
    v_saldo_anterior, round(v_saldo_resultante, 2), v_transacao.id,
    CASE
      WHEN v_sentido = 'DEBITO' THEN 'Baixa do título #' || v_transacao.id
      ELSE 'Crédito gerado pelo título #' || v_transacao.id
    END,
    p_baixado_por
  ) RETURNING id INTO v_movimento_id;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    p_baixado_por, NULL, 'CREDITO CLIENTE', 'BAIXA'
  );

  IF v_tipo = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
    IF v_transacao.ordemservicoid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
    END IF;
    IF v_transacao.vendaid IS NOT NULL THEN
      PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', false,
    'cliente_id', v_cliente_id,
    'sentido', v_sentido,
    'valor', v_valor,
    'movimento_id', v_movimento_id,
    'saldo', round(v_saldo_resultante, 2)
  );
END;
$function$;

ALTER FUNCTION public.baixar_com_credito_cliente(bigint, timestamp with time zone, integer, integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.baixar_com_credito_cliente(bigint, timestamp with time zone, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.baixar_com_credito_cliente(bigint, timestamp with time zone, integer, integer, uuid) TO service_role;

COMMENT ON FUNCTION public.baixar_com_credito_cliente(bigint, timestamp with time zone, integer, integer, uuid) IS
  'Quita um título inteiro com o crédito do cliente, sem tocar em banco: a receber consome a carteira (exige saldo), a pagar credita. Grava o movimento no razão do cliente.';

-- ---------------------------------------------------------------------------
-- Estornar devolve o crédito
-- ---------------------------------------------------------------------------
--
-- Ramo novo em `estornar_baixa_transacao`, ao lado do ramo do abono e pelo
-- mesmo motivo: a baixa por crédito não tem banco nem filha, então nenhum dos
-- checks seguintes descreve o que aconteceu com ela. O saldo volta por um
-- movimento novo com `acao = 'ESTORNO'` — o razão nunca é reescrito.

CREATE OR REPLACE FUNCTION public.estornar_baixa_transacao(
  p_transacao_id bigint,
  p_estornado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_acrescimos_removidos numeric(14,2) := 0;
  v_valor_reaberto numeric(14,2);
  v_baixa_do_titulo boolean := false;
  v_titulo bigint;
  v_movimento public.cliente_saldo_movimento%ROWTYPE;
  v_sentido_estorno text;
  v_saldo_anterior numeric(14,2);
  v_saldo_resultante numeric(14,2);
BEGIN
  SELECT * INTO v_transacao
    FROM public.transacao
   WHERE id = p_transacao_id AND is_deleted = false
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_transacao.baixa_de_transacao_id IS NOT NULL THEN
    v_titulo := v_transacao.baixa_de_transacao_id;

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_titulo, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, v_transacao.banco_id, v_transacao.metodopagamento, 'ESTORNO'
    );

    DELETE FROM public.transacao WHERE id = p_transacao_id;

    SELECT * INTO v_transacao FROM public.transacao WHERE id = v_titulo;

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_titulo,
      'baixa_estornada', p_transacao_id,
      'valor_baixado', v_transacao.valor_baixado,
      'pendente', v_transacao.pendente,
      'parcial', true
    );
  END IF;

  IF coalesce(v_transacao.pendente, false) THEN
    RAISE EXCEPTION 'Esta transação não está liquidada: não há baixa a estornar.'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_transacao.abonado, false) THEN
    UPDATE public.transacao
       SET pendente = true,
           data = coalesce(vencimento_em, data),
           pago_em = NULL,
           abonado = false,
           abonado_por = NULL,
           abonado_em = NULL,
           abono_motivo = NULL,
           updated_at = now()
     WHERE id = p_transacao_id;

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_transacao.id, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, NULL, NULL, 'ESTORNO'
    );

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_transacao.id,
      'pendente', true,
      'abono_desfeito', true
    );
  END IF;

  -- ------------------------------------------------- baixa por crédito
  --
  -- A última linha do razão daquela transação diz se ainda há o que desfazer:
  -- REGISTRO é baixa em pé, ESTORNO é ciclo já fechado.
  SELECT * INTO v_movimento
    FROM public.cliente_saldo_movimento m
   WHERE m.transacao_id = p_transacao_id
     AND m.origem = 'TRANSACAO'
   ORDER BY m.id DESC
   LIMIT 1;

  IF FOUND AND v_movimento.acao = 'REGISTRO' THEN
    v_sentido_estorno := CASE WHEN v_movimento.sentido = 'DEBITO' THEN 'CREDITO' ELSE 'DEBITO' END;

    SELECT c.saldo_credito INTO v_saldo_anterior
      FROM public.cliente c
     WHERE c.id = v_movimento.cliente_id
       FOR UPDATE;

    v_saldo_anterior := coalesce(v_saldo_anterior, 0);
    v_saldo_resultante := CASE
      WHEN v_sentido_estorno = 'CREDITO' THEN v_saldo_anterior + v_movimento.valor
      ELSE v_saldo_anterior - v_movimento.valor
    END;

    -- Só acontece no título a pagar: o crédito que ele gerou já foi gasto em
    -- outra cobrança, e tirá-lo agora deixaria a carteira negativa.
    IF v_saldo_resultante < 0 THEN
      RAISE EXCEPTION
        'O crédito gerado por esta baixa já foi usado: o cliente tem R$ % e o estorno retiraria R$ %.',
        to_char(v_saldo_anterior, 'FM999999990.00'),
        to_char(v_movimento.valor, 'FM999999990.00')
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.transacao
       SET pendente = true,
           data = coalesce(vencimento_em, data),
           pago_em = NULL,
           baixado_por = NULL,
           updated_at = now()
     WHERE id = p_transacao_id;

    INSERT INTO public.cliente_saldo_movimento (
      cliente_id, sentido, origem, acao, valor,
      saldo_anterior, saldo_resultante, transacao_id, motivo, created_by
    ) VALUES (
      v_movimento.cliente_id, v_sentido_estorno, 'TRANSACAO', 'ESTORNO', v_movimento.valor,
      v_saldo_anterior, round(v_saldo_resultante, 2), p_transacao_id,
      'Estorno da baixa do título #' || p_transacao_id, p_estornado_por
    );

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
    ) VALUES (
      v_transacao.id, coalesce(v_transacao.vencimento_em, v_transacao.data),
      coalesce(v_transacao.pago_em, v_transacao.data),
      p_estornado_por, NULL, v_transacao.metodopagamento, 'ESTORNO'
    );

    IF upper(v_transacao.tipo::text) = 'RECEITA' THEN
      IF v_transacao.ordemservicoid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_os(v_transacao.ordemservicoid);
      END IF;
      IF v_transacao.vendaid IS NOT NULL THEN
        PERFORM public.recalcular_status_financeiro_venda(v_transacao.vendaid);
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'id', v_transacao.id,
      'pendente', true,
      'credito_devolvido', v_movimento.valor,
      'saldo', round(v_saldo_resultante, 2)
    );
  END IF;

  IF v_transacao.adiantamento_id IS NOT NULL THEN
    SELECT coalesce(a.adiantamento_manteve_pendentes, false) INTO v_baixa_do_titulo
      FROM public.transacao a WHERE a.id = v_transacao.adiantamento_id;

    IF NOT coalesce(v_baixa_do_titulo, false) THEN
      RAISE EXCEPTION
        'Este título foi liquidado pela antecipação #%. Desfaça a antecipação: ela devolve este título e os irmãos para em aberto de uma vez.',
        v_transacao.adiantamento_id USING ERRCODE = '22023';
    END IF;
  END IF;

  IF coalesce(v_transacao.eh_adiantamento, false) THEN
    RAISE EXCEPTION
      'Esta é uma antecipação, não a baixa de um título. Excluí-la é que devolve os títulos para em aberto.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.pagamento_multiplo_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta baixa é uma perna do pagamento múltiplo #%. Desfaça o pagamento inteiro.',
      v_transacao.pagamento_multiplo_id USING ERRCODE = '22023';
  END IF;

  /*
   * Título comum pago em partes: cada pagamento tem data, banco e valor próprios
   * e sai do extrato sozinho, então o estorno é de cada um.
   *
   * O antecipado é o contrário: a baixa foi UMA — ela quitou o título e criou o
   * repasse no mesmo ato —, e desfazê-la desfaz as duas coisas.
   */
  IF v_transacao.adiantamento_id IS NULL AND EXISTS (
    SELECT 1 FROM public.transacao f
     WHERE f.baixa_de_transacao_id = p_transacao_id AND f.is_deleted = false
  ) THEN
    RAISE EXCEPTION
      'Este título foi pago em partes. Estorne os pagamentos dele, um a um.'
      USING ERRCODE = '22023';
  END IF;

  IF v_transacao.adiantamento_id IS NOT NULL THEN
    DELETE FROM public.transacao WHERE baixa_de_transacao_id = p_transacao_id;
  END IF;

  UPDATE public.transacao
     SET pendente = true,
         data = coalesce(vencimento_em, data),
         pago_em = NULL,
         baixado_por = NULL,
         banco_id = CASE WHEN v_transacao.adiantamento_id IS NOT NULL THEN NULL ELSE banco_id END,
         updated_at = now()
   WHERE id = p_transacao_id;

  WITH removidos AS (
    DELETE FROM public.transacao_ajuste
     WHERE transacao_id = p_transacao_id
       AND natureza = 'ACRESCIMO'
    RETURNING valor_calculado
  )
  SELECT coalesce(sum(valor_calculado), 0) INTO v_acrescimos_removidos FROM removidos;

  v_valor_reaberto := round(coalesce(v_transacao.valor_base, v_transacao.valor), 2);

  UPDATE public.transacao
     SET valor = v_valor_reaberto,
         valor_acrescimos = 0,
         "valorLiquido" = round(v_valor_reaberto - coalesce(valor_descontos, 0), 2),
         updated_at = now()
   WHERE id = p_transacao_id;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento, operacao
  ) VALUES (
    v_transacao.id,
    coalesce(v_transacao.vencimento_em, v_transacao.data),
    coalesce(v_transacao.pago_em, v_transacao.data),
    p_estornado_por,
    v_transacao.banco_id,
    v_transacao.metodopagamento,
    'ESTORNO'
  );

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pendente', true,
    'valor', v_valor_reaberto,
    'acrescimos_removidos', v_acrescimos_removidos,
    'vencimento_em', coalesce(v_transacao.vencimento_em, v_transacao.data)
  );
END;
$$;

ALTER FUNCTION public.estornar_baixa_transacao(bigint, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_baixa_transacao(bigint, uuid) TO service_role;

COMMIT;
