-- Reparcelamento: vencimento livre e convivência com acréscimo/desconto.
--
-- `reparcelar_transacao_avulsa` nasceu (20260813010000) com duas travas que a
-- primeira renegociação real derrubou — o IPVA #1330 do Demir, parcelado em 3x,
-- com a parcela 1/3 vencida no dia anterior e R$ 15,97 de juros lançados. Ele
-- não podia ser reparcelado por nenhum dos dois motivos.
--
-- 1) VENCIMENTO DE HOJE EM DIANTE
-- Copiada da regra que a aba Detalhes aplica ao lançar, onde faz sentido: título
-- que se cria a vencer não nasce vencido. No reparcelamento ela impedia o caso
-- mais comum, porque reparcelar é justamente o que se faz com o que não foi
-- pago — e não deixava nem MANTER a data da parcela que já tinha vencido.
-- Título vencido em aberto é estado legítimo do sistema; quem trata disso é o
-- acompanhamento financeiro, não uma trava de formulário. O limite passa a ser
-- o operador, e errar a data se conserta reparcelando de novo.
--
-- 2) RECUSA DE PARCELA COM AJUSTE LANÇADO
-- Era mais rígida que o resto do sistema sem precisar. `ajustar_valores_transacao`
-- já reescreve o bruto de linha com acréscimo, e `tg_transacao_valor_coerente`
-- (20260806140000) existe exatamente para isso: quando `valor` muda, ele refaz
-- `valor_base = valor - acrescimos` e, havendo desconto, o líquido volta a ser
-- `valor - descontos`. A linha de ajuste não se move — fica na parcela daquela
-- posição, e a face acompanha o novo valor. Reduzir a quantidade continua
-- levando o ajuste junto com a parcela que sai, do mesmo jeito que excluir uma
-- transação pela tela leva.
--
-- Só esses dois blocos mudam; o resto da função é idêntico.
BEGIN;

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
   * O grupo tem que continuar avulso.
   *
   * Vínculo pode ter aparecido depois — uma parcela apontada para uma OS, por
   * exemplo. A partir daí a soma das linhas responde ao documento, e redividi-la
   * por aqui furaria a validação de grupo que `ajustar_valores_transacao` faz.
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
         OR entrada_id IS NOT NULL
         OR usoconsumo_entrada_id IS NOT NULL
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
      INSERT INTO public.transacao (
        descricao, descricao_pagamento, valor, "valorLiquido", data,
        metodopagamento, categoria, categoria_id, plano_de_conta, plano_de_conta_id,
        centro_custo, centro_custo_id, tipo, cliente_id, fornecedor_id, banco_id,
        nomepagador, cpfcnpjpagador, competencia_em, pendente, parcelamento_id,
        created_by
      ) VALUES (
        v_template.descricao, v_template.descricao_pagamento, v_item.valor, v_item.valor,
        v_item.data, v_template.metodopagamento, v_template.categoria,
        v_template.categoria_id, v_template.plano_de_conta, v_template.plano_de_conta_id,
        v_template.centro_custo, v_template.centro_custo_id, v_template.tipo,
        v_template.cliente_id, v_template.fornecedor_id, v_template.banco_id,
        v_template.nomepagador, v_template.cpfcnpjpagador, v_template.competencia_em,
        true, p_parcelamento_id, coalesce(p_alterado_por, v_template.created_by)
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

COMMIT;
