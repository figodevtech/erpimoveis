-- Entrada fiscal hibrida: parte das linhas segue o vinculo normal e o restante
-- e consolidado em um unico item personalizado. Estoque, apropriacoes, DRE,
-- financeiro e auditoria nascem na mesma transacao.

BEGIN;

ALTER TABLE public.entrada_fiscal_personalizada
  ADD COLUMN IF NOT EXISTS modalidade text NOT NULL DEFAULT 'INTEGRAL',
  ADD COLUMN IF NOT EXISTS produto_id integer REFERENCES public.produto(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS usoconsumo_item_id integer REFERENCES public.usoconsumo_item(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quantidade_personalizada integer,
  ADD COLUMN IF NOT EXISTS custo_unitario numeric(14,4),
  ADD COLUMN IF NOT EXISTS valor_fiscal_documento numeric(14,2),
  ADD COLUMN IF NOT EXISTS item_destino_snapshot jsonb;

ALTER TABLE public.entrada_fiscal_personalizada
  DROP CONSTRAINT IF EXISTS entrada_fiscal_personalizada_modalidade_check,
  DROP CONSTRAINT IF EXISTS entrada_fiscal_personalizada_destino_item_check,
  DROP CONSTRAINT IF EXISTS entrada_fiscal_personalizada_quantidade_check,
  DROP CONSTRAINT IF EXISTS entrada_fiscal_personalizada_snapshot_check;

ALTER TABLE public.entrada_fiscal_personalizada
  ADD CONSTRAINT entrada_fiscal_personalizada_modalidade_check
    CHECK (modalidade IN ('INTEGRAL', 'HIBRIDA')),
  ADD CONSTRAINT entrada_fiscal_personalizada_destino_item_check CHECK (
    (produto_id IS NULL AND usoconsumo_item_id IS NULL)
    OR (destino = 'ESTOQUE' AND produto_id IS NOT NULL AND usoconsumo_item_id IS NULL)
    OR (destino IN ('USOCONSUMO', 'GERAL') AND produto_id IS NULL AND usoconsumo_item_id IS NOT NULL)
  ),
  ADD CONSTRAINT entrada_fiscal_personalizada_quantidade_check
    CHECK (quantidade_personalizada IS NULL OR quantidade_personalizada > 0),
  ADD CONSTRAINT entrada_fiscal_personalizada_snapshot_check CHECK (
    item_destino_snapshot IS NULL OR jsonb_typeof(item_destino_snapshot) = 'object'
  );

COMMENT ON COLUMN public.entrada_fiscal_personalizada.modalidade IS
  'INTEGRAL quando toda a NF-e foi consolidada; HIBRIDA quando coexistiu com linhas normais.';
COMMENT ON COLUMN public.entrada_fiscal_personalizada.item_destino_snapshot IS
  'Retrato imutavel do item que recebeu a quantidade personalizada.';
COMMENT ON COLUMN public.entrada_fiscal_personalizada.valor_fiscal_documento IS
  'vNF integral usado na conferencia e no financeiro, separado do custo de estoque.';

-- Clientes antigos continuam chamando a RPC integral sem os novos campos. O
-- gatilho completa a auditoria a partir da unica linha fisica criada por ela.
CREATE OR REPLACE FUNCTION public.entrada_fiscal_personalizada_completar_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item record;
BEGIN
  NEW.modalidade := coalesce(nullif(NEW.modalidade, ''), 'INTEGRAL');

  IF NEW.destino = 'ESTOQUE' AND NEW.entrada_id IS NOT NULL
     AND (NEW.produto_id IS NULL OR NEW.quantidade_personalizada IS NULL
          OR NEW.custo_unitario IS NULL OR NEW.item_destino_snapshot IS NULL) THEN
    SELECT ei.produto_id, ei.quantidade, ei.valor_unitario_compra, ei.titulo,
           ei.referencia, ei.unidade, e.valor_total
      INTO v_item
      FROM public.entradaitens ei
      JOIN public.entrada e ON e.id = ei.entrada_id
     WHERE ei.entrada_id = NEW.entrada_id
     ORDER BY ei.id
     LIMIT 1;
    IF FOUND THEN
      NEW.produto_id := coalesce(NEW.produto_id, v_item.produto_id);
      NEW.quantidade_personalizada := coalesce(NEW.quantidade_personalizada, v_item.quantidade);
      NEW.custo_unitario := coalesce(NEW.custo_unitario, v_item.valor_unitario_compra);
      NEW.valor_fiscal_documento := coalesce(NEW.valor_fiscal_documento, v_item.valor_total);
      NEW.item_destino_snapshot := coalesce(
        NEW.item_destino_snapshot,
        jsonb_build_object(
          'id', v_item.produto_id,
          'titulo', v_item.titulo,
          'referencia', v_item.referencia,
          'unidade', v_item.unidade
        )
      );
    END IF;
  ELSIF NEW.destino IN ('USOCONSUMO', 'GERAL') AND NEW.usoconsumo_entrada_id IS NOT NULL
     AND (NEW.usoconsumo_item_id IS NULL OR NEW.quantidade_personalizada IS NULL
          OR NEW.custo_unitario IS NULL OR NEW.item_destino_snapshot IS NULL) THEN
    SELECT ui.item_id, ui.quantidade, ui.valor_unitario_compra, ui.titulo,
           ui.referencia, ui.unidade, ue.valor_total
      INTO v_item
      FROM public.usoconsumo_entrada_item ui
      JOIN public.usoconsumo_entrada ue ON ue.id = ui.entrada_id
     WHERE ui.entrada_id = NEW.usoconsumo_entrada_id
     ORDER BY ui.id
     LIMIT 1;
    IF FOUND THEN
      NEW.usoconsumo_item_id := coalesce(NEW.usoconsumo_item_id, v_item.item_id);
      NEW.quantidade_personalizada := coalesce(NEW.quantidade_personalizada, v_item.quantidade);
      NEW.custo_unitario := coalesce(NEW.custo_unitario, v_item.valor_unitario_compra);
      NEW.valor_fiscal_documento := coalesce(NEW.valor_fiscal_documento, v_item.valor_total);
      NEW.item_destino_snapshot := coalesce(
        NEW.item_destino_snapshot,
        jsonb_build_object(
          'id', v_item.item_id,
          'titulo', v_item.titulo,
          'referencia', v_item.referencia,
          'unidade', v_item.unidade
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entrada_fiscal_personalizada_completar_auditoria_trg
  ON public.entrada_fiscal_personalizada;
CREATE TRIGGER entrada_fiscal_personalizada_completar_auditoria_trg
BEFORE INSERT OR UPDATE ON public.entrada_fiscal_personalizada
FOR EACH ROW EXECUTE FUNCTION public.entrada_fiscal_personalizada_completar_auditoria();

-- Completa os registros integrais que ja existiam antes desta migration.
UPDATE public.entrada_fiscal_personalizada
   SET modalidade = modalidade;

CREATE OR REPLACE FUNCTION public.registrar_entrada_fiscal_hibrida(
  p_entrada_produto jsonb,
  p_itens_produto jsonb,
  p_entrada_usoconsumo jsonb,
  p_itens_usoconsumo jsonb,
  p_apropriacoes jsonb,
  p_auditoria jsonb,
  p_custo_total numeric,
  p_custo_personalizado numeric,
  p_total_documento numeric,
  p_transacoes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tem_produto boolean := jsonb_typeof(p_itens_produto) = 'array'
    AND jsonb_array_length(p_itens_produto) > 0;
  v_tem_uso boolean := jsonb_typeof(p_itens_usoconsumo) = 'array'
    AND jsonb_array_length(p_itens_usoconsumo) > 0;
  v_documento_produto bigint := nullif(p_entrada_produto->>'fiscal_dfe_documento_id', '')::bigint;
  v_documento_uso bigint := nullif(p_entrada_usoconsumo->>'documento_fiscal_recebido_id', '')::bigint;
  v_documento_id bigint;
  v_destino_personalizado text := upper(btrim(coalesce(p_auditoria->>'destino', '')));
  v_created_by uuid := coalesce(
    nullif(p_entrada_produto->>'created_by', '')::uuid,
    nullif(p_entrada_usoconsumo->>'created_by', '')::uuid
  );
  v_resultado_produto jsonb;
  v_resultado_uso jsonb;
  v_entrada_id bigint;
  v_usoconsumo_entrada_id bigint;
  v_apropriacao jsonb;
  v_numero_item integer;
  v_quantidade numeric(14,4);
  v_destino_apropriacao text;
  v_numeros integer[] := ARRAY[]::integer[];
  v_ocorrencias integer;
  v_total_fisico numeric(14,2);
  v_total_custom_auditoria numeric(14,2);
  v_total_custom_item numeric(14,2);
  v_total_financeiro numeric(14,2);
  v_transacao jsonb;
BEGIN
  IF jsonb_typeof(p_itens_produto) <> 'array'
     OR jsonb_typeof(p_itens_usoconsumo) <> 'array' THEN
    RAISE EXCEPTION 'As listas fisicas da entrada hibrida sao invalidas.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_tem_produto AND NOT v_tem_uso THEN
    RAISE EXCEPTION 'A entrada hibrida exige ao menos um item fisico.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_apropriacoes) <> 'array' OR jsonb_array_length(p_apropriacoes) < 2 THEN
    RAISE EXCEPTION 'A entrada hibrida exige todas as linhas fiscais da NF-e.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_auditoria) <> 'object'
     OR jsonb_typeof(p_auditoria->'itens_originais') <> 'array'
     OR jsonb_array_length(p_auditoria->'itens_originais') = 0 THEN
    RAISE EXCEPTION 'Informe as linhas consolidadas da entrada personalizada.' USING ERRCODE = '22023';
  END IF;
  IF v_destino_personalizado NOT IN ('ESTOQUE', 'USOCONSUMO', 'GERAL') THEN
    RAISE EXCEPTION 'Destino personalizado invalido.' USING ERRCODE = '22023';
  END IF;
  IF (v_destino_personalizado = 'ESTOQUE' AND NOT v_tem_produto)
     OR (v_destino_personalizado IN ('USOCONSUMO', 'GERAL') AND NOT v_tem_uso) THEN
    RAISE EXCEPTION 'O item personalizado nao pertence ao cabecalho informado.' USING ERRCODE = '22023';
  END IF;
  IF p_custo_total IS NULL OR p_custo_total < 0
     OR p_custo_personalizado IS NULL OR p_custo_personalizado < 0
     OR p_total_documento IS NULL OR p_total_documento < 0 THEN
    RAISE EXCEPTION 'Os totais da entrada hibrida sao invalidos.' USING ERRCODE = '22023';
  END IF;

  v_documento_id := coalesce(v_documento_produto, v_documento_uso);
  IF v_documento_id IS NULL
     OR (v_documento_produto IS NOT NULL AND v_documento_uso IS NOT NULL
         AND v_documento_produto <> v_documento_uso) THEN
    RAISE EXCEPTION 'Os cabecalhos nao apontam para a mesma NF-e.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.fiscal_dfe_documento
   WHERE id = v_documento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento fiscal recebido nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fiscal_dfe_item_apropriacao
     WHERE documento_id = v_documento_id AND cancelada_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A entrada hibrida exige uma NF-e ainda nao apropriada.' USING ERRCODE = '23505';
  END IF;

  -- Cada nItem precisa aparecer uma vez nas apropriacoes e uma vez na origem:
  -- como item fisico normal ou como linha do snapshot personalizado.
  FOR v_apropriacao IN SELECT value FROM jsonb_array_elements(p_apropriacoes)
  LOOP
    v_numero_item := nullif(v_apropriacao->>'numero_item', '')::integer;
    v_quantidade := nullif(v_apropriacao->>'quantidade', '')::numeric;
    v_destino_apropriacao := upper(btrim(coalesce(v_apropriacao->>'destino', '')));
    IF v_numero_item IS NULL OR v_numero_item < 1 OR v_numero_item > 990
       OR v_quantidade IS NULL OR v_quantidade <= 0
       OR v_destino_apropriacao NOT IN ('PRODUTO', 'USOCONSUMO') THEN
      RAISE EXCEPTION 'As apropriacoes fiscais da entrada hibrida sao invalidas.' USING ERRCODE = '22023';
    END IF;
    IF v_numero_item = ANY(v_numeros) THEN
      RAISE EXCEPTION 'O item fiscal % foi apropriado mais de uma vez.', v_numero_item
        USING ERRCODE = '22023';
    END IF;
    IF (v_destino_apropriacao = 'PRODUTO' AND NOT v_tem_produto)
       OR (v_destino_apropriacao = 'USOCONSUMO' AND NOT v_tem_uso) THEN
      RAISE EXCEPTION 'A apropriacao do item % nao possui cabecalho fisico.', v_numero_item
        USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_ocorrencias FROM (
      SELECT nullif(value->>'numero_item_fiscal', '')::integer AS numero
        FROM jsonb_array_elements(p_itens_produto)
      UNION ALL
      SELECT nullif(value->>'numero_item_fiscal', '')::integer
        FROM jsonb_array_elements(p_itens_usoconsumo)
      UNION ALL
      SELECT nullif(value->>'numero_item', '')::integer
        FROM jsonb_array_elements(p_auditoria->'itens_originais')
    ) origens WHERE numero = v_numero_item;
    IF v_ocorrencias <> 1 THEN
      RAISE EXCEPTION 'O item fiscal % deve possuir exatamente uma origem.', v_numero_item
        USING ERRCODE = '22023';
    END IF;
    v_numeros := array_append(v_numeros, v_numero_item);
  END LOOP;

  SELECT count(*) INTO v_ocorrencias FROM (
    SELECT nullif(value->>'numero_item_fiscal', '')::integer AS numero
      FROM jsonb_array_elements(p_itens_produto)
    UNION ALL
    SELECT nullif(value->>'numero_item_fiscal', '')::integer
      FROM jsonb_array_elements(p_itens_usoconsumo)
    UNION ALL
    SELECT nullif(value->>'numero_item', '')::integer
      FROM jsonb_array_elements(p_auditoria->'itens_originais')
  ) origens WHERE numero IS NOT NULL;
  IF v_ocorrencias <> jsonb_array_length(p_apropriacoes) THEN
    RAISE EXCEPTION 'A entrada hibrida nao cobre todas as linhas fiscais uma unica vez.'
      USING ERRCODE = '22023';
  END IF;

  SELECT round(coalesce(sum((value->>'custo_estoque')::numeric), 0), 2)
    INTO v_total_custom_auditoria
    FROM jsonb_array_elements(p_auditoria->'itens_originais');
  IF v_total_custom_auditoria <> round(p_custo_personalizado, 2) THEN
    RAISE EXCEPTION 'O custo personalizado (%) difere da soma das linhas consolidadas (%).',
      round(p_custo_personalizado, 2), v_total_custom_auditoria USING ERRCODE = '23514';
  END IF;

  IF v_destino_personalizado = 'ESTOQUE' THEN
    SELECT round(
      (value->>'quantidade')::numeric * (value->>'valor_unitario_compra')::numeric
      - coalesce(nullif(value->>'valor_desconto', '')::numeric, 0)
      + coalesce(nullif(value->>'valor_frete', '')::numeric, 0)
      + coalesce(nullif(value->>'outras_despesas', '')::numeric, 0), 2
    ) INTO v_total_custom_item
      FROM jsonb_array_elements(p_itens_produto)
     WHERE nullif(value->>'numero_item_fiscal', '') IS NULL
       AND nullif(value->>'produto_id', '')::integer = nullif(p_auditoria->>'produto_id', '')::integer;
  ELSE
    SELECT round(
      (value->>'quantidade')::numeric * (value->>'valor_unitario_compra')::numeric
      - coalesce(nullif(value->>'valor_desconto', '')::numeric, 0)
      + coalesce(nullif(value->>'valor_frete', '')::numeric, 0)
      + coalesce(nullif(value->>'outras_despesas', '')::numeric, 0), 2
    ) INTO v_total_custom_item
      FROM jsonb_array_elements(p_itens_usoconsumo)
     WHERE nullif(value->>'numero_item_fiscal', '') IS NULL
       AND nullif(value->>'item_id', '')::integer = nullif(p_auditoria->>'usoconsumo_item_id', '')::integer;
  END IF;
  IF v_total_custom_item IS NULL OR v_total_custom_item <> round(p_custo_personalizado, 2) THEN
    RAISE EXCEPTION 'O item personalizado nao reproduz o custo consolidado.' USING ERRCODE = '23514';
  END IF;

  IF v_tem_produto THEN
    SELECT public.registrar_entrada_confirmada(
      p_entrada_produto - 'valor_total_documento',
      p_itens_produto,
      '[]'::jsonb
    ) INTO v_resultado_produto;
    v_entrada_id := (v_resultado_produto->>'entrada_id')::bigint;
  END IF;

  IF v_tem_uso THEN
    SELECT public.registrar_entrada_usoconsumo(
      (p_entrada_usoconsumo - 'documento_fiscal_recebido_id') - 'valor_total_documento',
      p_itens_usoconsumo,
      '[]'::jsonb
    ) INTO v_resultado_uso;
    v_usoconsumo_entrada_id := (v_resultado_uso->>'entrada_id')::bigint;
    UPDATE public.usoconsumo_entrada
       SET documento_fiscal_recebido_id = v_documento_id
     WHERE id = v_usoconsumo_entrada_id;
  END IF;

  v_total_fisico := round(
    coalesce((v_resultado_produto->>'valor_total')::numeric, 0)
    + coalesce((v_resultado_uso->>'valor_total')::numeric, 0), 2
  );
  IF v_total_fisico <> round(p_custo_total, 2) THEN
    RAISE EXCEPTION 'O custo fisico (%) difere do custo calculado da NF-e (%).',
      v_total_fisico, round(p_custo_total, 2) USING ERRCODE = '23514';
  END IF;

  -- Com um unico cabecalho, a tela historicamente mostra o vNF no cabecalho. Com
  -- dois, cada metade conserva seu custo fisico e o financeiro compartilhado
  -- carrega o total integral, como na entrada fiscal mista atual.
  IF v_tem_produto AND NOT v_tem_uso THEN
    UPDATE public.entrada SET valor_total = round(p_total_documento, 2)
     WHERE id = v_entrada_id;
  ELSIF v_tem_uso AND NOT v_tem_produto THEN
    UPDATE public.usoconsumo_entrada SET valor_total = round(p_total_documento, 2)
     WHERE id = v_usoconsumo_entrada_id;
  END IF;

  FOR v_apropriacao IN SELECT value FROM jsonb_array_elements(p_apropriacoes)
  LOOP
    v_destino_apropriacao := upper(v_apropriacao->>'destino');
    INSERT INTO public.fiscal_dfe_item_apropriacao(
      documento_id, numero_item, destino, entrada_id,
      usoconsumo_entrada_id, quantidade, created_by
    ) VALUES (
      v_documento_id,
      (v_apropriacao->>'numero_item')::integer,
      v_destino_apropriacao,
      CASE WHEN v_destino_apropriacao = 'PRODUTO' THEN v_entrada_id END,
      CASE WHEN v_destino_apropriacao = 'USOCONSUMO' THEN v_usoconsumo_entrada_id END,
      (v_apropriacao->>'quantidade')::numeric,
      v_created_by
    );
  END LOOP;

  INSERT INTO public.entrada_fiscal_personalizada(
    documento_id, destino, entrada_id, usoconsumo_entrada_id,
    itens_originais, custo_total_estoque, created_by, modalidade,
    produto_id, usoconsumo_item_id, quantidade_personalizada, custo_unitario,
    valor_fiscal_documento, item_destino_snapshot
  ) VALUES (
    v_documento_id,
    v_destino_personalizado,
    CASE WHEN v_destino_personalizado = 'ESTOQUE' THEN v_entrada_id END,
    CASE WHEN v_destino_personalizado IN ('USOCONSUMO', 'GERAL') THEN v_usoconsumo_entrada_id END,
    p_auditoria->'itens_originais',
    round(p_custo_personalizado, 2),
    v_created_by,
    'HIBRIDA',
    nullif(p_auditoria->>'produto_id', '')::integer,
    nullif(p_auditoria->>'usoconsumo_item_id', '')::integer,
    nullif(p_auditoria->>'quantidade_personalizada', '')::integer,
    nullif(p_auditoria->>'custo_unitario', '')::numeric,
    round(p_total_documento, 2),
    p_auditoria->'item_destino_snapshot'
  );

  IF jsonb_typeof(p_transacoes) = 'array' AND jsonb_array_length(p_transacoes) > 0 THEN
    SELECT round(coalesce(sum((value->>'valor')::numeric), 0), 2)
      INTO v_total_financeiro FROM jsonb_array_elements(p_transacoes);
    IF v_total_financeiro <> round(p_total_documento, 2) THEN
      RAISE EXCEPTION 'A soma dos lancamentos financeiros (%) difere do vNF (%).',
        v_total_financeiro, round(p_total_documento, 2) USING ERRCODE = '22023';
    END IF;

    FOR v_transacao IN SELECT value FROM jsonb_array_elements(p_transacoes)
    LOOP
      IF coalesce(nullif(v_transacao->>'valor', '')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'O valor do lancamento financeiro deve ser positivo.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.transacao(
        descricao, valor, "valorLiquido", data, vencimento_em, metodopagamento,
        categoria, categoria_id, tipo, cliente_id, banco_id, nomepagador,
        cpfcnpjpagador, pendente, plano_de_conta_id, plano_de_conta,
        centro_custo_id, centro_custo, entrada_id, usoconsumo_entrada_id,
        origem, created_by
      ) VALUES (
        coalesce(nullif(v_transacao->>'descricao', ''), 'Compra de mercadorias'),
        (v_transacao->>'valor')::numeric,
        (v_transacao->>'valor')::numeric,
        coalesce(nullif(v_transacao->>'data', '')::timestamptz, now()),
        nullif(v_transacao->>'vencimento_em', '')::timestamptz,
        nullif(v_transacao->>'metodopagamento', '')::public.metodo_pagamento,
        coalesce(nullif(v_transacao->>'categoria', ''), 'NAO RELACIONADO'),
        nullif(v_transacao->>'categoria_id', '')::integer,
        'DESPESA'::public.tipos_transacao,
        NULL,
        nullif(v_transacao->>'banco_id', '')::bigint,
        coalesce(nullif(v_transacao->>'nomepagador', ''), 'Fornecedor'),
        coalesce(nullif(regexp_replace(v_transacao->>'cpfcnpjpagador', '\D', '', 'g'), ''), 'NAO INFORMADO'),
        coalesce((v_transacao->>'pendente')::boolean, false),
        nullif(v_transacao->>'plano_de_conta_id', '')::integer,
        nullif(v_transacao->>'plano_de_conta', ''),
        nullif(v_transacao->>'centro_custo_id', '')::integer,
        nullif(v_transacao->>'centro_custo', ''),
        v_entrada_id,
        v_usoconsumo_entrada_id,
        'ENTRADA_FISCAL_MISTA',
        v_created_by
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'entrada_id', v_entrada_id,
    'usoconsumo_entrada_id', v_usoconsumo_entrada_id,
    'valor_total', round(p_total_documento, 2),
    'custo_total_estoque', v_total_fisico,
    'custo_personalizado', round(p_custo_personalizado, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_entrada_fiscal_hibrida(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, numeric, numeric, numeric, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_entrada_fiscal_hibrida(
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, numeric, numeric, numeric, jsonb
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
