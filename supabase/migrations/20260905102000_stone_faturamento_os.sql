-- Confirmação do provedor e registro financeiro indivisíveis e idempotentes.
ALTER TABLE public.pagamento ADD COLUMN IF NOT EXISTS transacao_os_id bigint REFERENCES public.transacao(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.confirmar_pagamento_stone_os(
  p_pagamento_id bigint, p_status text, p_evento text, p_payload jsonb,
  p_registrar_receita boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pagamento public.pagamento;
  v_os public.ordemservico;
  v_cliente public.cliente;
  v_ativo boolean;
  v_banco bigint;
  v_transacao bigint;
  v_metodo text;
  v_valor numeric(14,2);
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  SELECT * INTO v_pagamento FROM public.pagamento WHERE id = p_pagamento_id FOR UPDATE;
  IF NOT FOUND OR v_pagamento.ordemservicoid IS NULL THEN
    RAISE EXCEPTION 'Pagamento de OS não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_status NOT IN ('PAGO', 'ESTORNADO', 'RECUSADO') THEN
    RAISE EXCEPTION 'Status de pagamento inválido.' USING ERRCODE = 'P0001';
  END IF;
  v_ativo := public.faturamento_os_habilitado();
  PERFORM pg_advisory_xact_lock(87001, v_pagamento.ordemservicoid);
  SELECT * INTO v_os FROM public.ordemservico WHERE id = v_pagamento.ordemservicoid FOR UPDATE;

  IF p_status = 'PAGO' AND v_pagamento.status IS DISTINCT FROM 'PAGO'
      AND v_pagamento.transacao_os_id IS NULL AND (v_ativo OR p_registrar_receita) THEN
    PERFORM public.validar_novo_recebimento_os(v_os.id);
    SELECT * INTO v_cliente FROM public.cliente WHERE id = v_os.clienteid;
    SELECT id INTO v_banco FROM public.bancoconta WHERE ativo ORDER BY id LIMIT 1;
    IF v_cliente.id IS NULL OR v_banco IS NULL THEN
      RAISE EXCEPTION 'Defina cliente e conta bancária ativa antes de registrar o pagamento Stone.' USING ERRCODE = 'P0001';
    END IF;
    v_metodo := upper(v_pagamento.metodo);
    v_metodo := CASE WHEN v_metodo LIKE '%PIX%' THEN 'PIX'
      WHEN v_metodo LIKE '%DEBITO%' THEN 'DEBITO'
      WHEN v_metodo LIKE '%CREDITO%' THEN 'CREDITO'
      WHEN v_metodo LIKE '%BOLETO%' THEN 'BOLETO'
      WHEN v_metodo LIKE '%TRANSF%' THEN 'TRANSFERENCIA'
      WHEN v_metodo LIKE '%DINHEIRO%' OR v_metodo LIKE '%CASH%' THEN 'DINHEIRO'
      ELSE v_metodo END;
    v_valor := round(v_pagamento.valor / 100, 2);
    IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Valor Stone inválido.'; END IF;
    INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,metodopagamento,
      categoria,tipo,cliente_id,banco_id,nomepagador,cpfcnpjpagador,ordemservicoid,pendente)
    VALUES('Recebimento OS #' || v_os.id || ' - Maquineta Stone',v_valor,v_valor,now(),v_metodo::public.metodo_pagamento,
      'ORDEM DE SERVIÇO','RECEITA',v_cliente.id,v_banco,coalesce(v_cliente.nomerazaosocial,'Cliente OS'),
      coalesce(v_cliente.cpfcnpj,'00000000000'),v_os.id,false)
    RETURNING id INTO v_transacao;
    INSERT INTO public.pagamento_evento(pagamentoid,tipo,payload)
      VALUES(v_pagamento.id,'TRANSACAO_RECEITA_CRIADA',jsonb_build_object('transacao_id',v_transacao,'ordemservicoid',v_os.id));
  END IF;

  UPDATE public.pagamento SET status = p_status, atualizado_em = now(),
    transacao_os_id = coalesce(v_transacao, transacao_os_id),
    nsu = coalesce(p_payload #>> '{data,transaction_id}', p_payload #>> '{data,id}', nsu),
    autorizacao = coalesce(p_payload #>> '{data,authorization_code}', autorizacao),
    bandeira = coalesce(p_payload #>> '{data,card,brand}', bandeira)
    WHERE id = v_pagamento.id;
  IF v_pagamento.status IS DISTINCT FROM p_status THEN
    INSERT INTO public.pagamento_evento(pagamentoid,tipo,payload) VALUES(v_pagamento.id,p_evento,coalesce(p_payload,'{}'));
  END IF;
  IF p_status = 'PAGO' THEN
    IF v_ativo THEN
      PERFORM public.recalcular_status_financeiro_os(v_os.id);
    ELSE
      UPDATE public.ordemservico SET status = 'CONCLUIDO' WHERE id = v_os.id AND status <> 'CONCLUIDO';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.confirmar_pagamento_stone_os(bigint,text,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pagamento_stone_os(bigint,text,text,jsonb,boolean) TO service_role;
