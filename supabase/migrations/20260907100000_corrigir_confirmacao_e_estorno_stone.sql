-- O fato confirmado pelo provedor não depende da disponibilidade do lançamento.
-- Sem reprocessamento histórico: apenas novas confirmações e pendências explícitas.
ALTER TABLE public.pagamento
  ADD COLUMN IF NOT EXISTS financeiro_pendente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS financeiro_erro text,
  ADD COLUMN IF NOT EXISTS confirmado_em timestamptz;
CREATE INDEX IF NOT EXISTS pagamento_financeiro_pendente_os_idx
  ON public.pagamento(ordemservicoid,id) WHERE financeiro_pendente;

CREATE OR REPLACE FUNCTION public.conciliar_financeiro_stone_os(p_pagamento_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pagamento public.pagamento;
  v_os public.ordemservico;
  v_cliente public.cliente;
  v_tx public.transacao;
  v_banco bigint; v_transacao bigint; v_os_id integer;
  v_metodo text; v_valor numeric(14,2); v_erro text;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009, 1);
  SELECT ordemservicoid INTO v_os_id FROM public.pagamento WHERE id=p_pagamento_id;
  IF v_os_id IS NULL THEN RAISE EXCEPTION 'Pagamento de OS não encontrado.' USING ERRCODE='P0002'; END IF;
  -- Mesma ordem de locks usada no encaminhamento da OS: OS antes de pagamento.
  PERFORM pg_advisory_xact_lock(87001,v_os_id);
  SELECT * INTO v_os FROM public.ordemservico WHERE id=v_os_id FOR UPDATE;
  SELECT * INTO v_pagamento FROM public.pagamento WHERE id=p_pagamento_id FOR UPDATE;
  IF NOT v_pagamento.financeiro_pendente THEN RETURN; END IF;

  BEGIN
    -- Impede a reentrada do mesmo pagamento quando a conciliação muda o status
    -- da OS. Uma falha reverte esta marca junto de todos os efeitos financeiros.
    UPDATE public.pagamento SET financeiro_pendente=false,financeiro_erro=NULL WHERE id=p_pagamento_id;
    IF v_pagamento.status='ESTORNADO' THEN
      SELECT * INTO v_tx FROM public.transacao WHERE id=v_pagamento.transacao_os_id FOR UPDATE;
      IF FOUND AND NOT v_tx.is_deleted THEN
        IF v_tx.ordemservicoid IS DISTINCT FROM v_os_id OR v_tx.tipo::text <> 'RECEITA' THEN
          RAISE EXCEPTION 'O vínculo financeiro da Stone foi alterado. Confira o recebimento antes de estornar.';
        END IF;
        -- Usa o estorno normal para manter o histórico de baixa. O título
        -- gerado pela cobrança devolvida também é cancelado, liberando cobertura.
        IF NOT coalesce(v_tx.pendente,false) THEN
          PERFORM public.estornar_baixa_transacao(v_tx.id,NULL);
        END IF;
        UPDATE public.transacao SET is_deleted=true,updated_at=now() WHERE id=v_tx.id;
        INSERT INTO public.pagamento_evento(pagamentoid,tipo,payload)
          VALUES(p_pagamento_id,'TRANSACAO_RECEITA_ESTORNADA',jsonb_build_object('transacao_id',v_tx.id));
        PERFORM public.recalcular_status_financeiro_os(v_os_id);
      END IF;
    ELSIF v_pagamento.status='PAGO' AND v_pagamento.transacao_os_id IS NULL THEN
      PERFORM public.validar_novo_recebimento_os(v_os_id);
      SELECT * INTO v_cliente FROM public.cliente WHERE id=v_os.clienteid;
      SELECT id INTO v_banco FROM public.bancoconta WHERE ativo ORDER BY id LIMIT 1;
      IF v_cliente.id IS NULL OR v_banco IS NULL THEN
        RAISE EXCEPTION 'Defina cliente e conta bancária ativa para registrar o recebimento Stone.';
      END IF;
      v_metodo := upper(v_pagamento.metodo);
      v_metodo := CASE WHEN v_metodo LIKE '%PIX%' THEN 'PIX'
        WHEN v_metodo LIKE '%DEBITO%' THEN 'DEBITO' WHEN v_metodo LIKE '%CREDITO%' THEN 'CREDITO'
        WHEN v_metodo LIKE '%BOLETO%' THEN 'BOLETO' WHEN v_metodo LIKE '%TRANSF%' THEN 'TRANSFERENCIA'
        WHEN v_metodo LIKE '%DINHEIRO%' OR v_metodo LIKE '%CASH%' THEN 'DINHEIRO' ELSE v_metodo END;
      v_valor := round(v_pagamento.valor/100,2);
      IF v_valor IS NULL OR v_valor<=0 THEN RAISE EXCEPTION 'Valor Stone inválido.'; END IF;
      INSERT INTO public.transacao(descricao,valor,"valorLiquido",data,metodopagamento,categoria,tipo,
        cliente_id,banco_id,nomepagador,cpfcnpjpagador,ordemservicoid,pendente)
      VALUES('Recebimento OS #'||v_os.id||' - Maquineta Stone',v_valor,v_valor,
        coalesce(v_pagamento.confirmado_em,now()),v_metodo::public.metodo_pagamento,'ORDEM DE SERVIÇO','RECEITA',
        v_cliente.id,v_banco,coalesce(v_cliente.nomerazaosocial,'Cliente OS'),coalesce(v_cliente.cpfcnpj,'00000000000'),v_os.id,false)
      RETURNING id INTO v_transacao;
      UPDATE public.pagamento SET transacao_os_id=v_transacao WHERE id=p_pagamento_id;
      INSERT INTO public.pagamento_evento(pagamentoid,tipo,payload)
        VALUES(p_pagamento_id,'TRANSACAO_RECEITA_CRIADA',jsonb_build_object('transacao_id',v_transacao,'ordemservicoid',v_os_id));
      PERFORM public.recalcular_status_financeiro_os(v_os_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- O recebimento externo continua confirmado. O lançamento inteiro é
    -- revertido e a pendência fica visível e disponível para nova conciliação.
    GET STACKED DIAGNOSTICS v_erro=MESSAGE_TEXT;
    UPDATE public.pagamento SET financeiro_pendente=true,financeiro_erro=v_erro WHERE id=p_pagamento_id;
    IF v_pagamento.financeiro_erro IS DISTINCT FROM v_erro THEN
      INSERT INTO public.pagamento_evento(pagamentoid,tipo,payload)
        VALUES(p_pagamento_id,'FINANCEIRO_PENDENTE',jsonb_build_object('motivo',v_erro));
    END IF;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.conciliar_financeiro_stone_os(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.conciliar_financeiro_stone_os(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.confirmar_pagamento_stone_os(
  p_pagamento_id bigint,p_status text,p_evento text,p_payload jsonb,p_registrar_receita boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_pagamento public.pagamento; v_os_id integer; v_ativo boolean; v_conciliar boolean;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(87009,1);
  SELECT ordemservicoid INTO v_os_id FROM public.pagamento WHERE id=p_pagamento_id;
  IF v_os_id IS NULL THEN RAISE EXCEPTION 'Pagamento de OS não encontrado.' USING ERRCODE='P0002'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('PAGO','ESTORNADO','RECUSADO') THEN
    RAISE EXCEPTION 'Status de pagamento inválido.' USING ERRCODE='P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(87001,v_os_id);
  PERFORM 1 FROM public.ordemservico WHERE id=v_os_id FOR UPDATE;
  SELECT * INTO v_pagamento FROM public.pagamento WHERE id=p_pagamento_id FOR UPDATE;
  -- Entregas atrasadas/repetidas não ressuscitam uma cobrança estornada.
  IF v_pagamento.status='ESTORNADO' AND p_status<>'ESTORNADO' THEN RETURN; END IF;
  IF v_pagamento.status='PAGO' AND p_status='RECUSADO' THEN RETURN; END IF;
  v_ativo := public.faturamento_os_habilitado();
  v_conciliar := v_pagamento.financeiro_pendente
    OR (p_status='ESTORNADO' AND v_pagamento.transacao_os_id IS NOT NULL)
    OR (p_status='PAGO' AND v_pagamento.status IS DISTINCT FROM 'PAGO' AND (v_ativo OR p_registrar_receita));
  UPDATE public.pagamento SET status=p_status,atualizado_em=now(),financeiro_pendente=v_conciliar,
    confirmado_em=CASE WHEN p_status='PAGO' THEN coalesce(confirmado_em,now()) ELSE confirmado_em END,
    nsu=coalesce(p_payload#>>'{data,transaction_id}',p_payload#>>'{data,id}',nsu),
    autorizacao=coalesce(p_payload#>>'{data,authorization_code}',autorizacao),
    bandeira=coalesce(p_payload#>>'{data,card,brand}',bandeira)
    WHERE id=p_pagamento_id;
  IF v_pagamento.status IS DISTINCT FROM p_status THEN
    INSERT INTO public.pagamento_evento(pagamentoid,tipo,payload)
      VALUES(p_pagamento_id,p_evento,coalesce(p_payload,'{}'));
  END IF;
  IF v_conciliar THEN
    PERFORM public.conciliar_financeiro_stone_os(p_pagamento_id);
  ELSIF p_status='PAGO' AND NOT v_ativo AND v_pagamento.status IS DISTINCT FROM 'PAGO' THEN
    -- Compatibilidade do webhook legado que apenas confirma a OS.
    UPDATE public.ordemservico SET status='CONCLUIDO' WHERE id=v_os_id AND status<>'CONCLUIDO';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.conciliar_stone_ao_liberar_os()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id bigint;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status='FATURAMENTO' OR (NEW.status='PAGAMENTO' AND NOT public.faturamento_os_habilitado()) THEN
    FOR v_id IN SELECT id FROM public.pagamento WHERE ordemservicoid=NEW.id AND financeiro_pendente ORDER BY id LOOP
      PERFORM public.conciliar_financeiro_stone_os(v_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_conciliar_stone_ao_liberar_os AFTER UPDATE OF status ON public.ordemservico
  FOR EACH ROW EXECUTE FUNCTION public.conciliar_stone_ao_liberar_os();

-- Inclui cobranças que já estavam em Pagamento quando o modo foi desligado.
CREATE OR REPLACE FUNCTION public.conciliar_stone_ao_desativar_fluxo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id bigint;
BEGIN
  IF OLD.habilitar_faturamento_os AND NOT NEW.habilitar_faturamento_os THEN
    FOR v_id IN SELECT p.id FROM public.pagamento p JOIN public.ordemservico o ON o.id=p.ordemservicoid
      WHERE p.financeiro_pendente AND NOT o.is_deleted AND o.status='PAGAMENTO' ORDER BY o.id,p.id LOOP
      PERFORM public.conciliar_financeiro_stone_os(v_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_conciliar_stone_ao_desativar_fluxo AFTER UPDATE OF habilitar_faturamento_os
  ON public.config_geral FOR EACH ROW EXECUTE FUNCTION public.conciliar_stone_ao_desativar_fluxo();
