-- Controle de concorrência no ajuste de valores.
--
-- Sem isto o rateio era last-write-wins silencioso: dois usuários abriam a mesma
-- OS, o primeiro salvava, o segundo salvava por cima com números calculados
-- sobre o estado antigo — e passava, porque a soma continuava a mesma (ela é
-- justamente o que o rateio não pode mudar). O segundo apagava o trabalho do
-- primeiro sem nenhum aviso.
--
-- Agora cada item carrega os valores que estavam na tela quando ela abriu, e a
-- função recusa se algum deles já tiver mudado no banco.
BEGIN;

CREATE OR REPLACE FUNCTION public.ajustar_valores_transacao(
  p_itens jsonb,
  p_alterado_por uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids bigint[];
  v_total int;
  v_qtd_os int;
  v_qtd_venda int;
  v_qtd_avulsa int;
  v_os bigint;
  v_venda bigint;
  v_esperado int;
  v_soma_atual bigint;
  v_soma_nova bigint;
  v_item record;
  v_anterior public.transacao%ROWTYPE;
  v_resultado jsonb := '[]'::jsonb;
BEGIN
  IF p_itens IS NULL
     OR jsonb_typeof(p_itens) <> 'array'
     OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma transacao para ajustar.' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg((item->>'id')::bigint)
    INTO v_ids
    FROM jsonb_array_elements(p_itens) AS item;

  v_total := array_length(v_ids, 1);

  IF v_total <> (SELECT count(DISTINCT x) FROM unnest(v_ids) AS x) THEN
    RAISE EXCEPTION 'A mesma transacao foi enviada mais de uma vez.' USING ERRCODE = '22023';
  END IF;

  -- Trava as linhas antes de qualquer leitura de soma.
  PERFORM 1
     FROM public.transacao
    WHERE id = ANY(v_ids)
      AND is_deleted = false
    FOR UPDATE;

  SELECT
    count(*),
    count(DISTINCT ordemservicoid) FILTER (WHERE ordemservicoid IS NOT NULL),
    count(DISTINCT vendaid) FILTER (WHERE vendaid IS NOT NULL),
    count(*) FILTER (WHERE ordemservicoid IS NULL AND vendaid IS NULL),
    max(ordemservicoid),
    max(vendaid),
    coalesce(sum(round(valor * 100)), 0)
  INTO v_esperado, v_qtd_os, v_qtd_venda, v_qtd_avulsa, v_os, v_venda, v_soma_atual
  FROM public.transacao
  WHERE id = ANY(v_ids)
    AND is_deleted = false;

  IF v_esperado <> v_total THEN
    RAISE EXCEPTION 'Transacao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  /*
   * Concorrencia: os valores precisam estar exatamente como estavam quando a
   * tela foi aberta. `coalesce(nullif("valorLiquido", 0), valor)` espelha o
   * `valorLiquidoEfetivo` do cliente — registro antigo com liquido nulo ou
   * zerado vale o bruto, dos dois lados, senao a comparacao acusaria conflito
   * onde nao existe.
   */
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_itens) AS item
      JOIN public.transacao t ON t.id = (item->>'id')::bigint
     WHERE item->>'valorAnterior' IS NULL
        OR item->>'valorLiquidoAnterior' IS NULL
        OR round(t.valor * 100) <> round((item->>'valorAnterior')::numeric * 100)
        OR round(coalesce(nullif(t."valorLiquido", 0), t.valor) * 100)
             <> round((item->>'valorLiquidoAnterior')::numeric * 100)
  ) THEN
    RAISE EXCEPTION
      'Os valores mudaram depois que esta tela foi aberta. Recarregue e refaca o rateio.'
      USING ERRCODE = '40001';
  END IF;

  IF v_qtd_os + v_qtd_venda > 1 OR ((v_qtd_os + v_qtd_venda) = 1 AND v_qtd_avulsa > 0) THEN
    RAISE EXCEPTION 'O ajuste precisa ficar dentro de um unico documento.' USING ERRCODE = '22023';
  END IF;

  IF v_qtd_os = 1 OR v_qtd_venda = 1 THEN
    -- Com documento: exige o grupo completo, senao a soma nao pode ser garantida.
    SELECT count(*)
      INTO v_esperado
      FROM public.transacao
     WHERE is_deleted = false
       AND upper(tipo::text) = 'RECEITA'
       AND evento_financeiro_id IS NULL
       AND ((v_qtd_os = 1 AND ordemservicoid = v_os)
         OR (v_qtd_venda = 1 AND vendaid = v_venda));

    IF v_esperado <> v_total THEN
      RAISE EXCEPTION
        'O ajuste precisa incluir os % pagamentos do documento; vieram %.', v_esperado, v_total
        USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(sum(round((item->>'valor')::numeric * 100)), 0)
      INTO v_soma_nova
      FROM jsonb_array_elements(p_itens) AS item;

    IF v_soma_nova <> v_soma_atual THEN
      RAISE EXCEPTION
        'A soma dos valores brutos deve continuar em R$ %; foi informado R$ %.',
        replace(to_char(v_soma_atual / 100.0, 'FM999999990.00'), '.', ','),
        replace(to_char(v_soma_nova / 100.0, 'FM999999990.00'), '.', ',')
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_total > 1 THEN
    RAISE EXCEPTION 'Lancamentos avulsos sao ajustados um a um.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT (item->>'id')::bigint AS id,
           round((item->>'valor')::numeric, 2) AS valor,
           round(coalesce(item->>'valorLiquido', item->>'valor')::numeric, 2) AS valor_liquido
      FROM jsonb_array_elements(p_itens) AS item
  LOOP
    IF v_item.valor <= 0 THEN
      RAISE EXCEPTION 'O valor bruto da transacao % deve ser maior que zero.', v_item.id
        USING ERRCODE = '22023';
    END IF;

    IF v_item.valor_liquido <= 0 THEN
      RAISE EXCEPTION 'O valor liquido da transacao % deve ser maior que zero.', v_item.id
        USING ERRCODE = '22023';
    END IF;

    IF v_item.valor_liquido > v_item.valor THEN
      RAISE EXCEPTION 'O liquido da transacao % nao pode ser maior que o bruto.', v_item.id
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_anterior FROM public.transacao WHERE id = v_item.id;

    UPDATE public.transacao
       SET valor = v_item.valor,
           "valorLiquido" = v_item.valor_liquido,
           updated_at = now()
     WHERE id = v_item.id;

    INSERT INTO public.transacao_valor_historico (
      transacao_id, valor_anterior, valor_novo,
      valor_liquido_anterior, valor_liquido_novo, alterado_por, motivo
    ) VALUES (
      v_item.id, v_anterior.valor, v_item.valor,
      v_anterior."valorLiquido", v_item.valor_liquido, p_alterado_por, nullif(btrim(p_motivo), '')
    );

    v_resultado := v_resultado || jsonb_build_object(
      'id', v_item.id,
      'valor', v_item.valor,
      'valorLiquido', v_item.valor_liquido
    );
  END LOOP;

  /*
   * Nao revalidamos o status da OS/venda de proposito. Com documento, a soma dos
   * brutos e constante; e como toda linha precisa terminar com valor > 0, o total
   * ja baixado tambem nao pode cruzar o total devido em nenhum sentido. Ou seja,
   * o status nao tem como mudar por causa de um rateio.
   */

  RETURN jsonb_build_object('itens', v_resultado);
END;
$$;

ALTER FUNCTION public.ajustar_valores_transacao(jsonb, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ajustar_valores_transacao(jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_valores_transacao(jsonb, uuid, text) TO service_role;

COMMIT;
