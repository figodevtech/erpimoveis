-- Baixa de título antecipado em que só parte do valor vira dinheiro.
--
-- O CASO
-- Parcela de R$ 1.000, antecipada e mantida em aberto. O pagador não honrou o
-- boleto, mas o banco não debitou os R$ 1.000 de volta — esperou. Quando o
-- pagador enfim pagou, pagou R$ 1.050, com R$ 50 de juros pelo atraso. O banco
-- reteve os R$ 1.000 que já havia adiantado e repassou só os R$ 50.
--
-- O título precisa ser quitado por R$ 1.050 e a conta subir R$ 50.
--
-- O QUE FALTAVA
-- Os dois parâmetros da baixa não alcançavam isso. `p_lancar_no_caixa` é
-- booleano: ou o título inteiro entra na conta, ou nada entra. E `p_valor` — a
-- baixa parcial de 20260819130000 — responde outra pergunta.
--
-- OS DOIS EIXOS
-- `p_valor` diz QUANTO DO TÍTULO FOI LIQUIDADO. Falta dizer QUANTO DISSO VIROU
-- DINHEIRO. No título comum as duas respostas são o mesmo número, e por isso um
-- parâmetro só bastou até agora. No antecipado elas divergem:
--
--   boleto antecipado honrado ............. liquidou 1.000, entrou 0
--   banco devolveu tudo e o pagador pagou . liquidou 1.000, entrou 1.000
--   banco reteve e repassou o juros ....... liquidou 1.050, entrou 50
--
-- Por isso `p_lancar_no_caixa` vira `p_valor_lancado`, um valor.
--
-- A FILHA AQUI É REPASSE, NÃO QUITAÇÃO
-- O dinheiro entra pela linha filha de 20260819130000 (`baixa_de_transacao_id`),
-- que já existe e já está fora do DRE e do extrato do título. Mas o significado
-- dela muda: na baixa parcial ela quita um pedaço; aqui ela é só o caixa, porque
-- quem respondeu pelo principal foi a antecipação.
--
-- Sem tratar essa diferença, `recalcular_baixas_transacao` olharia uma filha de
-- R$ 50 num título de R$ 1.050, concluiria "50 < 1.050, logo está em aberto" e
-- REABRIRIA um título que acabou de ser quitado.
--
-- TÍTULO ANTECIPADO NUNCA MAIS CARREGA BANCO
-- Se o repasse de R$ 50 vira filha, o caso "o banco devolveu tudo" tem que virar
-- também — o mesmo fato não pode ter duas formas. Com isso a trava
-- `tg_transacao_antecipado_sem_banco` volta a ser a regra absoluta que era antes
-- de 20260818170000, e some a exceção do "só no exato movimento da baixa".
--
-- Não há dado a migrar: nenhum título antecipado tem banco (conferido).
BEGIN;

-- ---------------------------------------------------------------------------
-- 0) A linha do dinheiro, num lugar só
-- ---------------------------------------------------------------------------
--
-- Os dois caminhos que criam filha — a baixa parcial e o repasse do antecipado —
-- montam a mesma linha, com a mesma herança de categoria e contraparte. Estavam
-- prestes a virar dois INSERTs gêmeos, e o segundo esqueceria alguma coluna que o
-- primeiro copia.
--
-- O que muda entre eles é só a descrição, porque o que a linha significa é
-- diferente: numa é o pagamento de um pedaço do título, na outra é o que o banco
-- repassou de um título que a antecipação já havia coberto.

CREATE OR REPLACE FUNCTION public.registrar_baixa_filha(
  p_titulo public.transacao,
  p_valor numeric,
  p_pago_em timestamp with time zone,
  p_banco_id bigint,
  p_metodo public.metodo_pagamento,
  p_plano_de_conta_id integer,
  p_centro_custo_id integer,
  p_baixado_por uuid,
  p_repasse boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.transacao (
    descricao, valor, valor_base, "valorLiquido",
    valor_acrescimos, valor_descontos,
    data, competencia_em, vencimento_em, pago_em,
    tipo, pendente, banco_id, metodopagamento,
    categoria, categoria_id,
    plano_de_conta_id, centro_custo_id,
    cliente_id, fornecedor_id, nomepagador, cpfcnpjpagador,
    baixa_de_transacao_id, created_by, baixado_por
  ) VALUES (
    CASE WHEN p_repasse THEN 'Repasse do título #' ELSE 'Pagamento do título #' END
      || p_titulo.id || ' — '
      || coalesce(nullif(btrim(p_titulo.descricao), ''), 'sem descrição'),
    round(p_valor, 2), round(p_valor, 2), round(p_valor, 2),
    0, 0,
    p_pago_em, coalesce(p_titulo.competencia_em, p_pago_em),
    coalesce(p_titulo.vencimento_em, p_titulo.data), p_pago_em,
    p_titulo.tipo, false, p_banco_id, p_metodo,
    p_titulo.categoria, p_titulo.categoria_id,
    coalesce(p_plano_de_conta_id, p_titulo.plano_de_conta_id),
    coalesce(p_centro_custo_id, p_titulo.centro_custo_id),
    p_titulo.cliente_id, p_titulo.fornecedor_id,
    p_titulo.nomepagador, p_titulo.cpfcnpjpagador,
    -- Sem `ordemservicoid`/`vendaid` e sem `adiantamento_id`: a filha é
    -- movimento de caixa, e carregar o vínculo do documento a faria contar como
    -- recebimento dele, em cima do título que já conta.
    p_titulo.id, p_baixado_por, p_baixado_por
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

ALTER FUNCTION public.registrar_baixa_filha(
  public.transacao, numeric, timestamp with time zone, bigint,
  public.metodo_pagamento, integer, integer, uuid, boolean
) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 1) O repasse não decide se o título está aberto
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalcular_baixas_transacao(p_transacao_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_baixado numeric(14,2);
  v_quantas int;
  v_liquido numeric(14,2);
  v_ultimo_pago timestamptz;
  v_antecipado boolean;
BEGIN
  SELECT coalesce(sum(coalesce(nullif(f."valorLiquido", 0), f.valor)), 0),
         count(*), max(f.pago_em)
    INTO v_baixado, v_quantas, v_ultimo_pago
    FROM public.transacao f
   WHERE f.baixa_de_transacao_id = p_transacao_id
     AND f.is_deleted = false;

  SELECT coalesce(nullif(t."valorLiquido", 0), t.valor), t.adiantamento_id IS NOT NULL
    INTO v_liquido, v_antecipado
    FROM public.transacao t WHERE t.id = p_transacao_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF round(v_baixado, 2) > round(coalesce(v_liquido, 0), 2) THEN
    RAISE EXCEPTION
      'As baixas do título #% somam % e passam do valor dele (%).',
      p_transacao_id, v_baixado, v_liquido USING ERRCODE = '22023';
  END IF;

  IF v_quantas = 0 THEN
    UPDATE public.transacao SET valor_baixado = 0, updated_at = now()
     WHERE id = p_transacao_id AND valor_baixado <> 0;
    RETURN;
  END IF;

  /*
   * Em título antecipado a filha é REPASSE DE CAIXA, não quitação.
   *
   * A antecipação já respondeu pelo principal; o que entra agora é só a parte
   * que o banco não reteve. Quem fecha o título é a baixa, que sabe que o boleto
   * foi pago por inteiro — não a soma das filhas, que é sempre menor.
   *
   * Deixar a regra comum valer aqui reabriria, no mesmo instante, o título que a
   * baixa acabou de quitar.
   */
  IF coalesce(v_antecipado, false) THEN
    UPDATE public.transacao
       SET valor_baixado = round(v_baixado, 2), updated_at = now()
     WHERE id = p_transacao_id;
    RETURN;
  END IF;

  UPDATE public.transacao
     SET valor_baixado = round(v_baixado, 2),
         pendente = (round(v_baixado, 2) < round(coalesce(v_liquido, 0), 2)),
         pago_em = CASE
           WHEN round(v_baixado, 2) >= round(coalesce(v_liquido, 0), 2) THEN v_ultimo_pago
           ELSE NULL
         END,
         updated_at = now()
   WHERE id = p_transacao_id;
END;
$function$;

ALTER FUNCTION public.recalcular_baixas_transacao(bigint) OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- 2) A trava do antecipado volta a ser absoluta
-- ---------------------------------------------------------------------------
--
-- Em 20260818170000 ela ganhou uma exceção para deixar a baixa gravar o banco no
-- próprio título. Agora o dinheiro do antecipado mora sempre numa filha, então a
-- exceção perdeu o motivo — e com ela some a parte mais delicada daquele código,
-- que dependia de `TG_OP` e da transição de `pendente`.

CREATE OR REPLACE FUNCTION public.tg_transacao_antecipado_sem_banco()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF new.adiantamento_id IS NULL OR new.banco_id IS NULL THEN
    RETURN new;
  END IF;

  RAISE EXCEPTION
    'O título #% é antecipado: o dinheiro dele entrou pela antecipação, e o que vier depois é lançado numa transação própria. Dar banco a ele somaria o mesmo valor duas vezes no fluxo de caixa.',
    new.id USING ERRCODE = '23514';
END;
$function$;

ALTER FUNCTION public.tg_transacao_antecipado_sem_banco() OWNER TO postgres;

COMMENT ON FUNCTION public.tg_transacao_antecipado_sem_banco() IS
  'Título antecipado nunca carrega banco: o dinheiro veio da antecipação, e o repasse posterior é lançado numa transação filha (baixa_de_transacao_id).';

-- ---------------------------------------------------------------------------
-- 3) A baixa passa a dizer quanto entra na conta
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.baixar_transacao_pendente(
  bigint, timestamp with time zone, bigint, text, integer, integer, uuid, boolean, numeric
);

CREATE OR REPLACE FUNCTION public.baixar_transacao_pendente(
  p_transacao_id bigint,
  p_pago_em timestamp with time zone,
  p_banco_id bigint,
  p_metodopagamento text,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_baixado_por uuid DEFAULT NULL,
  -- Quanto do título está sendo liquidado. Menor que o saldo = baixa parcial.
  p_valor numeric DEFAULT NULL,
  -- Quanto disso entra na conta. Só título antecipado responde: nele os dois
  -- números divergem, porque parte do dinheiro já veio pela antecipação.
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

  IF p_valor IS NOT NULL THEN
    IF round(p_valor, 2) <= 0 THEN
      RAISE EXCEPTION 'O valor da baixa deve ser maior que zero.' USING ERRCODE = '22023';
    END IF;
    IF round(p_valor, 2) > v_saldo THEN
      RAISE EXCEPTION
        'A baixa de % passa do saldo em aberto do título, que é de %.',
        round(p_valor, 2), v_saldo USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_antecipada, false) THEN
      RAISE EXCEPTION
        'Título antecipado ainda não aceita baixa parcial.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- --------------------------------------------------------------- parcial
  IF p_valor IS NOT NULL
     AND (round(p_valor, 2) < v_saldo OR coalesce(v_atual.valor_baixado, 0) > 0) THEN

    IF v_atual.banco_id IS NOT NULL THEN
      UPDATE public.transacao SET banco_id = NULL, updated_at = now()
       WHERE id = p_transacao_id;
    END IF;

    v_filha_id := public.registrar_baixa_filha(
      v_atual, round(p_valor, 2), p_pago_em, p_banco_id, v_metodo,
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
      -- Título antecipado nunca carrega banco: o principal veio da antecipação, e
      -- o que o banco repassar depois entra pela filha, logo abaixo.
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

  -- O repasse: o que o banco de fato mandou. Nasce depois da baixa porque só
  -- então o título está quitado, e a filha não tem o direito de reabri-lo.
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
  'Dá baixa num título em aberto. p_valor diz quanto do título está sendo liquidado (menor que o saldo = baixa parcial). p_valor_lancado diz quanto disso entra na conta, e só título antecipado responde: nele parte do dinheiro já veio pela antecipação.';

-- ---------------------------------------------------------------------------
-- 4) Estornar alcança o título antecipado que gerou repasse
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 5) Desfazer a antecipação olha as filhas, não o banco
-- ---------------------------------------------------------------------------

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
  v_com_lancamento bigint[];
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

  -- O repasse mora numa transação própria. Reabrir o título em bloco a deixaria
  -- órfã no extrato, com dinheiro sem origem.
  SELECT array_agg(DISTINCT t.id) INTO v_com_lancamento
    FROM public.transacao t
    JOIN public.transacao f ON f.baixa_de_transacao_id = t.id AND f.is_deleted = false
   WHERE t.adiantamento_id = p_id AND t.is_deleted = false;

  IF v_com_lancamento IS NOT NULL THEN
    RAISE EXCEPTION
      'O título #% teve dinheiro lançado na conta pela baixa dele. Estorne essa baixa antes de desfazer a antecipação.',
      v_com_lancamento[1] USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
           'tipo', CASE WHEN t.ordemservicoid IS NOT NULL THEN 'OS' ELSE 'VENDA' END,
           'id', coalesce(t.ordemservicoid, t.vendaid))), '[]'::jsonb)
    INTO v_documentos
    FROM public.transacao t
   WHERE t.id = ANY (coalesce(v_titulos, ARRAY[]::bigint[]))
     AND coalesce(t.ordemservicoid, t.vendaid) IS NOT NULL;

  IF v_titulos IS NOT NULL THEN
    UPDATE public.transacao
       SET pendente = true,
           pago_em = NULL,
           baixado_por = NULL,
           adiantamento_id = NULL,
           updated_at = now()
     WHERE id = ANY (v_titulos);
  END IF;

  UPDATE public.transacao
     SET is_deleted = true,
         deleted_at = now(),
         deleted_by = p_deleted_by,
         updated_at = now()
   WHERE id = p_id;

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
REVOKE ALL ON FUNCTION public.desfazer_adiantamento(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desfazer_adiantamento(bigint, uuid) TO service_role;

COMMIT;
