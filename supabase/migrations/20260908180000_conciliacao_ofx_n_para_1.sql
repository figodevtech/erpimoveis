-- ---------------------------------------------------------------------------
-- Conciliação N:1 — várias linhas do extrato para um lançamento só do ERP
-- ---------------------------------------------------------------------------
--
-- O banco quebra em duas linhas o que a empresa lança numa só. O caso que
-- originou isto: a prestação do contrato 290000000700 sai como
-- "PREST. DE EMPREST. FINANCIAMENTO" de R$ 743,16 e "IOF" de R$ 161,01, no mesmo
-- dia, e no ERP existe um lançamento único de R$ 904,17.
--
-- Até aqui não havia como conciliar isso: `VINCULAR` exige que o valor da
-- transação seja exatamente o do movimento, e o índice único em `transacao_id`
-- garantia uma transação por linha do extrato. As duas regras juntas deixavam o
-- usuário sem saída — ou ele dividia o lançamento no ERP, ou o extrato não
-- fechava.
--
-- A REGRA QUE SUBSTITUI O ÍNDICE ÚNICO:
--
--   uma transação é reivindicada por UM ato de conciliação, que pode abranger N
--   movimentos — e a soma desses N movimentos tem que ser exatamente o dinheiro
--   que a transação movimenta.
--
-- É a mesma proteção de antes ("o extrato não fecha com metade do dinheiro"),
-- agora dita sobre a soma em vez de sobre a contagem. Como não é expressável
-- num índice, ela passa a ser conferida dentro da RPC, sob o `FOR UPDATE` da
-- transação — que é o que serializa duas conciliações concorrentes da mesma
-- linha.

-- ---------------------------------------------------------------------------
-- 1) O índice único dá lugar a um índice de busca
-- ---------------------------------------------------------------------------
--
-- Ele existia para impedir dois movimentos apontando para o mesmo lançamento.
-- Isso continua proibido, só que agora com uma exceção nomeada: os movimentos
-- do MESMO ato de conciliação. Quem faz a checagem é `conciliar_movimentos_ofx`.
DROP INDEX IF EXISTS public.ofx_movimento_transacao_unica_idx;

CREATE INDEX IF NOT EXISTS ofx_movimento_transacao_idx
  ON public.ofx_movimento (transacao_id)
  WHERE transacao_id IS NOT NULL;

COMMENT ON INDEX public.ofx_movimento_transacao_idx IS
  'Acha os movimentos de uma transação. A unicidade virou regra de soma dentro de conciliar_movimentos_ofx, para permitir N linhas do extrato para um lançamento só.';

-- ---------------------------------------------------------------------------
-- 2) A conciliação, agora sobre um conjunto de movimentos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conciliar_movimentos_ofx(
  p_movimento_ids bigint[],
  p_acao text,
  p_transacao_id bigint DEFAULT NULL,
  p_valor numeric DEFAULT NULL,
  p_metodopagamento text DEFAULT NULL,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_nova jsonb DEFAULT NULL,
  p_usuario uuid DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ids bigint[];
  v_qtd integer;
  v_primeiro public.ofx_movimento%ROWTYPE;
  v_imp public.ofx_importacao%ROWTYPE;
  v_tx public.transacao%ROWTYPE;
  v_acao text;
  v_dia date;
  v_data timestamptz;
  v_entrada boolean;
  v_soma_centavos bigint;
  v_alvo_centavos bigint;
  v_liquido_centavos bigint;
  v_saldo numeric(14,2);
  v_baixa numeric(14,2);
  v_resultado jsonb;
  v_transacao_id bigint;
  v_titulo_id bigint;
  v_tipo public.tipos_transacao;
  v_metodo public.metodo_pagamento;
  v_descricao text;
  v_acao_gravada text;
BEGIN
  v_acao := upper(btrim(coalesce(p_acao, '')));
  IF v_acao NOT IN ('VINCULAR', 'LIQUIDAR', 'CRIAR', 'IGNORAR') THEN
    RAISE EXCEPTION 'Ação de conciliação inválida: %.', p_acao USING ERRCODE = '22023';
  END IF;

  -- Sem nulo e sem repetição: o mesmo movimento mandado duas vezes dobraria a
  -- soma e faria a conferência de valor aprovar o que não deveria.
  SELECT array_agg(DISTINCT item ORDER BY item)
    INTO v_ids
    FROM unnest(coalesce(p_movimento_ids, '{}'::bigint[])) AS item
   WHERE item IS NOT NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um movimento do extrato.' USING ERRCODE = '22023';
  END IF;

  -- Trava na ordem do id: duas conciliações concorrentes que compartilhem
  -- movimentos pegam os bloqueios na mesma ordem e não se enroscam.
  PERFORM 1 FROM public.ofx_movimento
   WHERE id = ANY(v_ids)
   ORDER BY id
     FOR UPDATE;

  SELECT count(*) INTO v_qtd FROM public.ofx_movimento WHERE id = ANY(v_ids);
  IF v_qtd <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'Movimento do extrato não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ofx_movimento WHERE id = ANY(v_ids) AND status <> 'PENDENTE'
  ) THEN
    RAISE EXCEPTION 'Este movimento do extrato já foi resolvido.' USING ERRCODE = '23505';
  END IF;

  -- Um ato de conciliação pertence a um extrato. Sem isto, um id de importação
  -- qualquer viraria porta para conciliar linha de outra conta bancária.
  IF (SELECT count(DISTINCT importacao_id) FROM public.ofx_movimento WHERE id = ANY(v_ids)) > 1 THEN
    RAISE EXCEPTION
      'Os movimentos conciliados juntos precisam ser do mesmo extrato.' USING ERRCODE = '22023';
  END IF;

  /*
   * Entradas e saídas não se somam numa conciliação.
   *
   * Um crédito de R$ 100 com um débito de R$ 40 "dá" R$ 60, mas são dois fatos
   * de sentidos opostos e o extrato precisa mostrar os dois. Compensar um com o
   * outro esconderia dinheiro que entrou e dinheiro que saiu no mesmo número.
   */
  IF (
    SELECT count(DISTINCT (valor_centavos > 0))
      FROM public.ofx_movimento WHERE id = ANY(v_ids)
  ) > 1 THEN
    RAISE EXCEPTION
      'Não é possível conciliar entradas e saídas na mesma operação: escolha movimentos do mesmo sentido.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_primeiro
    FROM public.ofx_movimento
   WHERE id = ANY(v_ids)
   ORDER BY sequencia, id
   LIMIT 1;

  SELECT sum(valor_centavos), max(data_postagem)
    INTO v_soma_centavos, v_dia
    FROM public.ofx_movimento
   WHERE id = ANY(v_ids);

  SELECT * INTO v_imp FROM public.ofx_importacao WHERE id = v_primeiro.importacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Importação não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  /*
   * A data do ato é a do ÚLTIMO movimento do grupo.
   *
   * Com uma linha só é a data dela, como sempre foi. Com duas, é o dia em que o
   * dinheiro terminou de sair da conta — datar pela primeira registraria a baixa
   * antes de o valor todo ter passado.
   *
   * Meio-dia no fuso da oficina, igual ao que a rota de baixa já faz: ancorar na
   * meia-noite deixaria o movimento sujeito a cair no dia anterior.
   */
  v_data := (v_dia::text || ' 12:00:00-03')::timestamptz;
  v_entrada := v_soma_centavos > 0;
  v_alvo_centavos := abs(v_soma_centavos);

  -- ------------------------------------------------------------- ignorar
  IF v_acao = 'IGNORAR' THEN
    UPDATE public.ofx_movimento
       SET status = 'IGNORADO',
           acao_conciliacao = 'IGNORAR',
           observacao = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
           conciliado_em = now(),
           conciliado_por = p_usuario
     WHERE id = ANY(v_ids);

    RETURN jsonb_build_object(
      'movimento_id', v_ids[1],
      'movimento_ids', to_jsonb(v_ids),
      'status', 'IGNORADO'
    );
  END IF;

  -- ------------------------------------------------------------- vincular
  IF v_acao = 'VINCULAR' THEN
    IF p_transacao_id IS NULL THEN
      RAISE EXCEPTION 'Informe a transação a vincular.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_tx FROM public.transacao
     WHERE id = p_transacao_id AND is_deleted = false FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002';
    END IF;

    /*
     * Aqui mora a proteção que era do índice único.
     *
     * Sob o `FOR UPDATE` acima, duas conciliações da mesma transação viram fila:
     * a segunda enxerga a marcação da primeira e é recusada. Os movimentos deste
     * mesmo ato ficam de fora da conferência — eles são o ato.
     */
    IF EXISTS (
      SELECT 1 FROM public.ofx_movimento
       WHERE transacao_id = p_transacao_id AND NOT (id = ANY(v_ids))
    ) THEN
      RAISE EXCEPTION
        'Esta transação já responde por outro movimento do extrato.' USING ERRCODE = '23505';
    END IF;

    IF coalesce(v_tx.pendente, false) THEN
      RAISE EXCEPTION
        'Este título ainda está em aberto. Use a baixa para liquidá-lo com o movimento do extrato.'
        USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_tx.banco_id, 0) <> v_imp.banco_id THEN
      RAISE EXCEPTION
        'A transação não está na conta bancária deste extrato.' USING ERRCODE = '22023';
    END IF;
    IF (upper(v_tx.tipo::text) IN ('RECEITA', 'DEPOSITO')) <> v_entrada THEN
      RAISE EXCEPTION
        'O sentido não confere: o extrato mostra uma %, e a transação é %.',
        CASE WHEN v_entrada THEN 'entrada' ELSE 'saída' END, v_tx.tipo
        USING ERRCODE = '22023';
    END IF;

    /*
     * A soma do grupo tem que ser o dinheiro da transação.
     *
     * Com uma linha só é a conferência de sempre. Com duas, é ela que impede a
     * conciliação em grupo de virar um jeito de fechar o extrato com o valor
     * errado: R$ 743,16 + R$ 161,01 só valem pela transação de R$ 904,17.
     */
    v_liquido_centavos := round(public.transacao_valor_liquido_efetivo(v_tx) * 100)::bigint;
    IF v_liquido_centavos <> v_alvo_centavos THEN
      IF array_length(v_ids, 1) > 1 THEN
        RAISE EXCEPTION
          'A soma dos % movimentos é %, e a transação movimenta %.',
          array_length(v_ids, 1),
          round(v_alvo_centavos / 100.0, 2), round(v_liquido_centavos / 100.0, 2)
          USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION
        'O valor não confere: o extrato mostra % e a transação movimenta %.',
        round(v_alvo_centavos / 100.0, 2), round(v_liquido_centavos / 100.0, 2)
        USING ERRCODE = '22023';
    END IF;

    v_transacao_id := v_tx.id;
    v_titulo_id := NULL;
    v_acao_gravada := 'VINCULAR';
  END IF;

  -- ------------------------------------------------------------- liquidar
  IF v_acao = 'LIQUIDAR' THEN
    IF p_transacao_id IS NULL THEN
      RAISE EXCEPTION 'Informe o título a liquidar.' USING ERRCODE = '22023';
    END IF;
    IF nullif(btrim(coalesce(p_metodopagamento, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Informe a forma de pagamento da baixa.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_tx FROM public.transacao
     WHERE id = p_transacao_id AND is_deleted = false;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Título não encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF NOT coalesce(v_tx.pendente, false) THEN
      RAISE EXCEPTION 'Este título já foi baixado.' USING ERRCODE = '23505';
    END IF;
    IF (upper(v_tx.tipo::text) IN ('RECEITA', 'DEPOSITO')) <> v_entrada THEN
      RAISE EXCEPTION
        'O sentido não confere: o extrato mostra uma %, e o título é %.',
        CASE WHEN v_entrada THEN 'entrada' ELSE 'saída' END, v_tx.tipo
        USING ERRCODE = '22023';
    END IF;

    v_saldo := round(
      public.transacao_valor_liquido_efetivo(v_tx) - coalesce(v_tx.valor_baixado, 0), 2);
    v_baixa := round(coalesce(p_valor, v_saldo), 2);

    /*
     * O dinheiro da baixa tem que ser exatamente o dinheiro do extrato.
     *
     * Sem esta conferência a conciliação aceitaria baixar R$ 5.000 com um
     * movimento de R$ 2.000 e marcar a linha como resolvida — o extrato
     * "fecharia" com R$ 3.000 que nunca passaram pela conta. Em grupo, o
     * dinheiro do extrato é a soma das linhas: N movimentos produzem UMA baixa
     * do total, não uma baixa cada.
     */
    IF round(v_baixa * 100)::bigint <> v_alvo_centavos THEN
      RAISE EXCEPTION
        'A baixa de % não corresponde ao movimento do extrato, que é de %.',
        v_baixa, round(v_alvo_centavos / 100.0, 2) USING ERRCODE = '22023';
    END IF;

    -- A baixa parcial, o saldo restante e a recusa por valor acima do saldo são
    -- todos da RPC de baixa. Aqui só se diz quanto foi pago.
    v_resultado := public.baixar_transacao_pendente(
      p_transacao_id := v_tx.id,
      p_pago_em := v_data,
      p_banco_id := v_imp.banco_id,
      p_metodopagamento := btrim(p_metodopagamento),
      p_plano_de_conta_id := p_plano_de_conta_id,
      p_centro_custo_id := p_centro_custo_id,
      p_baixado_por := p_usuario,
      p_valor := CASE WHEN v_baixa < v_saldo THEN v_baixa ELSE NULL END,
      p_valor_lancado := NULL
    );

    /*
     * Qual linha é o dinheiro?
     *
     * Na baixa de uma vez o próprio título vira o movimento de caixa: recebe
     * banco, data do pagamento e sai de pendente. Na parcial o título continua
     * aberto e quem carrega o dinheiro é a transação filha — é ela que aparece
     * no Fluxo, e é ela que o extrato representa.
     */
    IF coalesce((v_resultado->>'parcial')::boolean, false) THEN
      v_transacao_id := (v_resultado->>'baixa_id')::bigint;
      v_acao_gravada := 'BAIXA_PARCIAL';
    ELSE
      v_transacao_id := (v_resultado->>'id')::bigint;
      v_acao_gravada := 'LIQUIDAR';
    END IF;
    v_titulo_id := v_tx.id;

    IF v_transacao_id IS NULL THEN
      RAISE EXCEPTION
        'A baixa não devolveu o movimento de caixa correspondente.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ------------------------------------------------------------- criar
  IF v_acao = 'CRIAR' THEN
    v_descricao := nullif(btrim(coalesce(p_nova->>'descricao', '')), '');
    v_descricao := coalesce(
      v_descricao,
      nullif(btrim(coalesce(v_primeiro.memo, '')), ''),
      nullif(btrim(coalesce(v_primeiro.nome, '')), ''),
      'Movimento bancário importado'
    );

    /*
     * O sentido do extrato manda; o usuário só escolhe entre os dois tipos
     * daquele sentido. Deixar o tipo livre permitiria transformar um débito em
     * receita, o que inverteria o resultado da empresa a partir de um extrato.
     */
    v_tipo := CASE
      WHEN v_entrada AND upper(coalesce(p_nova->>'tipo', '')) = 'DEPOSITO' THEN 'DEPOSITO'
      WHEN v_entrada THEN 'RECEITA'
      WHEN upper(coalesce(p_nova->>'tipo', '')) = 'SAQUE' THEN 'SAQUE'
      ELSE 'DESPESA'
    END::public.tipos_transacao;

    IF nullif(btrim(coalesce(p_metodopagamento, '')), '') IS NOT NULL THEN
      BEGIN
        v_metodo := btrim(p_metodopagamento)::public.metodo_pagamento;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Forma de pagamento inválida: %.', btrim(p_metodopagamento)
          USING ERRCODE = '22023';
      END;
    ELSE
      v_metodo := NULL;
    END IF;

    INSERT INTO public.transacao (
      descricao, valor, valor_base, "valorLiquido",
      valor_acrescimos, valor_descontos,
      data, competencia_em, vencimento_em, pago_em,
      tipo, pendente, banco_id, metodopagamento,
      categoria, categoria_id, plano_de_conta_id, centro_custo_id,
      cliente_id, fornecedor_id, nomepagador, cpfcnpjpagador,
      created_by, baixado_por
    ) VALUES (
      v_descricao,
      round(v_alvo_centavos / 100.0, 2),
      round(v_alvo_centavos / 100.0, 2),
      round(v_alvo_centavos / 100.0, 2),
      0, 0,
      v_data,
      coalesce(nullif(p_nova->>'competencia_em', '')::timestamptz, v_data),
      v_data, v_data,
      v_tipo, false, v_imp.banco_id, v_metodo,
      coalesce(nullif(btrim(coalesce(p_nova->>'categoria', '')), ''), 'NÃO RELACIONADO'),
      nullif(p_nova->>'categoria_id', '')::integer,
      nullif(p_nova->>'plano_de_conta_id', '')::integer,
      nullif(p_nova->>'centro_custo_id', '')::integer,
      nullif(p_nova->>'cliente_id', '')::integer,
      nullif(p_nova->>'fornecedor_id', '')::integer,
      -- Colunas NOT NULL herdadas do desenho antigo da tabela. Tarifa bancária
      -- não tem pagador, e inventar um cadastro para ela seria pior.
      coalesce(nullif(btrim(coalesce(p_nova->>'nomepagador', '')), ''),
               nullif(btrim(coalesce(v_primeiro.nome, '')), ''),
               'Extrato bancário'),
      coalesce(nullif(btrim(coalesce(p_nova->>'cpfcnpjpagador', '')), ''), ''),
      p_usuario, p_usuario
    ) RETURNING id INTO v_transacao_id;

    v_titulo_id := NULL;
    v_acao_gravada := 'CRIAR';
  END IF;

  -- A marcação fecha a operação, e vale para todas as linhas do ato de uma vez.
  UPDATE public.ofx_movimento
     SET status = 'CONCILIADO',
         acao_conciliacao = v_acao_gravada,
         transacao_id = v_transacao_id,
         titulo_origem_id = v_titulo_id,
         observacao = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
         conciliado_em = now(),
         conciliado_por = p_usuario
   WHERE id = ANY(v_ids);

  RETURN jsonb_build_object(
    'movimento_id', v_ids[1],
    'movimento_ids', to_jsonb(v_ids),
    'status', 'CONCILIADO',
    'acao', v_acao_gravada,
    'transacao_id', v_transacao_id,
    'titulo_origem_id', v_titulo_id,
    'baixa', v_resultado
  );
END;
$function$;

ALTER FUNCTION public.conciliar_movimentos_ofx(
  bigint[], text, bigint, numeric, text, integer, integer, jsonb, uuid, text
) OWNER TO postgres;

COMMENT ON FUNCTION public.conciliar_movimentos_ofx(
  bigint[], text, bigint, numeric, text, integer, integer, jsonb, uuid, text
) IS
  'Aplica uma decisão de conciliação a um conjunto de movimentos do extrato. Com mais de um, a soma das linhas — que precisam ser do mesmo extrato e do mesmo sentido — é o valor conferido contra a transação, e todas passam a apontar para o mesmo lançamento.';

-- ---------------------------------------------------------------------------
-- 3) A assinatura de uma linha só continua existindo
-- ---------------------------------------------------------------------------
--
-- Um movimento é o caso de sempre, e agora é o conjunto de um elemento. Manter
-- a função antiga como fachada evita duas implementações da mesma regra — que
-- é justamente onde elas divergiriam com o tempo.
CREATE OR REPLACE FUNCTION public.conciliar_movimento_ofx(
  p_movimento_id bigint,
  p_acao text,
  p_transacao_id bigint DEFAULT NULL,
  p_valor numeric DEFAULT NULL,
  p_metodopagamento text DEFAULT NULL,
  p_plano_de_conta_id integer DEFAULT NULL,
  p_centro_custo_id integer DEFAULT NULL,
  p_nova jsonb DEFAULT NULL,
  p_usuario uuid DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.conciliar_movimentos_ofx(
    ARRAY[p_movimento_id],
    p_acao,
    p_transacao_id,
    p_valor,
    p_metodopagamento,
    p_plano_de_conta_id,
    p_centro_custo_id,
    p_nova,
    p_usuario,
    p_observacao
  );
$function$;

ALTER FUNCTION public.conciliar_movimento_ofx(
  bigint, text, bigint, numeric, text, integer, integer, jsonb, uuid, text
) OWNER TO postgres;

COMMENT ON FUNCTION public.conciliar_movimento_ofx(
  bigint, text, bigint, numeric, text, integer, integer, jsonb, uuid, text
) IS
  'Conciliação de um movimento do extrato. Fachada de conciliar_movimentos_ofx com um elemento.';
