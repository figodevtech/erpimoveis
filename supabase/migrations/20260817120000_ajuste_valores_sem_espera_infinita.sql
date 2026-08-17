-- Salvamento de transacao travado no "Salvando..." para sempre.
--
-- SINTOMA
-- Mexer em acrescimo/desconto e depois no bruto/liquido e salvar deixava o
-- botao girando indefinidamente. Nao havia erro na tela, nada no toast: so o
-- spinner.
--
-- O QUE ESTAVA ACONTECENDO
-- O salvamento da aba Detalhes dispara ate tres requisicoes em sequencia
-- (`PUT /ajustes`, `POST /ajustar-valores`, `PATCH /`), e a do meio chama esta
-- funcao, que comeca travando as linhas:
--
--   PERFORM 1 FROM public.transacao
--    WHERE id = ANY(v_ids) AND is_deleted = false
--    FOR UPDATE;                                  -- sem ORDER BY
--
-- Duas coisas se somavam:
--
--   1. `FOR UPDATE` sem ordem. Duas chamadas concorrentes que tocam conjuntos
--      com intersecao podem travar a linha A e a B em ordens opostas — deadlock
--      classico. O Postgres desfaz uma delas depois de `deadlock_timeout` (1s),
--      mas com o erro cru `40P01`, que a rota devolvia como 500 sem mensagem
--      util.
--
--   2. `lock_timeout = 0` no banco. Quem fica esperando a linha travada nao
--      desiste: espera ate o `statement_timeout`, que aqui e de **2 minutos**.
--      Como o axios do cliente nao tinha timeout nenhum, o spinner ficava dois
--      minutos girando antes de qualquer coisa aparecer — na pratica, "travou".
--
-- Verificado no banco do Demir durante a investigacao: quatro sessoes do
-- postgrest executando esta mesma funcao ao mesmo tempo, uma delas em
-- `Lock/tuple` esperando outra.
--
-- A CORRECAO
-- `ORDER BY id` faz toda chamada travar as linhas na mesma ordem, o que elimina
-- o deadlock entre chamadas desta funcao — o LockRows fica acima do Sort, entao
-- as linhas sao travadas ja ordenadas.
--
-- `lock_timeout` local de 5 segundos troca a espera de dois minutos por uma
-- recusa rapida com uma frase que a pessoa entende. Cinco segundos e bastante
-- para o caso normal (a outra chamada dura milissegundos) e curto o suficiente
-- para nao parecer travamento.
--
-- O `lock_timeout` entra como clausula da propria funcao, nao como `SET LOCAL` no
-- corpo. A diferenca importa: a restauracao automatica de uma clausula `SET` vale
-- so para a variavel daquela clausula, entao um `SET LOCAL lock_timeout` dentro do
-- corpo vazaria para o resto da transacao — verificado, o valor continuava em 5s
-- depois de a funcao retornar. Como clausula, ele vale do inicio ao fim da funcao
-- (inclusive nos UPDATE) e e restaurado na saida, com erro ou sem.

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
SET lock_timeout = '5s'
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

  -- Trava as linhas antes de qualquer leitura de soma, e sempre na mesma ordem:
  -- e a ordem que impede duas chamadas simultaneas de se travarem uma a outra.
  BEGIN
    PERFORM 1
       FROM public.transacao
      WHERE id = ANY(v_ids)
        AND is_deleted = false
      ORDER BY id
      FOR UPDATE;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE EXCEPTION
        'Outra pessoa esta salvando esta transacao neste momento. Espere alguns segundos e tente de novo.'
        USING ERRCODE = '55P03';
  END;

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

  -- Tambem na ordem do id: as linhas ja estao travadas, mas manter a ordem faz
  -- o UPDATE seguir o mesmo caminho de quem leu, e nao custa nada.
  FOR v_item IN
    SELECT (item->>'id')::bigint AS id,
           round((item->>'valor')::numeric, 2) AS valor,
           round(coalesce(item->>'valorLiquido', item->>'valor')::numeric, 2) AS valor_liquido
      FROM jsonb_array_elements(p_itens) AS item
     ORDER BY 1
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
