-- Cancelamento de movimentacoes com motivo obrigatorio.
--
-- Antes desta migracao:
--   * entrada            -> cancelamento existia, sem motivo e sem cancelada_by
--   * usoconsumo_entrada -> cancelamento existia, sem motivo
--   * usoconsumo_saida   -> cancelamento existia, sem motivo
--   * estoque_saida      -> NAO era possivel cancelar (sem RPC, sem rota, sem colunas)
--
-- As tres RPCs existentes precisam de DROP + CREATE: adicionar um parametro com
-- DEFAULT criaria uma sobrecarga, e a chamada antiga (sem motivo) passaria a ser
-- ambigua no Postgres — alem de permitir burlar a exigencia do motivo.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Colunas de cancelamento
-- ---------------------------------------------------------------------------
ALTER TABLE public.entrada
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
  ADD COLUMN IF NOT EXISTS cancelada_by uuid;

ALTER TABLE public.estoque_saida
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
  ADD COLUMN IF NOT EXISTS cancelada_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cancelada_by uuid;

ALTER TABLE public.usoconsumo_entrada
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text;

ALTER TABLE public.usoconsumo_saida
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text;

-- Movimentos cancelados antes desta migracao nao tem motivo registrado. A coluna
-- e nova (NULL em todas as linhas), entao preencher aqui nao sobrescreve dado
-- algum — apenas rotula explicitamente o que nao foi informado na epoca.
UPDATE public.entrada
  SET motivo_cancelamento = 'Não informado (cancelamento anterior à exigência de motivo)'
  WHERE status = 'CANCELADA'::public.enum_status_entrada AND motivo_cancelamento IS NULL;
UPDATE public.estoque_saida
  SET motivo_cancelamento = 'Não informado (cancelamento anterior à exigência de motivo)'
  WHERE status = 'CANCELADA' AND motivo_cancelamento IS NULL;
UPDATE public.usoconsumo_entrada
  SET motivo_cancelamento = 'Não informado (cancelamento anterior à exigência de motivo)'
  WHERE status = 'CANCELADA' AND motivo_cancelamento IS NULL;
UPDATE public.usoconsumo_saida
  SET motivo_cancelamento = 'Não informado (cancelamento anterior à exigência de motivo)'
  WHERE status = 'CANCELADA' AND motivo_cancelamento IS NULL;

-- Garantia no nivel do banco: cancelado exige motivo.
ALTER TABLE public.entrada DROP CONSTRAINT IF EXISTS entrada_motivo_cancelamento_check;
ALTER TABLE public.entrada ADD CONSTRAINT entrada_motivo_cancelamento_check CHECK (
  status <> 'CANCELADA'::public.enum_status_entrada
  OR nullif(btrim(motivo_cancelamento), '') IS NOT NULL
);

ALTER TABLE public.estoque_saida DROP CONSTRAINT IF EXISTS estoque_saida_motivo_cancelamento_check;
ALTER TABLE public.estoque_saida ADD CONSTRAINT estoque_saida_motivo_cancelamento_check CHECK (
  status <> 'CANCELADA' OR nullif(btrim(motivo_cancelamento), '') IS NOT NULL
);

ALTER TABLE public.usoconsumo_entrada DROP CONSTRAINT IF EXISTS usoconsumo_entrada_motivo_cancelamento_check;
ALTER TABLE public.usoconsumo_entrada ADD CONSTRAINT usoconsumo_entrada_motivo_cancelamento_check CHECK (
  status <> 'CANCELADA' OR nullif(btrim(motivo_cancelamento), '') IS NOT NULL
);

ALTER TABLE public.usoconsumo_saida DROP CONSTRAINT IF EXISTS usoconsumo_saida_motivo_cancelamento_check;
ALTER TABLE public.usoconsumo_saida ADD CONSTRAINT usoconsumo_saida_motivo_cancelamento_check CHECK (
  status <> 'CANCELADA' OR nullif(btrim(motivo_cancelamento), '') IS NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2) Entrada de produto: cancelamento passa a exigir motivo e registrar autor
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancelar_entrada_confirmada(bigint);

CREATE FUNCTION public.cancelar_entrada_confirmada(
  p_entrada_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entrada public.entrada%ROWTYPE;
  v_item record;
  v_estoque integer;
  v_ultimo_custo numeric;
  v_transacao public.transacao%ROWTYPE;
  v_tipo_estorno public.tipos_transacao;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_entrada FROM public.entrada WHERE id = p_entrada_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrada não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_entrada.status = 'CANCELADA'::public.enum_status_entrada THEN
    RAISE EXCEPTION 'Esta entrada já está cancelada.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT * FROM public.entradaitens WHERE entrada_id = p_entrada_id ORDER BY id FOR UPDATE
  LOOP
    SELECT estoque INTO v_estoque FROM public.produto WHERE id = v_item.produto_id FOR UPDATE;
    IF coalesce(v_estoque, 0) < v_item.quantidade THEN
      RAISE EXCEPTION 'Não há saldo suficiente do produto % para cancelar a entrada.', v_item.produto_id
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.produto
    SET estoque = estoque - v_item.quantidade::integer, updatedat = now()
    WHERE id = v_item.produto_id;

    INSERT INTO public.estoque_movimento_entrada (
      entrada_id, entrada_item_id, produto_id, tipo, quantidade,
      saldo_anterior, saldo_resultante, valor_unitario_compra
    ) VALUES (
      p_entrada_id, v_item.id, v_item.produto_id, 'CANCELAMENTO', v_item.quantidade::integer,
      v_estoque, v_estoque - v_item.quantidade::integer, v_item.valor_unitario_compra
    );

    SELECT ei.valor_unitario_compra INTO v_ultimo_custo
    FROM public.entradaitens ei
    JOIN public.entrada e ON e.id = ei.entrada_id
    WHERE ei.produto_id = v_item.produto_id
      AND e.id <> p_entrada_id
      AND e.status = 'CONFIRMADA'::public.enum_status_entrada
    ORDER BY e.created_at DESC, e.id DESC, ei.id DESC LIMIT 1;

    UPDATE public.produto
    SET ultimovalordecompra = v_ultimo_custo
    WHERE id = v_item.produto_id;
  END LOOP;

  FOR v_transacao IN
    SELECT * FROM public.transacao
    WHERE entrada_id = p_entrada_id AND NOT is_deleted AND estorno_transacao_id IS NULL
    FOR UPDATE
  LOOP
    IF v_transacao.pendente THEN
      UPDATE public.transacao
      SET pendente = false, is_deleted = true, deleted_at = now(), updated_at = now()
      WHERE id = v_transacao.id;
    ELSE
      v_tipo_estorno := CASE v_transacao.tipo
        WHEN 'DESPESA'::public.tipos_transacao THEN 'RECEITA'::public.tipos_transacao
        WHEN 'RECEITA'::public.tipos_transacao THEN 'DESPESA'::public.tipos_transacao
        WHEN 'DEPOSITO'::public.tipos_transacao THEN 'SAQUE'::public.tipos_transacao
        ELSE 'DEPOSITO'::public.tipos_transacao
      END;
      INSERT INTO public.transacao (
        descricao, valor, "valorLiquido", data, metodopagamento, categoria, categoria_id,
        tipo, cliente_id, banco_id, nomepagador, cpfcnpjpagador, pendente,
        plano_de_conta_id, plano_de_conta, centro_custo_id, centro_custo,
        entrada_id, estorno_transacao_id
      ) VALUES (
        'Estorno: ' || v_transacao.descricao, v_transacao.valor, v_transacao."valorLiquido", now(),
        v_transacao.metodopagamento, v_transacao.categoria, v_transacao.categoria_id,
        v_tipo_estorno, v_transacao.cliente_id, v_transacao.banco_id,
        v_transacao.nomepagador, v_transacao.cpfcnpjpagador, false,
        v_transacao.plano_de_conta_id, v_transacao.plano_de_conta,
        v_transacao.centro_custo_id, v_transacao.centro_custo,
        p_entrada_id, v_transacao.id
      );
    END IF;
  END LOOP;

  UPDATE public.entrada
  SET status = 'CANCELADA'::public.enum_status_entrada,
      cancelada_at = now(),
      cancelada_by = p_cancelada_by,
      motivo_cancelamento = v_motivo
  WHERE id = p_entrada_id;

  RETURN jsonb_build_object('entrada_id', p_entrada_id, 'status', 'CANCELADA');
END;
$$;

ALTER FUNCTION public.cancelar_entrada_confirmada(bigint, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancelar_entrada_confirmada(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_entrada_confirmada(bigint, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Saida de estoque (produto): cancelamento passa a existir
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_saida_estoque(
  p_saida_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saida public.estoque_saida%ROWTYPE;
  v_linha record;
  v_estoque integer;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_saida FROM public.estoque_saida WHERE id = p_saida_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saída não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_saida.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'Esta saída já está cancelada.' USING ERRCODE = '22023';
  END IF;

  -- Cancelar uma saida devolve a quantidade ao estoque.
  FOR v_linha IN
    SELECT * FROM public.estoque_saida_item WHERE saida_id = p_saida_id ORDER BY id FOR UPDATE
  LOOP
    SELECT estoque INTO v_estoque FROM public.produto WHERE id = v_linha.produto_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_linha.produto_id USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.produto
    SET estoque = coalesce(estoque, 0) + v_linha.quantidade,
        updatedat = now()
    WHERE id = v_linha.produto_id;
  END LOOP;

  UPDATE public.estoque_saida
  SET status = 'CANCELADA',
      cancelada_at = now(),
      cancelada_by = p_cancelada_by,
      motivo_cancelamento = v_motivo
  WHERE id = p_saida_id;

  RETURN jsonb_build_object('saida_id', p_saida_id, 'status', 'CANCELADA');
END;
$$;

ALTER FUNCTION public.cancelar_saida_estoque(bigint, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancelar_saida_estoque(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_saida_estoque(bigint, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Uso/consumo: entrada e saida passam a exigir motivo
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancelar_entrada_usoconsumo(bigint, uuid);

CREATE FUNCTION public.cancelar_entrada_usoconsumo(
  p_entrada_id bigint, p_motivo text, p_cancelada_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_entrada public.usoconsumo_entrada%ROWTYPE; v_linha record; v_saldo integer; v_ultimo_custo numeric;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_entrada FROM public.usoconsumo_entrada WHERE id=p_entrada_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrada nao encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_entrada.status='CANCELADA' THEN RAISE EXCEPTION 'Entrada ja cancelada.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.transacao WHERE usoconsumo_entrada_id=p_entrada_id AND NOT pendente AND NOT is_deleted AND estorno_transacao_id IS NULL) THEN
    RAISE EXCEPTION 'Existem pagamentos liquidados. Estorne-os antes de cancelar a entrada.' USING ERRCODE='23514';
  END IF;
  FOR v_linha IN SELECT * FROM public.usoconsumo_entrada_item WHERE entrada_id=p_entrada_id ORDER BY id FOR UPDATE LOOP
    SELECT estoque INTO v_saldo FROM public.usoconsumo_item WHERE id=v_linha.item_id FOR UPDATE;
    IF v_saldo<v_linha.quantidade THEN
      RAISE EXCEPTION 'Saldo insuficiente para cancelar a entrada do item %.',v_linha.item_id USING ERRCODE='23514';
    END IF;
    PERFORM set_config('app.usoconsumo_movimento','permitido',true);
    UPDATE public.usoconsumo_item SET estoque=estoque-v_linha.quantidade,updated_by=p_cancelada_by WHERE id=v_linha.item_id;
    INSERT INTO public.usoconsumo_movimento_entrada(
      entrada_id,entrada_item_id,item_id,tipo,quantidade,saldo_anterior,saldo_resultante,valor_unitario_compra,created_by
    ) VALUES(p_entrada_id,v_linha.id,v_linha.item_id,'CANCELAMENTO',v_linha.quantidade,v_saldo,
      v_saldo-v_linha.quantidade,v_linha.valor_unitario_compra,p_cancelada_by);
    SELECT ei.valor_unitario_compra INTO v_ultimo_custo
      FROM public.usoconsumo_entrada_item ei JOIN public.usoconsumo_entrada e ON e.id=ei.entrada_id
      WHERE ei.item_id=v_linha.item_id AND e.id<>p_entrada_id AND e.status='CONFIRMADA'
      ORDER BY e.created_at DESC,e.id DESC,ei.id DESC LIMIT 1;
    UPDATE public.usoconsumo_item SET ultimovalordecompra=v_ultimo_custo WHERE id=v_linha.item_id;
  END LOOP;
  UPDATE public.transacao SET is_deleted=true,deleted_at=now(),deleted_by=p_cancelada_by,updated_at=now()
    WHERE usoconsumo_entrada_id=p_entrada_id AND pendente AND NOT is_deleted;
  UPDATE public.fiscal_dfe_item_apropriacao SET cancelada_at=now()
    WHERE usoconsumo_entrada_id=p_entrada_id AND cancelada_at IS NULL;
  UPDATE public.usoconsumo_entrada
    SET status='CANCELADA',cancelada_at=now(),cancelada_by=p_cancelada_by,motivo_cancelamento=v_motivo
    WHERE id=p_entrada_id;
  RETURN jsonb_build_object('entrada_id',p_entrada_id,'status','CANCELADA');
END $$;

ALTER FUNCTION public.cancelar_entrada_usoconsumo(bigint, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancelar_entrada_usoconsumo(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_entrada_usoconsumo(bigint, text, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.cancelar_saida_usoconsumo(bigint, uuid);

CREATE FUNCTION public.cancelar_saida_usoconsumo(
  p_saida_id bigint, p_motivo text, p_cancelada_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_saida public.usoconsumo_saida%ROWTYPE; v_linha record;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_saida FROM public.usoconsumo_saida WHERE id=p_saida_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saida nao encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_saida.status='CANCELADA' THEN RAISE EXCEPTION 'Saida ja cancelada.' USING ERRCODE='22023'; END IF;
  FOR v_linha IN SELECT * FROM public.usoconsumo_saida_item WHERE saida_id=p_saida_id ORDER BY id FOR UPDATE LOOP
    PERFORM 1 FROM public.usoconsumo_item WHERE id=v_linha.item_id FOR UPDATE;
    PERFORM set_config('app.usoconsumo_movimento','permitido',true);
    UPDATE public.usoconsumo_item SET estoque=estoque+v_linha.quantidade,updated_by=p_cancelada_by WHERE id=v_linha.item_id;
  END LOOP;
  UPDATE public.usoconsumo_saida
    SET status='CANCELADA',cancelada_at=now(),cancelada_by=p_cancelada_by,motivo_cancelamento=v_motivo
    WHERE id=p_saida_id;
  RETURN jsonb_build_object('saida_id',p_saida_id,'status','CANCELADA');
END $$;

ALTER FUNCTION public.cancelar_saida_usoconsumo(bigint, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancelar_saida_usoconsumo(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_saida_usoconsumo(bigint, text, uuid) TO service_role;

COMMIT;
