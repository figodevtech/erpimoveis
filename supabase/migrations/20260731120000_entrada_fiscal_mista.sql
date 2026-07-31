-- Entrada fiscal mista: uma unica NF-e cujos itens sao divididos entre o estoque
-- de revenda (entrada) e o estoque de uso e consumo (usoconsumo_entrada).
--
-- O pagamento e lancado UMA UNICA VEZ e aponta para as duas entradas ao mesmo tempo
-- (transacao.entrada_id + transacao.usoconsumo_entrada_id), sem rateio.
--
-- Consequencia: uma das entradas nao pode ser cancelada isoladamente, senao o
-- pagamento da outra iria junto. Os guards abaixo bloqueiam o cancelamento parcial e
-- direcionam para cancelar_entrada_fiscal_mista, que cancela as duas de uma vez.

CREATE OR REPLACE FUNCTION public.registrar_entrada_fiscal_mista(
  p_entrada_produto jsonb,
  p_itens_produto jsonb,
  p_entrada_usoconsumo jsonb,
  p_itens_usoconsumo jsonb,
  p_transacoes jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res_produto jsonb;
  v_res_uso jsonb;
  v_entrada_id bigint;
  v_uso_entrada_id bigint;
  v_entrada_produto jsonb;
  v_documento_id bigint := nullif(p_entrada_produto->>'fiscal_dfe_documento_id','')::bigint;
  v_total numeric(14,2);
  v_total_fin numeric(14,2);
  v_tx jsonb;
  v_user uuid := nullif(p_entrada_produto->>'created_by','')::uuid;
BEGIN
  IF jsonb_typeof(p_itens_produto) <> 'array' OR jsonb_array_length(p_itens_produto) = 0
     OR jsonb_typeof(p_itens_usoconsumo) <> 'array' OR jsonb_array_length(p_itens_usoconsumo) = 0 THEN
    RAISE EXCEPTION 'A entrada mista exige ao menos um item de estoque e um item de uso e consumo.'
      USING ERRCODE = '22023';
  END IF;

  -- Sem valor_total_documento a entrada de estoque fecha pelo total dos seus proprios
  -- itens, e nao pelo total da NF-e (que inclui a parte de uso e consumo).
  v_entrada_produto := p_entrada_produto - 'valor_total_documento';

  -- As duas entradas sao gravadas sem transacoes: o pagamento e unico e vem depois.
  IF v_documento_id IS NOT NULL THEN
    SELECT public.registrar_entrada_comercial_apropriada(v_entrada_produto, p_itens_produto, '[]'::jsonb)
      INTO v_res_produto;
  ELSE
    SELECT public.registrar_entrada_confirmada(v_entrada_produto, p_itens_produto, '[]'::jsonb)
      INTO v_res_produto;
  END IF;
  v_entrada_id := (v_res_produto->>'entrada_id')::bigint;

  SELECT public.registrar_entrada_usoconsumo(p_entrada_usoconsumo, p_itens_usoconsumo, '[]'::jsonb)
    INTO v_res_uso;
  v_uso_entrada_id := (v_res_uso->>'entrada_id')::bigint;

  v_total := round(
    coalesce((v_res_produto->>'valor_total')::numeric, 0)
    + coalesce((v_res_uso->>'valor_total')::numeric, 0), 2);

  IF jsonb_typeof(p_transacoes) = 'array' AND jsonb_array_length(p_transacoes) > 0 THEN
    SELECT round(coalesce(sum((value->>'valor')::numeric), 0), 2)
      INTO v_total_fin
      FROM jsonb_array_elements(p_transacoes);
    IF v_total_fin <> v_total THEN
      RAISE EXCEPTION 'A soma dos lancamentos financeiros (%) difere do total da nota (%).',
        v_total_fin, v_total USING ERRCODE = '22023';
    END IF;

    FOR v_tx IN SELECT value FROM jsonb_array_elements(p_transacoes) LOOP
      IF coalesce(nullif(v_tx->>'valor','')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'O valor do lancamento financeiro deve ser positivo.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.transacao(
        descricao, valor, "valorLiquido", data, vencimento_em, metodopagamento, categoria, categoria_id,
        tipo, cliente_id, banco_id, nomepagador, cpfcnpjpagador, pendente, plano_de_conta_id,
        plano_de_conta, centro_custo_id, centro_custo, entrada_id, usoconsumo_entrada_id, origem, created_by
      ) VALUES (
        coalesce(nullif(v_tx->>'descricao',''), 'Compra de mercadorias'),
        (v_tx->>'valor')::numeric,
        (v_tx->>'valor')::numeric,
        coalesce(nullif(v_tx->>'data','')::timestamptz, now()),
        nullif(v_tx->>'vencimento_em','')::timestamptz,
        nullif(v_tx->>'metodopagamento','')::public.metodo_pagamento,
        coalesce(nullif(v_tx->>'categoria',''), 'NAO RELACIONADO'),
        nullif(v_tx->>'categoria_id','')::integer,
        'DESPESA'::public.tipos_transacao,
        NULL,
        nullif(v_tx->>'banco_id','')::bigint,
        coalesce(nullif(v_tx->>'nomepagador',''), 'Fornecedor'),
        coalesce(nullif(regexp_replace(v_tx->>'cpfcnpjpagador','\D','','g'),''), 'NAO INFORMADO'),
        coalesce((v_tx->>'pendente')::boolean, false),
        nullif(v_tx->>'plano_de_conta_id','')::integer,
        nullif(v_tx->>'plano_de_conta',''),
        nullif(v_tx->>'centro_custo_id','')::integer,
        nullif(v_tx->>'centro_custo',''),
        v_entrada_id,
        v_uso_entrada_id,
        'ENTRADA_FISCAL_MISTA',
        v_user
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'entrada_id', v_entrada_id,
    'usoconsumo_entrada_id', v_uso_entrada_id,
    'valor_total', v_total
  );
END $function$;

CREATE OR REPLACE FUNCTION public.cancelar_entrada_fiscal_mista(
  p_entrada_id bigint,
  p_usoconsumo_entrada_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc_produto bigint;
  v_doc_uso bigint;
BEGIN
  SELECT fiscal_dfe_documento_id INTO v_doc_produto FROM public.entrada WHERE id = p_entrada_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrada de estoque nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT documento_fiscal_recebido_id INTO v_doc_uso FROM public.usoconsumo_entrada WHERE id = p_usoconsumo_entrada_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrada de uso e consumo nao encontrada.' USING ERRCODE = 'P0002'; END IF;

  IF v_doc_produto IS NULL OR v_doc_uso IS NULL OR v_doc_produto <> v_doc_uso THEN
    RAISE EXCEPTION 'As entradas informadas nao pertencem a mesma NF-e.' USING ERRCODE = '22023';
  END IF;

  -- Libera os guards de cancelamento parcial apenas dentro desta transacao.
  PERFORM set_config('app.entrada_mista_cancelamento', 'permitido', true);

  -- Uso e consumo primeiro: e o lado que remove o pagamento pendente compartilhado,
  -- de modo que o cancelamento do estoque nao tente trata-lo uma segunda vez.
  PERFORM public.cancelar_entrada_usoconsumo(p_usoconsumo_entrada_id, p_motivo, p_cancelada_by);
  PERFORM public.cancelar_entrada_confirmada(p_entrada_id, p_motivo, p_cancelada_by);

  RETURN jsonb_build_object(
    'entrada_id', p_entrada_id,
    'usoconsumo_entrada_id', p_usoconsumo_entrada_id,
    'status', 'CANCELADA'
  );
END $function$;

CREATE OR REPLACE FUNCTION public.cancelar_entrada_confirmada(p_entrada_id bigint, p_motivo text, p_cancelada_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Pagamento compartilhado com uma entrada de uso e consumo ainda ativa: a NF-e
  -- mista so pode ser cancelada como um todo, via cancelar_entrada_fiscal_mista.
  IF coalesce(current_setting('app.entrada_mista_cancelamento', true), '') <> 'permitido'
     AND EXISTS(
       SELECT 1 FROM public.transacao t
       JOIN public.usoconsumo_entrada ue ON ue.id = t.usoconsumo_entrada_id
       WHERE t.entrada_id = p_entrada_id
         AND NOT t.is_deleted
         AND t.estorno_transacao_id IS NULL
         AND ue.cancelada_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Esta entrada divide o pagamento da NF-e com uma entrada de uso e consumo ainda ativa. Cancele a nota inteira.'
      USING ERRCODE = '23514';
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
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_entrada_usoconsumo(p_entrada_id bigint, p_motivo text, p_cancelada_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Pagamento compartilhado com uma entrada de estoque ainda ativa: a NF-e mista
  -- so pode ser cancelada como um todo, via cancelar_entrada_fiscal_mista.
  IF coalesce(current_setting('app.entrada_mista_cancelamento', true), '') <> 'permitido'
     AND EXISTS(
       SELECT 1 FROM public.transacao t
       JOIN public.entrada e ON e.id = t.entrada_id
       WHERE t.usoconsumo_entrada_id = p_entrada_id
         AND NOT t.is_deleted
         AND t.estorno_transacao_id IS NULL
         AND e.cancelada_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Esta entrada divide o pagamento da NF-e com uma entrada de estoque ainda ativa. Cancele a nota inteira.'
      USING ERRCODE = '23514';
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
END $function$;
