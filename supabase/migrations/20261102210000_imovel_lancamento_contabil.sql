-- Lançamento contábil do imóvel: despesa paga com o dinheiro do proprietário ou repasse a ele.
--
-- Registrar é só contábil: o lançamento entra no extrato do proprietário na hora (abate o
-- saldo a repassar) e nenhuma transação é criada. Quem leva o lançamento ao financeiro é o
-- diálogo de transação (a pagar ou já pago); a transação criada fica ligada aqui por
-- transacao_id, nasce como recurso de terceiros (fora da DRE da imobiliária) e não carrega
-- imovel_id, para os gatilhos de transacao não lançarem o mesmo valor no extrato outra vez.
BEGIN;

CREATE TABLE IF NOT EXISTS public.imovel_lancamento (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  imovel_id bigint NOT NULL REFERENCES public.imovel(id),
  proprietario_id bigint NOT NULL REFERENCES public.proprietario(id),
  natureza text NOT NULL CHECK (natureza IN ('DESPESA_PROPRIETARIO', 'REPASSE')),
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  data date NOT NULL,
  competencia_em date NOT NULL,
  descricao text NOT NULL CHECK (char_length(btrim(descricao)) BETWEEN 1 AND 500),
  transacao_id bigint UNIQUE REFERENCES public.transacao(id) ON DELETE SET NULL,
  cancelado_em timestamptz,
  cancelado_por uuid REFERENCES public.usuario(id),
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.usuario(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imovel_lancamento_extrato_idx ON public.imovel_lancamento (proprietario_id, imovel_id, data DESC);

ALTER TABLE public.imovel_lancamento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.imovel_lancamento FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.imovel_lancamento TO service_role;
REVOKE ALL ON SEQUENCE public.imovel_lancamento_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.imovel_lancamento_id_seq TO service_role;

-- O movimento do extrato passa a poder vir de um lançamento contábil, não só de uma transação.
ALTER TABLE public.imovel_movimento ADD COLUMN IF NOT EXISTS lancamento_id bigint REFERENCES public.imovel_lancamento(id);
ALTER TABLE public.imovel_movimento ALTER COLUMN transacao_chave DROP NOT NULL;
ALTER TABLE public.imovel_movimento DROP CONSTRAINT IF EXISTS imovel_movimento_origem_check;
ALTER TABLE public.imovel_movimento ADD CONSTRAINT imovel_movimento_origem_check CHECK (transacao_chave IS NOT NULL OR lancamento_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS imovel_movimento_lancamento_idx ON public.imovel_movimento (lancamento_id) WHERE lancamento_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.imob_registrar_lancamento(p_payload jsonb, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid;
  v_prop bigint := (p_payload->>'proprietario_id')::bigint;
  v_imovel bigint := (p_payload->>'imovel_id')::bigint;
  v_valor numeric(14,2) := round((p_payload->>'valor')::numeric, 2);
  v_tipo text := upper(coalesce(p_payload->>'tipo', p_payload->>'natureza', ''));
  v_natureza text := CASE WHEN v_tipo IN ('DESPESA', 'DESPESA_PROPRIETARIO') THEN 'DESPESA_PROPRIETARIO' WHEN v_tipo = 'REPASSE' THEN 'REPASSE' END;
  v_data date := coalesce((p_payload->>'data')::date, current_date);
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_descricao text := nullif(btrim(p_payload->>'descricao'), '');
  v_saldo numeric;
  v_pendente numeric;
  l public.imovel_lancamento%ROWTYPE;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE = '42501'; END IF;
  IF v_natureza IS NULL THEN RAISE EXCEPTION 'Tipo de lançamento inválido.' USING ERRCODE = '22023'; END IF;
  IF v_key IS NULL OR v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe valor positivo e chave de idempotência.' USING ERRCODE = '22023'; END IF;
  IF v_descricao IS NULL THEN RAISE EXCEPTION 'Informe a descrição do lançamento.' USING ERRCODE = '22023'; END IF;

  -- Trava o proprietário: dois repasses ao mesmo tempo não podem gastar o mesmo saldo.
  PERFORM 1 FROM public.proprietario WHERE id = v_prop AND ativo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proprietário inexistente ou inativo.'; END IF;

  SELECT * INTO l FROM public.imovel_lancamento WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF l.imovel_id <> v_imovel OR l.proprietario_id <> v_prop OR l.valor <> v_valor OR l.natureza <> v_natureza THEN
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

  IF v_natureza = 'REPASSE' THEN
    SELECT coalesce(sum(CASE WHEN tipo = 'BRUTO_RECEBIDO' THEN valor ELSE -valor END), 0) INTO v_saldo
      FROM public.imovel_movimento WHERE proprietario_id = v_prop AND imovel_id = v_imovel;
    -- Repasses antigos, criados direto como transação em aberto, ainda comprometem o saldo.
    SELECT coalesce(sum(greatest(coalesce(nullif("valorLiquido", 0), valor) - valor_baixado, 0)), 0) INTO v_pendente
      FROM public.transacao WHERE proprietario_id = v_prop AND imovel_id = v_imovel AND imovel_natureza = 'REPASSE'
        AND pendente AND NOT is_deleted AND baixa_de_transacao_id IS NULL;
    IF v_valor > v_saldo - v_pendente THEN
      RAISE EXCEPTION 'Repasse excede o saldo disponível do proprietário.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.imovel_lancamento (imovel_id, proprietario_id, natureza, valor, data, competencia_em, descricao, idempotency_key, created_by)
  VALUES (v_imovel, v_prop, v_natureza, v_valor, v_data, date_trunc('month', v_data)::date, v_descricao, v_key, v_actor)
  RETURNING * INTO l;

  INSERT INTO public.imovel_movimento (imovel_id, proprietario_id, lancamento_id, transacao_chave, tipo, valor, competencia_em, data_movimento, descricao, chave_unica, created_by, auth_actor_id)
  VALUES (v_imovel, v_prop, l.id, NULL, v_natureza, v_valor, l.competencia_em, (v_data + time '12:00') AT TIME ZONE 'America/Fortaleza', v_descricao,
    'LANCAMENTO:' || l.id, v_actor, public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id', true)));

  RETURN to_jsonb(l);
END $$;

-- Estorno do lançamento contábil: só enquanto ele não está no financeiro.
CREATE OR REPLACE FUNCTION public.imob_cancelar_lancamento(p_id bigint, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid;
  l public.imovel_lancamento%ROWTYPE;
BEGIN
  v_actor := public.imob_definir_ator(p_actor);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Ação exclusiva ERP.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.imovel_lancamento WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF l.cancelado_em IS NOT NULL THEN RETURN to_jsonb(l); END IF;
  IF l.transacao_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.transacao WHERE id = l.transacao_id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Este lançamento já está no financeiro (transação #%). Exclua a transação antes de estornar.', l.transacao_id USING ERRCODE = '22023';
  END IF;

  UPDATE public.imovel_lancamento SET cancelado_em = now(), cancelado_por = v_actor WHERE id = l.id RETURNING * INTO l;
  INSERT INTO public.imovel_movimento (imovel_id, proprietario_id, lancamento_id, transacao_chave, tipo, valor, competencia_em, data_movimento, descricao, chave_unica, created_by, auth_actor_id)
  VALUES (l.imovel_id, l.proprietario_id, l.id, NULL, l.natureza, -l.valor, l.competencia_em, clock_timestamp(), 'Estorno: ' || l.descricao,
    'LANCAMENTO:' || l.id || ':ESTORNO', v_actor, public.auditoria_try_uuid(current_setting('app.imob_auth_actor_id', true)));
  RETURN to_jsonb(l);
END $$;

-- Liga a transação criada pelo diálogo ao lançamento. Uma transação viva por lançamento;
-- excluída a transação, o lançamento volta a poder ser lançado.
CREATE OR REPLACE FUNCTION public.imob_vincular_lancamento(p_lancamento_id bigint, p_transacao_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  l public.imovel_lancamento%ROWTYPE;
  t public.transacao%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.imovel_lancamento WHERE id = p_lancamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF l.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Este lançamento foi estornado.' USING ERRCODE = '22023'; END IF;
  IF l.transacao_id IS NOT NULL AND l.transacao_id <> p_transacao_id
     AND EXISTS (SELECT 1 FROM public.transacao WHERE id = l.transacao_id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Este lançamento já está no financeiro (transação #%).', l.transacao_id USING ERRCODE = '23505';
  END IF;
  SELECT * INTO t FROM public.transacao WHERE id = p_transacao_id;
  IF NOT FOUND OR t.is_deleted THEN RAISE EXCEPTION 'Transação não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF t.tipo::text <> 'DESPESA' OR t.imovel_id IS NOT NULL OR round(t.valor, 2) <> l.valor THEN
    RAISE EXCEPTION 'A transação não corresponde ao lançamento contábil.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.imovel_lancamento SET transacao_id = p_transacao_id WHERE id = l.id RETURNING * INTO l;
  RETURN to_jsonb(l);
END $$;

REVOKE ALL ON FUNCTION public.imob_registrar_lancamento(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_registrar_lancamento(jsonb, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.imob_cancelar_lancamento(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_cancelar_lancamento(bigint, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.imob_vincular_lancamento(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imob_vincular_lancamento(bigint, bigint) TO service_role;

COMMIT;
