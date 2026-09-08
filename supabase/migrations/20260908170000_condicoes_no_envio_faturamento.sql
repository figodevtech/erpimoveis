BEGIN;

-- Salva o acordo e muda a etapa sob o mesmo lock, preservando a RPC de retorno.
CREATE OR REPLACE FUNCTION public.transicionar_faturamento_os(
  p_os_id integer, p_status text, p_condicoes jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_saldo numeric;
  v_total numeric;
  v_resultado jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  PERFORM pg_advisory_xact_lock(87001, p_os_id);
  PERFORM 1 FROM public.ordemservico WHERE id = p_os_id FOR UPDATE;
  IF p_status <> 'FATURAMENTO' THEN
    RAISE EXCEPTION 'Condições de pagamento são informadas no envio para faturamento.';
  END IF;
  IF p_condicoes IS NULL OR jsonb_typeof(p_condicoes) <> 'object' THEN
    RAISE EXCEPTION 'Informe as condições de pagamento.';
  END IF;
  SELECT saldo_disponivel_lancamento INTO v_saldo FROM public.resumo_financeiro_os(p_os_id);
  SELECT coalesce(sum((item->>'valor')::numeric), 0) INTO v_total
    FROM jsonb_array_elements(coalesce(nullif(p_condicoes->'pagamentos_previstos', 'null'::jsonb), '[]'::jsonb)) item;
  IF round(v_total, 2) <> round(greatest(coalesce(v_saldo, 0), 0), 2) THEN
    RAISE EXCEPTION 'A soma dos pagamentos previstos precisa fechar o saldo ainda não coberto da OS. Atualize a tela.';
  END IF;

  -- A versão de dois argumentos revalida modo, origem e status sob estes locks.
  PERFORM public.transicionar_faturamento_os(p_os_id, p_status);
  UPDATE public.ordemservico SET
    pagamentos_previstos = nullif(p_condicoes->'pagamentos_previstos', 'null'::jsonb),
    forma_pagamento = nullif(p_condicoes->>'forma_pagamento', '')::public.metodo_pagamento,
    parcelas_pagamento = (p_condicoes->>'parcelas_pagamento')::integer,
    descricao_financeiro = p_condicoes->>'descricao_financeiro',
    garantia = CASE WHEN p_condicoes ? 'garantia' THEN p_condicoes->>'garantia' ELSE garantia END
  WHERE id = p_os_id;
  SELECT to_jsonb(os) INTO v_resultado FROM public.ordemservico os WHERE id = p_os_id;
  RETURN v_resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.transicionar_faturamento_os(integer,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transicionar_faturamento_os(integer,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
