-- Reparcelamento de parcelas de nota de compra.
--
-- O CASO
-- No Demir, a NF 22287 (entrada #1029) foi lançada em 5x: quatro de R$ 568,96 e
-- uma de R$ 568,94. O operador quis remanejar os centavos entre as parcelas e
-- não teve como — a aba mostrava as cinco, mas sem o botão de reparcelar.
--
-- Eram dois bloqueios em série:
--
-- 1) AS PARCELAS NASCEM SEM GRUPO
-- `POST /api/entradas/[id]/financeiro` insere as parcelas direto em `transacao`,
-- sem criar o registro em `transacao_parcelamento` que `POST /api/transaction`
-- cria. Sem `parcelamento_id` a aba cai na heurística de descrição, que
-- reconstrói o grupo mas não autoriza escrever nele. A rota foi corrigida junto
-- com esta migration; o backfill abaixo resolve o que já estava gravado.
--
-- 2) A TRAVA DE DOCUMENTO PEGAVA A ENTRADA
-- `reparcelar_transacao_avulsa` recusa grupo vinculado a documento, e a entrada
-- fiscal estava nessa lista. A razão da trava — "a soma responde ao documento, e
-- quem redistribui é o rateio" — vale para OS e venda, que TÊM o rateio. A nota
-- de compra não tem saída nenhuma: não há rateio para ela, e a rota da entrada
-- só expõe GET e POST, com o POST recusando quando já existe lançamento. Uma vez
-- lançada, a divisão das parcelas de uma compra virava imutável.
--
-- O total continua protegido: a regra da soma exige que as pendentes somem
-- exatamente o mesmo de antes, então nenhum reparcelamento muda o que a nota
-- vale. O que passa a ser possível é só redividir esse mesmo total.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A função, com a entrada fora da trava e o vínculo herdado
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reparcelar_transacao_avulsa(
  p_parcelamento_id bigint,
  p_parcelas jsonb,
  p_alterado_por uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_novas int;
  v_pendentes int;
  v_alvo bigint;
  v_soma bigint;
  v_template public.transacao%ROWTYPE;
  v_anterior public.transacao%ROWTYPE;
  v_ids_pendentes bigint[];
  v_item record;
  v_id bigint;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_total int;
  v_resultado jsonb := '[]'::jsonb;
BEGIN
  IF p_parcelas IS NULL
     OR jsonb_typeof(p_parcelas) <> 'array'
     OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma parcela.' USING ERRCODE = '22023';
  END IF;

  v_novas := jsonb_array_length(p_parcelas);

  -- Teto de sanidade: o formulário não oferece nada perto disso, e sem limite um
  -- payload torto viraria centenas de linhas gravadas.
  IF v_novas > 60 THEN
    RAISE EXCEPTION 'Um parcelamento pode ter no maximo 60 parcelas.' USING ERRCODE = '22023';
  END IF;

  SELECT descricao INTO v_base
    FROM public.transacao_parcelamento
   WHERE id = p_parcelamento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parcelamento nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Trava o grupo inteiro antes de qualquer soma: sem isto duas telas podem
  -- reparcelar ao mesmo tempo e cada uma fechar a conta contra um estado velho.
  PERFORM 1
     FROM public.transacao
    WHERE parcelamento_id = p_parcelamento_id
      AND is_deleted = false
    FOR UPDATE;

  /*
   * O grupo tem que continuar sem documento QUE TENHA OUTRO DONO DA DIVISÃO.
   *
   * OS, venda, pagamento múltiplo, evento e adiantamento continuam de fora: em
   * todos eles a soma das linhas responde a um documento que tem o seu próprio
   * jeito de redistribuir — o rateio, em `ajustar_valores_transacao` —, e mexer
   * por aqui furaria aquela validação.
   *
   * A nota de compra é o caso oposto e por isso saiu da lista: não existe rateio
   * de entrada, nem caminho para refazer o lançamento. Deixá-la aqui não
   * protegia nada, só tornava a divisão das parcelas de uma compra permanente.
   * O total dela segue intocável pela regra da soma, logo abaixo.
   */
  IF EXISTS (
    SELECT 1
      FROM public.transacao
     WHERE parcelamento_id = p_parcelamento_id
       AND is_deleted = false
       AND (ordemservicoid IS NOT NULL
         OR vendaid IS NOT NULL
         OR pagamento_multiplo_id IS NOT NULL
         OR evento_financeiro_id IS NOT NULL
         OR adiantamento_id IS NOT NULL
         OR coalesce(eh_adiantamento, false))
  ) THEN
    RAISE EXCEPTION
      'Este parcelamento esta vinculado a um documento e nao pode ser reparcelado por aqui.'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(round(valor * 100)), 0)
    INTO v_pendentes, v_alvo
    FROM public.transacao
   WHERE parcelamento_id = p_parcelamento_id
     AND is_deleted = false
     AND pendente = true;

  IF v_pendentes = 0 THEN
    RAISE EXCEPTION
      'Todas as parcelas deste parcelamento ja foram baixadas. Para corrigir, exclua e lance de novo.'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(round((parcela->>'valor')::numeric * 100)), 0)
    INTO v_soma
    FROM jsonb_array_elements(p_parcelas) AS parcela;

  IF v_soma <> v_alvo THEN
    RAISE EXCEPTION
      'A soma das parcelas deve continuar em R$ %; foi informado R$ %.',
      replace(to_char(v_alvo / 100.0, 'FM999999990.00'), '.', ','),
      replace(to_char(v_soma / 100.0, 'FM999999990.00'), '.', ',')
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT indice AS posicao,
           round((parcela->>'valor')::numeric, 2) AS valor,
           (parcela->>'data')::timestamptz AS data
      FROM jsonb_array_elements(p_parcelas) WITH ORDINALITY AS t(parcela, indice)
  LOOP
    IF v_item.valor IS NULL OR v_item.valor <= 0 THEN
      RAISE EXCEPTION 'O valor da parcela % deve ser maior que zero.', v_item.posicao
        USING ERRCODE = '22023';
    END IF;

    -- A data pode ser passada: renegociar um título vencido é justamente quando
    -- se reparcela. O que não pode é não ter data.
    IF v_item.data IS NULL THEN
      RAISE EXCEPTION 'Informe o vencimento da parcela %.', v_item.posicao
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- As pendentes na ordem em que vencem: as primeiras são reaproveitadas, para
  -- preservar id, autor e data de criação de quem já estava certo.
  SELECT array_agg(id ORDER BY data, id)
    INTO v_ids_pendentes
    FROM public.transacao
   WHERE parcelamento_id = p_parcelamento_id
     AND is_deleted = false
     AND pendente = true;

  SELECT * INTO v_template
    FROM public.transacao
   WHERE id = v_ids_pendentes[1];

  FOR v_item IN
    SELECT indice AS posicao,
           round((parcela->>'valor')::numeric, 2) AS valor,
           (parcela->>'data')::timestamptz AS data
      FROM jsonb_array_elements(p_parcelas) WITH ORDINALITY AS t(parcela, indice)
  LOOP
    IF v_item.posicao <= v_pendentes THEN
      v_id := v_ids_pendentes[v_item.posicao];

      SELECT * INTO v_anterior FROM public.transacao WHERE id = v_id;

      UPDATE public.transacao
         SET valor = v_item.valor,
             -- Havendo desconto lançado, `tg_transacao_valor_coerente` regrava
             -- este campo como `valor - descontos` logo em seguida. É o certo: o
             -- líquido é resultado das linhas de ajuste, não entrada.
             "valorLiquido" = v_item.valor,
             data = v_item.data,
             -- Só acompanha quando já existia: em parcela pendente o vencimento
             -- mora em `data`, e `vencimento_em` é o retrato tirado na baixa.
             -- Preenchê-lo agora criaria um retrato de algo que não aconteceu.
             vencimento_em = CASE WHEN vencimento_em IS NULL THEN NULL ELSE v_item.data END,
             updated_at = now(),
             updated_by = coalesce(p_alterado_por, updated_by)
       WHERE id = v_id;

      IF round(coalesce(v_anterior.valor, 0) * 100) <> round(v_item.valor * 100) THEN
        INSERT INTO public.transacao_valor_historico (
          transacao_id, valor_anterior, valor_novo,
          valor_liquido_anterior, valor_liquido_novo, alterado_por, motivo
        ) VALUES (
          v_id, v_anterior.valor, v_item.valor,
          v_anterior."valorLiquido", v_item.valor, p_alterado_por,
          coalesce(v_motivo, 'Reparcelamento')
        );
      END IF;
    ELSE
      /*
       * A parcela que nasce agora herda o vínculo com a nota.
       *
       * Sem `entrada_id`/`usoconsumo_entrada_id`/`origem` ela sairia órfã do
       * documento: a entrada passaria a ter menos títulos do que o valor
       * lançado, a conferência do documento não fecharia mais e a rota da
       * entrada voltaria a aceitar um lançamento novo, duplicando a dívida.
       */
      INSERT INTO public.transacao (
        descricao, descricao_pagamento, valor, "valorLiquido", data,
        metodopagamento, categoria, categoria_id, plano_de_conta, plano_de_conta_id,
        centro_custo, centro_custo_id, tipo, cliente_id, fornecedor_id, banco_id,
        nomepagador, cpfcnpjpagador, competencia_em, pendente, parcelamento_id,
        entrada_id, usoconsumo_entrada_id, origem,
        created_by
      ) VALUES (
        v_template.descricao, v_template.descricao_pagamento, v_item.valor, v_item.valor,
        v_item.data, v_template.metodopagamento, v_template.categoria,
        v_template.categoria_id, v_template.plano_de_conta, v_template.plano_de_conta_id,
        v_template.centro_custo, v_template.centro_custo_id, v_template.tipo,
        v_template.cliente_id, v_template.fornecedor_id, v_template.banco_id,
        v_template.nomepagador, v_template.cpfcnpjpagador, v_template.competencia_em,
        true, p_parcelamento_id,
        v_template.entrada_id, v_template.usoconsumo_entrada_id, v_template.origem,
        coalesce(p_alterado_por, v_template.created_by)
      )
      RETURNING id INTO v_id;
    END IF;

    v_resultado := v_resultado || jsonb_build_object(
      'id', v_id,
      'valor', v_item.valor,
      'data', v_item.data
    );
  END LOOP;

  -- Sobrou parcela pendente: some por exclusão lógica, o mesmo estado de uma
  -- transação excluída pela tela. Hard delete apagaria a trilha de quem tirou.
  IF v_novas < v_pendentes THEN
    UPDATE public.transacao
       SET is_deleted = true,
           deleted_at = now(),
           deleted_by = p_alterado_por,
           updated_at = now()
     WHERE id = ANY(v_ids_pendentes[(v_novas + 1):v_pendentes]);
  END IF;

  /*
   * Renumera o grupo inteiro, inclusive as parcelas já baixadas.
   *
   * O número faz parte da descrição, e ir de 3x para 5x muda o denominador de
   * todas: deixar "1/3" ao lado de "4/5" seria mentira na tela e no extrato. O
   * gatilho de valor não se opõe — nada aqui toca o valor de linha baixada.
   */
  SELECT count(*) INTO v_total
    FROM public.transacao
   WHERE parcelamento_id = p_parcelamento_id
     AND is_deleted = false;

  UPDATE public.transacao t
     SET descricao = v_base || ' - Parcela ' || ordenadas.posicao || '/' || v_total,
         updated_at = now()
    FROM (
      SELECT id, row_number() OVER (ORDER BY data, id) AS posicao
        FROM public.transacao
       WHERE parcelamento_id = p_parcelamento_id
         AND is_deleted = false
    ) AS ordenadas
   WHERE t.id = ordenadas.id
     AND t.descricao IS DISTINCT FROM
         (v_base || ' - Parcela ' || ordenadas.posicao || '/' || v_total);

  RETURN jsonb_build_object(
    'parcelamentoId', p_parcelamento_id,
    'total', v_total,
    'parcelas', v_resultado
  );
END;
$$;

ALTER FUNCTION public.reparcelar_transacao_avulsa(bigint, jsonb, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reparcelar_transacao_avulsa(bigint, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reparcelar_transacao_avulsa(bigint, jsonb, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Grupo para as parcelas de entrada que já estavam gravadas
-- ---------------------------------------------------------------------------
--
-- Mesmo desenho do backfill de 20260813010000, com um critério melhor: lá o
-- agrupamento era por `created_at` exato + descrição, aqui é pelo vínculo com a
-- entrada, que é dado gravado e não heurística.
--
-- A descrição do grupo é a BASE, sem o sufixo " - Parcela i/N": é dela que a
-- função monta a renumeração, e uma base errada reescreveria a descrição de
-- todas as parcelas do grupo.

-- Um laço, e não um INSERT..RETURNING casado por descrição: duas notas podem ter
-- a mesma descrição base, e o join devolveria o grupo da outra.
DO $$
DECLARE
  v_grupo record;
  v_id bigint;
BEGIN
  FOR v_grupo IN
    SELECT
      regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '') AS base,
      min(created_at) AS nasceu_em,
      array_agg(id) AS ids
    FROM public.transacao
    WHERE is_deleted = false
      AND parcelamento_id IS NULL
      AND descricao ~ ' - Parcela [0-9]+/[0-9]+$'
      AND (entrada_id IS NOT NULL OR usoconsumo_entrada_id IS NOT NULL)
      -- Os vínculos que continuam sem reparcelamento não ganham grupo: o botão
      -- apareceria para depois a função recusar.
      AND ordemservicoid IS NULL
      AND vendaid IS NULL
      AND pagamento_multiplo_id IS NULL
      AND evento_financeiro_id IS NULL
      AND adiantamento_id IS NULL
      AND coalesce(eh_adiantamento, false) = false
    GROUP BY entrada_id, usoconsumo_entrada_id,
             regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '')
    HAVING count(*) > 1
  LOOP
    INSERT INTO public.transacao_parcelamento (descricao, created_at)
    VALUES (v_grupo.base, v_grupo.nasceu_em)
    RETURNING id INTO v_id;

    UPDATE public.transacao
       SET parcelamento_id = v_id
     WHERE id = ANY(v_grupo.ids);
  END LOOP;
END $$;

COMMIT;
