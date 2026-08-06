-- A acao "Pago" nunca funcionou.
--
-- baixar_transacao_pendente recebe o metodo como `text` e o atribui direto a
-- transacao.metodopagamento, que e do enum metodo_pagamento. O Postgres nao
-- converte texto para enum em atribuicao, entao a funcao aborta com
--
--   column "metodopagamento" is of type metodo_pagamento
--   but expression is of type text
--
-- na primeira instrucao util, antes de gravar qualquer coisa. Nenhuma baixa
-- jamais foi concluida por aqui: no Demir, `pago_em` esta nulo nas 76
-- transacoes, inclusive nas 16 marcadas como pagas — essas nasceram pagas, sem
-- passar por esta funcao.
--
-- Um `::metodo_pagamento` seco resolveria o tipo, mas um metodo invalido vindo
-- da tela estouraria com "invalid input value for enum", que nao diz nada a
-- quem esta usando. A conversao ganha erro proprio, na mesma classe (22023) que
-- a funcao ja usa para os demais campos obrigatorios.
--
-- O MESMO ERRO ACONTECE MAIS DUAS VEZES, adiante: os UPDATE de status da OS e da
-- venda montam o valor com CASE, que devolve text, e gravam em colunas dos enums
-- enum_status_os e enum_status_venda. Esses so aparecem quando a transacao esta
-- ligada a um documento — por isso passam despercebidos num teste com lancamento
-- avulso. Os tres levam cast explicito.
--
-- SEGUNDA MUDANCA: o total ja pago passa a somar o valor de face
-- (`valor - valor_acrescimos`) em vez do bruto. E a mesma regra que
-- 20260806140000 estabeleceu para acrescimos e descontos: juros e multa sao do
-- pagamento, nao do documento. Sem isto, uma OS paga com atraso fecharia como
-- paga a mais assim que a baixa passasse a funcionar.
--
-- O restante do corpo e copia fiel do que esta em producao hoje.
BEGIN;

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
AS $$
DECLARE
  v_transacao public.transacao%ROWTYPE;
  v_metodo public.metodo_pagamento;
  v_total_devido numeric(14,2);
  v_total_pago numeric(14,2);
BEGIN
  IF p_transacao_id IS NULL OR p_transacao_id <= 0 THEN
    RAISE EXCEPTION 'Transacao invalida.' USING ERRCODE = '22023';
  END IF;
  IF p_pago_em IS NULL THEN
    RAISE EXCEPTION 'Data do pagamento obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF p_banco_id IS NULL OR p_banco_id <= 0 THEN
    RAISE EXCEPTION 'Banco obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_metodopagamento), '') IS NULL THEN
    RAISE EXCEPTION 'Metodo de pagamento obrigatorio.' USING ERRCODE = '22023';
  END IF;

  -- O metodo chega da tela como texto e precisa virar enum antes de encostar na
  -- coluna. Converter aqui, uma vez, deixa o erro legivel.
  BEGIN
    v_metodo := btrim(p_metodopagamento)::public.metodo_pagamento;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido: %.', btrim(p_metodopagamento)
      USING ERRCODE = '22023';
  END;

  UPDATE public.transacao
  SET vencimento_em = coalesce(vencimento_em, data),
      data = p_pago_em,
      pago_em = p_pago_em,
      baixado_por = p_baixado_por,
      banco_id = p_banco_id,
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
      RAISE EXCEPTION 'A transacao ja foi baixada.' USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'Transacao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.transacao_baixa_historico (
    transacao_id, vencimento_em, pago_em, baixado_por, banco_id, metodopagamento
  ) VALUES (
    v_transacao.id, v_transacao.vencimento_em, v_transacao.pago_em,
    v_transacao.baixado_por, v_transacao.banco_id, v_transacao.metodopagamento
  );

  -- Revalida somente recebimentos vinculados a venda ou OS.
  IF upper(v_transacao.tipo::text) = 'RECEITA' AND v_transacao.evento_financeiro_id IS NULL THEN
    IF v_transacao.ordemservicoid IS NOT NULL THEN
      SELECT round(
        greatest(coalesce(os.orcamentototal, 0), 0) +
        CASE
          WHEN os.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
            greatest(coalesce(os.orcamentototal, 0), 0) * least(greatest(coalesce(os.acrescimo_financeiro_valor, 0), 0), 100) / 100
          WHEN os.acrescimo_financeiro_tipo = 'FIXO' THEN greatest(coalesce(os.acrescimo_financeiro_valor, 0), 0)
          ELSE 0
        END,
        2
      ) INTO v_total_devido
      FROM public.ordemservico os
      WHERE os.id = v_transacao.ordemservicoid;

      -- Face, nao bruto: acrescimo cobrado no pagamento nao abate a OS.
      SELECT coalesce(round(sum(t.valor - coalesce(t.valor_acrescimos, 0)), 2), 0) INTO v_total_pago
      FROM public.transacao t
      WHERE t.ordemservicoid = v_transacao.ordemservicoid
        AND upper(t.tipo::text) = 'RECEITA'
        AND t.pendente = false
        AND t.is_deleted = false
        AND t.evento_financeiro_id IS NULL;

      UPDATE public.ordemservico
      SET status = (CASE WHEN v_total_pago >= v_total_devido THEN 'CONCLUIDO' ELSE 'PAGAMENTO' END)::public.enum_status_os,
          datasaida = CASE WHEN v_total_pago >= v_total_devido THEN coalesce(datasaida, p_pago_em) ELSE datasaida END,
          updatedat = now()
      WHERE id = v_transacao.ordemservicoid;
    END IF;

    IF v_transacao.vendaid IS NOT NULL THEN
      SELECT round(
        greatest(coalesce(v.valortotal, 0), 0) +
        CASE
          WHEN v.acrescimo_financeiro_tipo = 'PORCENTAGEM' THEN
            greatest(coalesce(v.valortotal, 0), 0) * least(greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0), 100) / 100
          WHEN v.acrescimo_financeiro_tipo = 'FIXO' THEN greatest(coalesce(v.acrescimo_financeiro_valor, 0), 0)
          ELSE 0
        END,
        2
      ) INTO v_total_devido
      FROM public.venda v
      WHERE v.id = v_transacao.vendaid;

      SELECT coalesce(round(sum(t.valor - coalesce(t.valor_acrescimos, 0)), 2), 0) INTO v_total_pago
      FROM public.transacao t
      WHERE t.vendaid = v_transacao.vendaid
        AND upper(t.tipo::text) = 'RECEITA'
        AND t.pendente = false
        AND t.is_deleted = false;

      UPDATE public.venda
      SET status = (CASE WHEN v_total_pago >= v_total_devido THEN 'FINALIZADA' ELSE 'PAGAMENTO' END)::public.enum_status_venda,
          updatedat = now()
      WHERE id = v_transacao.vendaid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_transacao.id,
    'pago_em', v_transacao.pago_em,
    'vencimento_em', v_transacao.vencimento_em,
    'pendente', false
  );
END;
$$;

ALTER FUNCTION public.baixar_transacao_pendente(bigint, timestamp with time zone, bigint, text, integer, integer, uuid)
  OWNER TO postgres;

COMMIT;
