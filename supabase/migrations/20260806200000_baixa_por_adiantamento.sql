-- Baixa por adiantamento.
--
-- Varias parcelas em aberto sao liquidadas de uma vez por um unico movimento de
-- dinheiro: a factoring antecipa os recebiveis, ou a empresa quita um bloco de
-- contas a pagar num pagamento so.
--
-- O DINHEIRO ENTRA UMA VEZ SO
-- Tres parcelas de 100, cada uma com 98 de liquido (taxa da maquineta), somam
-- 294. A antecipacao cobra a sua propria taxa e deposita 290. Se as parcelas
-- fossem baixadas com banco e o adiantamento tambem tivesse banco, o saldo
-- bancario somaria 294 + 290 = 584 — mais que o dobro do que entrou.
--
-- Por isso: as parcelas sao baixadas SEM banco (a divida do cliente esta
-- quitada, mas o caixa nao se move por elas) e so a transacao de adiantamento
-- carrega banco e valor. O saldo ganha exatamente 290.
--
-- A taxa da antecipacao nao ganha campo proprio: e um DESCONTO na transacao de
-- adiantamento, igual a taxa de recebimento. Bruto 294, desconto 4, liquido 290
-- — a mesma cadeia de 20260806140000.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0) O tipo de desconto da antecipacao
--
-- A taxa da factoring nao e a taxa da maquineta: separa-las deixa o relatorio
-- dizer quanto se pagou por antecipar e quanto por receber no cartao.
-- ---------------------------------------------------------------------------

INSERT INTO public.tipos_ajuste_transacao (codigo, nome, natureza, codigo_sistema, descricao)
VALUES ('TAXA_ANTECIPACAO', 'Taxa de antecipação', 'DESCONTO', 'TAXA_ANTECIPACAO',
        'Custo cobrado para antecipar o recebimento dos títulos.')
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1) O vinculo
-- ---------------------------------------------------------------------------

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS adiantamento_id bigint,
  ADD COLUMN IF NOT EXISTS eh_adiantamento boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transacao_adiantamento_id_fkey'
  ) THEN
    ALTER TABLE public.transacao
      ADD CONSTRAINT transacao_adiantamento_id_fkey
      FOREIGN KEY (adiantamento_id) REFERENCES public.transacao(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS transacao_adiantamento_idx
  ON public.transacao(adiantamento_id) WHERE adiantamento_id IS NOT NULL;

-- Um nivel so: o adiantamento nao pode ser adiantado por outro, senao o saldo
-- passaria a depender de percorrer uma corrente para saber onde o dinheiro
-- realmente entrou.
ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_adiantamento_um_nivel_check,
  ADD CONSTRAINT transacao_adiantamento_um_nivel_check
    CHECK (NOT (eh_adiantamento AND adiantamento_id IS NOT NULL));

ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_adiantamento_nao_circular_check,
  ADD CONSTRAINT transacao_adiantamento_nao_circular_check
    CHECK (adiantamento_id IS NULL OR adiantamento_id <> id);

COMMENT ON COLUMN public.transacao.adiantamento_id IS
  'Nas parcelas liquidadas por antecipacao, aponta para a transacao de adiantamento que trouxe o dinheiro.';
COMMENT ON COLUMN public.transacao.eh_adiantamento IS
  'true na transacao que representa o movimento unico de dinheiro da antecipacao.';

-- ---------------------------------------------------------------------------
-- 2) A operacao
--
-- Aqui e tudo ou nada, ao contrario da baixa em lote comum: o adiantamento e as
-- parcelas so fazem sentido juntos. Uma parcela que ficasse de fora apareceria
-- em aberto tendo sido paga, e o adiantamento cobriria valor que ninguem deve.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.baixar_por_adiantamento(
  p_ids bigint[],
  p_adiantamento jsonb,
  p_baixado_por uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Selecione ao menos uma transacao.' USING ERRCODE = '22023';
  END IF;

  -- Trava as linhas antes de conferir: sem isto, duas antecipacoes simultaneas
  -- poderiam incluir a mesma parcela.
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

  -- Receita e despesa nao se antecipam no mesmo movimento: o dinheiro anda em
  -- sentidos opostos e o adiantamento tem um sentido so.
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

  -- A transacao de antecipacao. O bruto e a soma dos liquidos das parcelas: e o
  -- que a antecipadora reconheceu. A taxa dela entra depois, como desconto, pelo
  -- mesmo caminho de qualquer outro desconto.
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

  -- As parcelas: quitadas, apontando para o adiantamento, e SEM banco — o
  -- dinheiro entrou pelo adiantamento, nao por elas.
  UPDATE public.transacao
     SET pendente = false,
         pago_em = v_pago_em,
         baixado_por = p_baixado_por,
         vencimento_em = coalesce(vencimento_em, data),
         banco_id = NULL,
         adiantamento_id = v_adiantamento_id,
         updated_at = now()
   WHERE id = ANY(p_ids);

  -- Historico de baixa de cada parcela, como na baixa individual. O banco fica
  -- nulo pelo mesmo motivo.
  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
  )
  SELECT id, vencimento_em, pago_em, baixado_por, NULL, metodopagamento
    FROM public.transacao WHERE id = ANY(p_ids);

  -- A taxa da antecipacao vem do proprio dialog e entra aqui dentro, na mesma
  -- transacao: se fosse lancada depois, uma falha no meio deixaria o
  -- adiantamento com liquido maior do que o dinheiro que entrou de verdade.
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
    'tipo', v_tipo
  );
END;
$$;

ALTER FUNCTION public.baixar_por_adiantamento(bigint[], jsonb, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.baixar_por_adiantamento(bigint[], jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.baixar_por_adiantamento(bigint[], jsonb, uuid) TO service_role;

COMMIT;
