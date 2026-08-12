-- Antecipar sem liquidar o título.
--
-- Ao antecipar boletos, o dinheiro entra na conta mas o boleto continua a ser
-- cobrado do cliente até o vencimento. Liquidar o título no ato apaga justamente
-- o que a cobrança precisa enxergar: quais boletos ainda não foram honrados.
--
-- Passa a existir a opção de manter os títulos EM ABERTO, marcados como
-- antecipados (`adiantamento_id` preenchido). Eles seguem em "a receber" para
-- serem acompanhados, e a baixa vem depois, quando o boleto for pago de fato.
--
-- O DINHEIRO NÃO PODE ENTRAR DUAS VEZES
-- No modo que liquida na hora, o título nasce com `banco_id` nulo — o dinheiro
-- veio pela antecipação, não por ele. No modo novo o título é baixado depois,
-- pelo caminho comum, que exige banco e o gravaria: o mesmo dinheiro entraria no
-- extrato de novo, uma vez pela antecipação e outra pela baixa.
--
-- Por isso `baixar_transacao_pendente` passa a zerar o banco quando o título tem
-- antecipação. Essa baixa é a confirmação de que o boleto foi honrado, não uma
-- entrada nova: o caixa já recebeu quando a antecipação foi lançada.
BEGIN;

CREATE OR REPLACE FUNCTION public.baixar_por_adiantamento(
  p_ids bigint[],
  p_adiantamento jsonb,
  p_baixado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tipo text;
  v_qtd int;
  v_tipos_distintos int;
  v_soma_liquida numeric(14,2) := 0;
  v_adiantamento_id bigint;
  v_pago_em timestamptz := coalesce(nullif(p_adiantamento->>'pago_em', '')::timestamptz, now());
  v_metodo public.metodo_pagamento;
  v_taxa numeric(14,2);
  v_tipo_taxa integer;
  -- Novo: manter os títulos em aberto, só marcados como antecipados.
  v_manter_pendentes boolean :=
    coalesce((p_adiantamento->>'manter_titulos_pendentes')::boolean, false);
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos uma transacao.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.transacao
   WHERE id = ANY(p_ids) AND is_deleted = false
   FOR UPDATE;

  SELECT count(*), count(DISTINCT upper(tipo::text)),
         coalesce(sum(coalesce(nullif("valorLiquido", 0), valor)), 0)
    INTO v_qtd, v_tipos_distintos, v_soma_liquida
    FROM public.transacao
   WHERE id = ANY(p_ids) AND is_deleted = false;

  IF v_qtd <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'Alguma transacao selecionada nao existe mais.' USING ERRCODE = 'P0002';
  END IF;

  IF v_tipos_distintos > 1 THEN
    RAISE EXCEPTION 'Um adiantamento nao pode misturar receita e despesa.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transacao
     WHERE id = ANY(p_ids) AND (pendente = false OR is_deleted = true)
  ) THEN
    RAISE EXCEPTION 'Ha transacao ja baixada ou excluida na selecao.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transacao WHERE id = ANY(p_ids) AND adiantamento_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Ha transacao ja vinculada a outro adiantamento.' USING ERRCODE = '23505';
  END IF;

  SELECT upper(tipo::text) INTO v_tipo
    FROM public.transacao WHERE id = p_ids[1];

  BEGIN
    v_metodo := nullif(btrim(p_adiantamento->>'metodopagamento'), '')::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido: %.', p_adiantamento->>'metodopagamento'
      USING ERRCODE = '22023';
  END;

  IF v_metodo IS NULL THEN
    RAISE EXCEPTION 'Metodo de pagamento obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF nullif(p_adiantamento->>'banco_id', '') IS NULL THEN
    RAISE EXCEPTION 'Banco obrigatorio no adiantamento.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.transacao (
    descricao, valor, "valorLiquido", valor_base,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, eh_adiantamento,
    banco_id, metodopagamento, categoria_id,
    plano_de_conta_id, centro_custo_id,
    cliente_id, fornecedor_id,
    nomepagador, cpfcnpjpagador,
    descricao_pagamento, created_by, baixado_por
  ) VALUES (
    coalesce(nullif(btrim(p_adiantamento->>'descricao'), ''),
             'Adiantamento de ' || v_qtd || ' titulo(s)'),
    v_soma_liquida, v_soma_liquida, v_soma_liquida,
    v_pago_em, v_pago_em, v_pago_em, v_pago_em,
    v_tipo::public.tipos_transacao, false, true,
    (p_adiantamento->>'banco_id')::bigint,
    v_metodo,
    nullif(p_adiantamento->>'categoria_id', '')::integer,
    nullif(p_adiantamento->>'plano_de_conta_id', '')::integer,
    nullif(p_adiantamento->>'centro_custo_id', '')::integer,
    nullif(p_adiantamento->>'cliente_id', '')::integer,
    nullif(p_adiantamento->>'fornecedor_id', '')::integer,
    coalesce(nullif(btrim(p_adiantamento->>'nomepagador'), ''), 'Adiantamento'),
    coalesce(nullif(btrim(p_adiantamento->>'cpfcnpjpagador'), ''), 'NÃO INFORMADO'),
    nullif(btrim(p_adiantamento->>'descricao_pagamento'), ''),
    p_baixado_por, p_baixado_por
  ) RETURNING id INTO v_adiantamento_id;

  IF v_manter_pendentes THEN
    -- Só o vínculo. O título continua em aberto para a cobrança acompanhar, e o
    -- banco fica nulo desde já: quando ele for baixado, o dinheiro não é novo.
    UPDATE public.transacao
       SET adiantamento_id = v_adiantamento_id,
           banco_id = NULL,
           updated_at = now()
     WHERE id = ANY(p_ids);
  ELSE
    UPDATE public.transacao
       SET pendente = false,
           pago_em = v_pago_em,
           baixado_por = p_baixado_por,
           vencimento_em = coalesce(vencimento_em, data),
           banco_id = NULL,
           adiantamento_id = v_adiantamento_id,
           updated_at = now()
     WHERE id = ANY(p_ids);

    INSERT INTO public.transacao_baixa_historico (
      transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
    )
    SELECT id, vencimento_em, pago_em, baixado_por, NULL, metodopagamento
      FROM public.transacao WHERE id = ANY(p_ids);
  END IF;

  v_taxa := round(coalesce(nullif(p_adiantamento->>'taxa', '')::numeric, 0), 2);

  IF v_taxa < 0 THEN
    RAISE EXCEPTION 'A taxa de antecipacao nao pode ser negativa.' USING ERRCODE = '22023';
  END IF;
  IF v_taxa >= v_soma_liquida THEN
    RAISE EXCEPTION
      'A taxa de antecipacao (%) nao pode alcancar o valor antecipado (%).', v_taxa, v_soma_liquida
      USING ERRCODE = '22023';
  END IF;

  IF v_taxa > 0 THEN
    SELECT id INTO v_tipo_taxa
      FROM public.tipos_ajuste_transacao WHERE codigo_sistema = 'TAXA_ANTECIPACAO';

    INSERT INTO public.transacao_ajuste (
      transacao_id, tipo_id, natureza, modo, valor_informado, valor_calculado, created_by
    ) VALUES (
      v_adiantamento_id, v_tipo_taxa, 'DESCONTO', 'FIXO', v_taxa, v_taxa, p_baixado_por
    );
  END IF;

  RETURN jsonb_build_object(
    'adiantamento_id', v_adiantamento_id,
    'quantidade', v_qtd,
    'valor_bruto', v_soma_liquida,
    'taxa', v_taxa,
    'valor_liquido', v_soma_liquida - v_taxa,
    'tipo', v_tipo,
    'titulos_mantidos_pendentes', v_manter_pendentes
  );
END;
$function$;

ALTER FUNCTION public.baixar_por_adiantamento(bigint[], jsonb, uuid) OWNER TO postgres;

-- ------------------------------------------------------ baixa do título antecipado
CREATE OR REPLACE FUNCTION public.baixar_transacao_pendente(
  p_transacao_id bigint,
  p_pago_em timestamp with time zone,
  p_banco_id bigint,
  p_metodopagamento text,
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
  v_transacao public.transacao%ROWTYPE;
  v_metodo public.metodo_pagamento;
  v_antecipada boolean;
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

  SELECT adiantamento_id IS NOT NULL INTO v_antecipada
    FROM public.transacao WHERE id = p_transacao_id;

  UPDATE public.transacao
  SET vencimento_em = coalesce(vencimento_em, data),
      data = p_pago_em,
      pago_em = p_pago_em,
      baixado_por = p_baixado_por,
      -- Título antecipado não traz dinheiro novo: o caixa já recebeu pela
      -- antecipação. Gravar o banco aqui contaria a mesma entrada duas vezes.
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
    IF EXISTS (
      SELECT 1 FROM public.transacao
      WHERE id = p_transacao_id AND is_deleted = false
    ) THEN
      RAISE EXCEPTION 'A transação já foi baixada.' USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    v_transacao.baixado_por, v_transacao.banco_id, v_transacao.metodopagamento
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
    'pendente', false
  );
END;
$function$;

ALTER FUNCTION public.baixar_transacao_pendente(bigint, timestamp with time zone, bigint, text, integer, integer, uuid) OWNER TO postgres;

COMMIT;
