-- Acrescimo e desconto no ato da baixa do titulo.
--
-- O PROBLEMA
-- Para cobrar juros de um titulo atrasado, o caminho era: abrir o dialog de
-- EDICAO, aba Ajustes, lancar o acrescimo, salvar, fechar, abrir o dialog de
-- BAIXA, marcar como pago. Seis passos e dois dialogos para uma coisa so.
--
-- E nao era descuido de tela. tg_transacao_ajuste_coerente (20260806140000)
-- recusa acrescimo em transacao ja baixada, porque ele altera o valor bruto, e
-- bruto de titulo baixado e imutavel desde 20260806120000. Depois da baixa o
-- juros e impossivel; antes da baixa e outro dialog. A janela para lanca-lo era
-- exatamente o instante da baixa — e era justamente ali que nao dava.
--
-- A MUDANCA
-- baixar_transacao_pendente passa a aceitar p_ajustes jsonb: uma lista de
-- {tipoId, modo, valorInformado, observacao}. As linhas sao gravadas em
-- transacao_ajuste DEPOIS do FOR UPDATE e ANTES de pendente virar false — a
-- unica ordem em que o gatilho aceita — e o titulo e RELIDO em seguida, porque
-- transacao_ajuste_recalcular_trg ja mexeu nos valores dele.
--
-- Lista, e nao p_juros/p_multa/p_desconto: tipos_ajuste_transacao e catalogo
-- editavel, e cravar tres dos sete tipos de fabrica na assinatura deixaria de
-- fora o proximo que alguem cadastrar. O modo e a observacao tambem sao por
-- linha.
--
-- POR QUE DROP E NAO CREATE OR REPLACE
-- CREATE OR REPLACE com aridade diferente nao substitui: cria uma sobrecarga.
-- Com as duas no banco, as chamadas atuais — que passam os nove argumentos por
-- nome — casariam nas duas e o Postgres levantaria 42725 "function is not
-- unique", derrubando de uma vez a rota de baixa, o lote e as duas chamadas da
-- conciliacao OFX. Por isso o DROP explicito.
--
-- E porque o DROP apaga as ACLs junto, OWNER, REVOKE e GRANT sao reescritos
-- abaixo. Ate aqui eles vinham de 20260728130000 e sobreviviam de graca ao
-- CREATE OR REPLACE; sem reemiti-los a baixa quebraria em producao com
-- "permission denied for function", e a migration teria sido aplicada com
-- sucesso.
--
-- FICA DE FORA
-- Titulo antecipado: a composicao dele ja responde a antecipacao
-- (p_valor_lancado, filha de repasse), e misturar as duas coisas pede desenho
-- proprio. A funcao recusa com mensagem explicita.
-- Conciliacao OFX e baixa em lote seguem chamando sem p_ajustes e nao mudam em
-- nada: inferir tipo de acrescimo a partir de um extrato e outra feature.
BEGIN;

DROP FUNCTION IF EXISTS public.baixar_transacao_pendente(bigint, timestamp with time zone, bigint, text, integer, integer, uuid, numeric, numeric);

CREATE FUNCTION public.baixar_transacao_pendente(
  p_transacao_id bigint,
  p_pago_em timestamp with time zone,
  p_banco_id bigint,
  p_metodopagamento text,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_baixado_por uuid DEFAULT NULL,
  p_valor numeric DEFAULT NULL,
  p_valor_lancado numeric DEFAULT NULL,
  p_ajustes jsonb DEFAULT NULL
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
  v_item jsonb;
  v_tipo_id integer;
  v_modo text;
  v_natureza text;
  v_informado numeric;
  v_calculado numeric(14,2);
  v_base numeric(14,2);
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

  /*
   * Os acrescimos e descontos entram AQUI, e a posicao e a regra.
   *
   * O titulo esta travado pelo FOR UPDATE logo acima e ainda esta pendente —
   * que e exatamente o estado que tg_transacao_ajuste_coerente (20260806140000)
   * exige para aceitar ACRESCIMO, porque acrescimo mexe no bruto e bruto de
   * titulo baixado e imutavel (20260806120000).
   *
   * Era essa ordem — lancar o juros, salvar, so entao baixar — que a tela era
   * obrigada a fazer em dois dialogos e duas idas ao servidor. Agora cabe numa
   * transacao so: recusado o ajuste, a baixa inteira nao aconteceu.
   *
   * Quem faz a conta do percentual e esta funcao, e nao a rota: ela ja detem o
   * FOR UPDATE, e converter no Node abriria uma janela em que a base lida la
   * nao e a base travada aqui.
   */
  IF p_ajustes IS NOT NULL AND jsonb_typeof(p_ajustes) <> 'array' THEN
    RAISE EXCEPTION 'Os ajustes devem vir em uma lista.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_ajustes) > 8 THEN
    RAISE EXCEPTION 'Lance no máximo 8 ajustes por baixa.' USING ERRCODE = '22023';
  END IF;

  IF p_ajustes IS NOT NULL
     AND jsonb_typeof(p_ajustes) = 'array'
     AND jsonb_array_length(p_ajustes) > 0 THEN

    IF v_atual.adiantamento_id IS NOT NULL THEN
      RAISE EXCEPTION 'Titulo antecipado nao aceita acrescimo ou desconto na baixa: a composicao dele responde a antecipacao. Lance o ajuste no titulo antes.'
        USING ERRCODE = '22023';
    END IF;

    -- A base congela antes do laco. Percentual incide sobre valor_base, nunca
    -- sobre o acumulado: duas linhas de 10% somam 20% da base, que e a regra
    -- que recalcular_valores_transacao ja estabeleceu.
    v_base := round(coalesce(v_atual.valor_base, v_atual.valor, 0), 2);

    -- Acréscimos primeiro: a validade do total não depende da ordem da tela.
    FOR v_item IN
      SELECT item.value FROM jsonb_array_elements(p_ajustes) AS item
      LEFT JOIN public.tipos_ajuste_transacao tipo ON tipo.id::text = item.value->>'tipoId'
      ORDER BY CASE WHEN tipo.natureza = 'ACRESCIMO' THEN 0 ELSE 1 END
    LOOP
      v_tipo_id := (v_item->>'tipoId')::integer;
      v_modo := upper(coalesce(v_item->>'modo', 'FIXO'));
      v_informado := (v_item->>'valorInformado')::numeric;

      IF v_informado IS NULL OR v_informado::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_informado <= 0 OR (v_modo = 'PORCENTAGEM' AND v_informado > 100) THEN
        RAISE EXCEPTION 'Valor do ajuste inválido. Informe um valor positivo e percentual de até 100%%.'
          USING ERRCODE = '22023';
      END IF;

      /*
       * A natureza vem do catalogo, nunca do payload.
       *
       * Deixar o cliente informa-la criaria uma segunda verdade sobre o mesmo
       * fato — e tg_transacao_ajuste_coerente existe justamente para recusar
       * divergencia entre a linha e o tipo dela.
       */
      SELECT natureza INTO v_natureza
        FROM public.tipos_ajuste_transacao
       WHERE id = v_tipo_id AND ativo IS TRUE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Tipo de ajuste % inexistente ou inativo.', v_tipo_id
          USING ERRCODE = '22023';
      END IF;

      IF v_modo NOT IN ('FIXO', 'PORCENTAGEM') THEN
        RAISE EXCEPTION 'O modo do ajuste deve ser FIXO ou PORCENTAGEM.'
          USING ERRCODE = '22023';
      END IF;

      v_calculado := CASE
        WHEN v_modo = 'PORCENTAGEM' THEN round(v_base * v_informado / 100, 2)
        ELSE round(v_informado, 2)
      END;

      IF v_calculado <= 0 THEN
        RAISE EXCEPTION 'O ajuste calculado ficou em zero.' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.transacao_ajuste (
        transacao_id, tipo_id, natureza, modo,
        valor_informado, valor_calculado, observacao, created_by
      ) VALUES (
        p_transacao_id, v_tipo_id, v_natureza, v_modo,
        v_informado, v_calculado,
        left(nullif(btrim(coalesce(v_item->>'observacao', '')), ''), 500),
        p_baixado_por
      );
    END LOOP;

    /*
     * Reler e obrigatorio.
     *
     * transacao_ajuste_recalcular_trg ja regravou valor, valor_acrescimos,
     * valor_descontos e "valorLiquido" do titulo, e v_atual e uma foto de antes.
     * Sem isto, v_liquido e v_saldo logo abaixo seriam os de antes do juros — e
     * quitar o titulo inteiro viraria baixa PARCIAL por acidente, com o banco
     * saindo do titulo e uma filha nascendo sem ninguem ter pedido.
     */
    SELECT * INTO v_atual FROM public.transacao WHERE id = p_transacao_id;
    IF round(v_atual.valor - coalesce(v_atual.valor_descontos, 0) - coalesce(v_atual.valor_baixado, 0), 2) <= 0 THEN
      RAISE EXCEPTION 'Os descontos devem deixar um saldo maior que zero para realizar a baixa.'
        USING ERRCODE = '22023';
    END IF;
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
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, numeric, numeric, jsonb
) OWNER TO postgres;

-- Reemitidos porque o DROP levou as ACLs de 20260728130000 junto.
REVOKE ALL ON FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, numeric, numeric, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, numeric, numeric, jsonb
) TO service_role;

COMMENT ON FUNCTION public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, numeric, numeric, jsonb
) IS
  'Da baixa num titulo em aberto. p_valor diz quanto esta sendo liquidado; nulo e a baixa de uma vez, salvo em titulo que ja tem baixas parciais, onde significa o restante. p_valor_lancado diz quanto entra na conta, e so titulo antecipado responde. p_ajustes lanca acrescimos e descontos antes da baixa, na unica janela em que o gatilho aceita acrescimo.';

-- O PostgREST guarda a assinatura em cache; sem isto ele pode servir a antiga e
-- devolver PGRST202 para a chamada com p_ajustes.
NOTIFY pgrst, 'reload schema';

COMMIT;
