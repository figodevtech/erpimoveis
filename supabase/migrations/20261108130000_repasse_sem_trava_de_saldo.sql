-- Repasse ao proprietário sem trava de saldo.
--
-- O repasse é um lançamento contábil como os demais eventos da reserva: registra-se quando a
-- imobiliária decide, e depois vai ao financeiro. Pode ser antes de o hóspede pagar, com o
-- recebimento em aberto, sem baixa ou nem lançado; o extrato do proprietário fica negativo até
-- o recebimento entrar, e isso é esperado.
--
-- Antes, duas travas recusavam o repasse acima do bruto recebido:
-- 1. imob_registrar_lancamento, ao registrar o repasse (o caminho da aba Eventos financeiros);
-- 2. imob_preparar_transacao, ao dar baixa em repasse antigo criado direto como transação do
--    imóvel. Sai também, para a regra ser a mesma em qualquer caminho.
-- O resto das duas funções fica exatamente como estava (20261108120000 e 20261029173114).
BEGIN;

CREATE OR REPLACE FUNCTION public.imob_registrar_lancamento(p_payload jsonb, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid;
  v_prop bigint := (p_payload->>'proprietario_id')::bigint;
  v_imovel bigint := (p_payload->>'imovel_id')::bigint;
  v_reserva bigint := nullif(p_payload->>'reserva_id', '')::bigint;
  v_valor numeric(14,2) := round((p_payload->>'valor')::numeric, 2);
  v_tipo text := upper(coalesce(p_payload->>'tipo', p_payload->>'natureza', ''));
  v_natureza text := CASE WHEN v_tipo IN ('DESPESA', 'DESPESA_PROPRIETARIO') THEN 'DESPESA_PROPRIETARIO' WHEN v_tipo = 'REPASSE' THEN 'REPASSE' END;
  v_data date := coalesce((p_payload->>'data')::date, current_date);
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_descricao text := nullif(btrim(p_payload->>'descricao'), '');
  l public.imovel_lancamento%ROWTYPE;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE = '42501'; END IF;
  IF v_natureza IS NULL THEN RAISE EXCEPTION 'Tipo de lançamento inválido.' USING ERRCODE = '22023'; END IF;
  IF v_key IS NULL OR v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe valor positivo e chave de idempotência.' USING ERRCODE = '22023'; END IF;
  IF v_descricao IS NULL THEN RAISE EXCEPTION 'Informe a descrição do lançamento.' USING ERRCODE = '22023'; END IF;

  -- Serializa os lançamentos do mesmo proprietário (idempotência e ordem do extrato).
  PERFORM 1 FROM public.proprietario WHERE id = v_prop AND ativo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proprietário inexistente ou inativo.'; END IF;

  SELECT * INTO l FROM public.imovel_lancamento WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF l.imovel_id <> v_imovel OR l.proprietario_id <> v_prop OR l.valor <> v_valor OR l.natureza <> v_natureza
       OR l.reserva_id IS DISTINCT FROM v_reserva THEN
      RAISE EXCEPTION 'Chave de idempotência reutilizada com outros dados.' USING ERRCODE = '23505';
    END IF;
    RETURN to_jsonb(l);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.imovel WHERE id = v_imovel
      AND (proprietario_id = v_prop OR EXISTS (SELECT 1 FROM public.imovel_movimento WHERE imovel_id = v_imovel AND proprietario_id = v_prop))
  ) THEN
    RAISE EXCEPTION 'Imóvel não pertence ao proprietário informado.';
  END IF;

  IF v_reserva IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.reserva_imovel WHERE id = v_reserva AND imovel_id = v_imovel AND proprietario_id = v_prop
  ) THEN
    RAISE EXCEPTION 'A reserva não pertence a este imóvel e proprietário.' USING ERRCODE = '22023';
  END IF;

  -- Sem conferência de saldo: o repasse pode vir antes do recebimento e negativar o extrato.

  INSERT INTO public.imovel_lancamento (imovel_id, proprietario_id, reserva_id, natureza, valor, data, competencia_em, descricao, idempotency_key, created_by)
  VALUES (v_imovel, v_prop, v_reserva, v_natureza, v_valor, v_data, date_trunc('month', v_data)::date, v_descricao, v_key, v_actor)
  RETURNING * INTO l;

  INSERT INTO public.imovel_movimento (imovel_id, proprietario_id, lancamento_id, transacao_chave, tipo, valor, competencia_em, data_movimento, descricao, chave_unica, created_by, auth_actor_id)
  VALUES (v_imovel, v_prop, l.id, NULL, v_natureza, v_valor, l.competencia_em, (v_data + time '12:00') AT TIME ZONE 'America/Fortaleza', v_descricao,
    'LANCAMENTO:' || l.id, v_actor, public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id', true)));

  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_registrar_lancamento(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_registrar_lancamento(jsonb, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.imob_preparar_transacao() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p public.transacao%ROWTYPE;
BEGIN
 IF new.baixa_de_transacao_id IS NOT NULL THEN
  SELECT * INTO p FROM public.transacao WHERE id=new.baixa_de_transacao_id;
  IF p.imovel_id IS NOT NULL THEN
   new.imovel_id:=p.imovel_id; new.proprietario_id:=p.proprietario_id; new.reserva_imovel_id:=p.reserva_imovel_id;
   new.locacao_imovel_id:=p.locacao_imovel_id; new.venda_imovel_id:=p.venda_imovel_id;
   new.recurso_terceiros:=p.recurso_terceiros; new.imovel_percentual_admin:=p.imovel_percentual_admin;
   new.imovel_natureza:=p.imovel_natureza; new.imovel_competencia:=p.imovel_competencia;
  END IF;
 END IF;
 IF new.imovel_id IS NOT NULL AND (new.proprietario_id IS NULL OR new.imovel_natureza IS NULL) THEN RAISE EXCEPTION 'Transação imobiliária exige proprietário e natureza.'; END IF;
 IF new.imovel_natureza IN ('RECEBIMENTO','DESPESA_PROPRIETARIO','REPASSE','REEMBOLSO') AND NOT new.recurso_terceiros THEN RAISE EXCEPTION 'Recursos do proprietário devem ser segregados do resultado.'; END IF;
 IF TG_OP='UPDATE' AND old.imovel_id IS NOT NULL AND (new.imovel_id,new.proprietario_id,new.reserva_imovel_id,new.locacao_imovel_id,new.venda_imovel_id,new.imovel_percentual_admin,new.imovel_natureza,new.recurso_terceiros) IS DISTINCT FROM (old.imovel_id,old.proprietario_id,old.reserva_imovel_id,old.locacao_imovel_id,old.venda_imovel_id,old.imovel_percentual_admin,old.imovel_natureza,old.recurso_terceiros)
 AND (NOT old.pendente OR old.valor_baixado>0 OR EXISTS(SELECT 1 FROM public.imovel_movimento WHERE transacao_chave=old.id)) THEN RAISE EXCEPTION 'Vínculos e percentual de transação recebida são históricos e imutáveis.'; END IF;
 RETURN new;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
