-- Observacao livre na entrada de estoque e de uso/consumo.
--
-- A saida ja permitia descrever o movimento em texto livre; a entrada nao tinha
-- equivalente. As RPCs de registro passam a ler `observacao` do JSON de entrada.
-- Campo opcional: entradas antigas e chamadas que nao informam seguem funcionando.

ALTER TABLE public.entrada
  ADD COLUMN IF NOT EXISTS observacao text;

ALTER TABLE public.usoconsumo_entrada
  ADD COLUMN IF NOT EXISTS observacao text;

COMMENT ON COLUMN public.entrada.observacao IS
  'Texto livre informado por quem registrou a entrada.';
COMMENT ON COLUMN public.usoconsumo_entrada.observacao IS
  'Texto livre informado por quem registrou a entrada.';
CREATE OR REPLACE FUNCTION public.registrar_entrada_confirmada(p_entrada jsonb, p_itens jsonb, p_transacoes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entrada_id bigint;
  v_item jsonb;
  v_item_id bigint;
  v_produto public.produto%ROWTYPE;
  v_produto_id integer;
  v_quantidade integer;
  v_custo numeric(14,4);
  v_desconto numeric(14,2);
  v_frete numeric(14,2);
  v_outras numeric(14,2);
  v_total_item numeric(14,2);
  v_total numeric(14,2) := 0;
  v_total_documento numeric(14,2) := nullif(p_entrada->>'valor_total_documento', '')::numeric;
  v_total_financeiro numeric(14,2) := 0;
  v_transacao jsonb;
  v_chave text := nullif(regexp_replace(coalesce(p_entrada->>'notachave', ''), '\D', '', 'g'), '');
  v_fiscal boolean := coalesce((p_entrada->>'fiscal')::boolean, false);
  v_origem text := coalesce(nullif(p_entrada->>'origem', ''), 'MANUAL');
  v_created_by uuid := nullif(p_entrada->>'created_by', '')::uuid;
BEGIN
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item para a entrada.' USING ERRCODE = '22023';
  END IF;

  IF v_origem NOT IN ('AJUSTE_RAPIDO', 'MANUAL', 'NFE_TERCEIRO') THEN
    RAISE EXCEPTION 'Origem da entrada inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_total_documento IS NOT NULL AND v_total_documento < 0 THEN
    RAISE EXCEPTION 'O total do documento fiscal não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF v_fiscal AND (v_chave IS NULL OR length(v_chave) <> 44) THEN
    RAISE EXCEPTION 'A entrada fiscal exige uma chave de acesso com 44 dígitos.' USING ERRCODE = '22023';
  END IF;
  IF v_fiscal AND nullif(p_entrada->>'fornecedorid', '') IS NULL THEN
    RAISE EXCEPTION 'A entrada fiscal exige um fornecedor vinculado.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.entrada (
    fornecedorid, fiscal, notachave, tipo, status, origem,
    numero_nota, serie_nota, data_emissao, fiscal_dfe_documento_id, valor_total,
    created_by, observacao
  ) VALUES (
    nullif(p_entrada->>'fornecedorid', '')::integer,
    v_fiscal,
    v_chave,
    coalesce(nullif(p_entrada->>'tipo', ''), 'COMPRA_FORNECEDOR')::public.enum_tipos_entrada,
    'CONFIRMADA'::public.enum_status_entrada,
    v_origem,
    nullif(p_entrada->>'numero_nota', ''),
    nullif(p_entrada->>'serie_nota', ''),
    nullif(p_entrada->>'data_emissao', '')::timestamp with time zone,
    nullif(p_entrada->>'fiscal_dfe_documento_id', '')::bigint,
    0,
    v_created_by,
    nullif(btrim(coalesce(p_entrada->>'observacao', '')), '')
  ) RETURNING id INTO v_entrada_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    v_produto_id := nullif(v_item->>'produto_id', '')::integer;
    v_quantidade := nullif(v_item->>'quantidade', '')::integer;
    v_custo := nullif(v_item->>'valor_unitario_compra', '')::numeric;
    v_desconto := coalesce(nullif(v_item->>'valor_desconto', '')::numeric, 0);
    v_frete := coalesce(nullif(v_item->>'valor_frete', '')::numeric, 0);
    v_outras := coalesce(nullif(v_item->>'outras_despesas', '')::numeric, 0);

    IF v_produto_id IS NULL OR v_quantidade IS NULL OR v_quantidade <= 0 THEN
      RAISE EXCEPTION 'Produto e quantidade inteira positiva são obrigatórios.' USING ERRCODE = '22023';
    END IF;
    IF v_custo IS NULL OR v_custo < 0 OR v_desconto < 0 OR v_frete < 0 OR v_outras < 0 THEN
      RAISE EXCEPTION 'Os valores de compra do item são inválidos.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_produto FROM public.produto WHERE id = v_produto_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % não encontrado.', v_produto_id USING ERRCODE = 'P0002';
    END IF;

    v_total_item := round((v_quantidade * v_custo) - v_desconto + v_frete + v_outras, 2);
    IF v_total_item < 0 THEN
      RAISE EXCEPTION 'O total do item não pode ser negativo.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.entradaitens (
      entrada_id, produto_id, quantidade, precovenda, unidade,
      valor_unitario_compra, valor_desconto, valor_frete, outras_despesas, valor_total,
      ncm, cest, csosn, referencia, titulo, "cClassTrib", "cstIbs", "cstCbs",
      cst, aliquotaicms, cfop, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins
    ) VALUES (
      v_entrada_id, v_produto_id, v_quantidade, coalesce(v_produto.precovenda, 0),
      coalesce(nullif(v_item->>'unidade', '')::public.unidade_medida, v_produto.unidade, 'UN'),
      v_custo, v_desconto, v_frete, v_outras, v_total_item,
      coalesce(nullif(v_item->>'ncm', ''), v_produto.ncm),
      coalesce(nullif(v_item->>'cest', ''), v_produto.cest),
      coalesce(nullif(v_item->>'csosn', ''), v_produto.csosn),
      coalesce(nullif(v_item->>'referencia', ''), v_produto.referencia),
      coalesce(nullif(v_item->>'titulo', ''), v_produto.titulo),
      coalesce(nullif(v_item->>'cClassTrib', ''), v_produto."cClassTrib"),
      coalesce(nullif(v_item->>'cstIbs', ''), v_produto."cstIbs"),
      coalesce(nullif(v_item->>'cstCbs', ''), v_produto."cstCbs"),
      coalesce(nullif(v_item->>'cst', ''), v_produto.cst),
      coalesce(nullif(v_item->>'aliquotaicms', '')::numeric, v_produto.aliquotaicms),
      coalesce(nullif(v_item->>'cfop', ''), v_produto.cfop),
      coalesce(nullif(v_item->>'cst_pis', ''), v_produto.cst_pis),
      coalesce(nullif(v_item->>'aliquota_pis', '')::numeric, v_produto.aliquota_pis),
      coalesce(nullif(v_item->>'cst_cofins', ''), v_produto.cst_cofins),
      coalesce(nullif(v_item->>'aliquota_cofins', '')::numeric, v_produto.aliquota_cofins)
    ) RETURNING id INTO v_item_id;

    UPDATE public.produto
    SET estoque = coalesce(estoque, 0) + v_quantidade,
        ultimovalordecompra = v_custo,
        updatedat = now()
    WHERE id = v_produto_id;

    INSERT INTO public.estoque_movimento_entrada (
      entrada_id, entrada_item_id, produto_id, tipo, quantidade,
      saldo_anterior, saldo_resultante, valor_unitario_compra
    ) VALUES (
      v_entrada_id, v_item_id, v_produto_id, 'ENTRADA', v_quantidade,
      coalesce(v_produto.estoque, 0), coalesce(v_produto.estoque, 0) + v_quantidade, v_custo
    );

    v_total := v_total + v_total_item;
  END LOOP;

  UPDATE public.entrada
  SET valor_total = round(coalesce(v_total_documento, v_total), 2)
  WHERE id = v_entrada_id;

  IF p_transacoes IS NOT NULL AND jsonb_typeof(p_transacoes) = 'array'
     AND jsonb_array_length(p_transacoes) > 0 THEN
    SELECT round(coalesce(sum((value->>'valor')::numeric), 0), 2)
      INTO v_total_financeiro
    FROM jsonb_array_elements(p_transacoes);
    IF v_total_financeiro <> round(coalesce(v_total_documento, v_total), 2) THEN
      RAISE EXCEPTION 'A soma dos lançamentos financeiros (%) difere do total da entrada (%).',
        v_total_financeiro, round(coalesce(v_total_documento, v_total), 2) USING ERRCODE = '22023';
    END IF;

    FOR v_transacao IN SELECT value FROM jsonb_array_elements(p_transacoes)
    LOOP
      IF coalesce((v_transacao->>'valor')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION 'O valor do lançamento financeiro deve ser positivo.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.transacao (
        descricao, valor, "valorLiquido", data, metodopagamento, categoria, categoria_id,
        tipo, cliente_id, banco_id, nomepagador, cpfcnpjpagador, pendente,
        plano_de_conta_id, plano_de_conta, centro_custo_id, centro_custo, entrada_id
      ) VALUES (
        coalesce(nullif(v_transacao->>'descricao', ''), 'Compra de mercadorias'),
        (v_transacao->>'valor')::numeric,
        (v_transacao->>'valor')::numeric,
        coalesce(nullif(v_transacao->>'data', '')::timestamp with time zone, now()),
        nullif(v_transacao->>'metodopagamento', '')::public.metodo_pagamento,
        coalesce(nullif(v_transacao->>'categoria', ''), 'NÃO RELACIONADO'),
        nullif(v_transacao->>'categoria_id', '')::integer,
        'DESPESA'::public.tipos_transacao,
        NULL,
        nullif(v_transacao->>'banco_id', '')::bigint,
        coalesce(nullif(v_transacao->>'nomepagador', ''), 'Fornecedor'),
        coalesce(nullif(regexp_replace(v_transacao->>'cpfcnpjpagador', '\D', '', 'g'), ''), 'NÃO INFORMADO'),
        coalesce((v_transacao->>'pendente')::boolean, false),
        nullif(v_transacao->>'plano_de_conta_id', '')::integer,
        nullif(v_transacao->>'plano_de_conta', ''),
        nullif(v_transacao->>'centro_custo_id', '')::integer,
        nullif(v_transacao->>'centro_custo', ''),
        v_entrada_id
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'entrada_id', v_entrada_id,
    'valor_total', round(coalesce(v_total_documento, v_total), 2)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_entrada_usoconsumo(p_entrada jsonb, p_itens jsonb, p_transacoes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entrada_id bigint; v_item_json jsonb; v_item public.usoconsumo_item%ROWTYPE;
  v_entrada_item_id bigint; v_item_id integer; v_qtd integer; v_custo numeric(14,4);
  v_desc numeric(14,2); v_frete numeric(14,2); v_outras numeric(14,2); v_total_item numeric(14,2);
  v_total numeric(14,2):=0; v_total_fin numeric(14,2); v_tx jsonb; v_fiscal boolean;
  v_chave text; v_documento_id bigint; v_numero_item integer; v_user uuid;
BEGIN
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE='22023';
  END IF;
  v_fiscal:=coalesce((p_entrada->>'fiscal')::boolean,false);
  v_chave:=nullif(regexp_replace(coalesce(p_entrada->>'chave_nfe',''),'\D','','g'),'');
  v_documento_id:=nullif(p_entrada->>'documento_fiscal_recebido_id','')::bigint;
  v_user:=nullif(p_entrada->>'created_by','')::uuid;
  IF v_fiscal AND (v_chave IS NULL OR length(v_chave)<>44 OR nullif(p_entrada->>'fornecedor_id','') IS NULL) THEN
    RAISE EXCEPTION 'A entrada fiscal exige chave valida e fornecedor.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.usoconsumo_entrada(
    fornecedor_id,fiscal,chave_nfe,numero_nota,serie_nota,data_emissao,tipo,origem,documento_fiscal_recebido_id,created_by,observacao
  ) VALUES(
    nullif(p_entrada->>'fornecedor_id','')::integer,v_fiscal,v_chave,nullif(p_entrada->>'numero_nota',''),
    nullif(p_entrada->>'serie_nota',''),nullif(p_entrada->>'data_emissao','')::timestamptz,
    coalesce(nullif(p_entrada->>'tipo',''),'COMPRA_FORNECEDOR'),coalesce(nullif(p_entrada->>'origem',''),'MANUAL'),
    v_documento_id,v_user,nullif(btrim(coalesce(p_entrada->>'observacao','')),'')
  ) RETURNING id INTO v_entrada_id;

  FOR v_item_json IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_item_id:=nullif(v_item_json->>'item_id','')::integer;
    v_qtd:=nullif(v_item_json->>'quantidade','')::integer;
    v_custo:=nullif(v_item_json->>'valor_unitario_compra','')::numeric;
    v_desc:=coalesce(nullif(v_item_json->>'valor_desconto','')::numeric,0);
    v_frete:=coalesce(nullif(v_item_json->>'valor_frete','')::numeric,0);
    v_outras:=coalesce(nullif(v_item_json->>'outras_despesas','')::numeric,0);
    v_numero_item:=nullif(v_item_json->>'numero_item_fiscal','')::integer;
    IF v_item_id IS NULL OR v_qtd IS NULL OR v_qtd<=0 OR v_custo IS NULL OR v_custo<0
       OR v_desc<0 OR v_frete<0 OR v_outras<0 THEN
      RAISE EXCEPTION 'Item, quantidade ou valores invalidos.' USING ERRCODE='22023';
    END IF;
    IF v_fiscal AND v_documento_id IS NOT NULL AND v_numero_item IS NULL THEN
      RAISE EXCEPTION 'Informe o numero do item fiscal.' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_item FROM public.usoconsumo_item WHERE id=v_item_id AND ativo FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item % nao encontrado.',v_item_id USING ERRCODE='P0002'; END IF;
    v_total_item:=round(v_qtd*v_custo-v_desc+v_frete+v_outras,2);
    IF v_total_item<0 THEN RAISE EXCEPTION 'Total do item invalido.' USING ERRCODE='22023'; END IF;
    INSERT INTO public.usoconsumo_entrada_item(
      entrada_id,item_id,numero_item_fiscal,codigo_fornecedor,quantidade,unidade,valor_unitario_compra,
      valor_desconto,valor_frete,outras_despesas,valor_total,saldo_anterior,saldo_resultante,ncm,cest,csosn,
      referencia,titulo,cst,aliquotaicms,cfop,cst_pis,aliquota_pis,cst_cofins,aliquota_cofins,cst_ibscbs,
      cclass_trib,aliquota_ibs_uf,aliquota_ibs_municipio,aliquota_cbs
    ) VALUES(
      v_entrada_id,v_item_id,v_numero_item,nullif(v_item_json->>'codigo_fornecedor',''),v_qtd,
      coalesce(nullif(v_item_json->>'unidade','')::public.unidade_medida,v_item.unidade),v_custo,v_desc,v_frete,v_outras,
      v_total_item,v_item.estoque,v_item.estoque+v_qtd,coalesce(nullif(v_item_json->>'ncm',''),v_item.ncm),
      coalesce(nullif(v_item_json->>'cest',''),v_item.cest),coalesce(nullif(v_item_json->>'csosn',''),v_item.csosn),
      coalesce(nullif(v_item_json->>'referencia',''),v_item.referencia),coalesce(nullif(v_item_json->>'titulo',''),v_item.titulo),
      coalesce(nullif(v_item_json->>'cst',''),v_item.cst),coalesce(nullif(v_item_json->>'aliquotaicms','')::numeric,v_item.aliquotaicms),
      coalesce(nullif(v_item_json->>'cfop',''),v_item.cfop_entrada),coalesce(nullif(v_item_json->>'cst_pis',''),v_item.cst_pis),
      coalesce(nullif(v_item_json->>'aliquota_pis','')::numeric,v_item.aliquota_pis),
      coalesce(nullif(v_item_json->>'cst_cofins',''),v_item.cst_cofins),coalesce(nullif(v_item_json->>'aliquota_cofins','')::numeric,v_item.aliquota_cofins),
      coalesce(nullif(v_item_json->>'cst_ibscbs',''),v_item.cst_ibscbs),coalesce(nullif(v_item_json->>'cclass_trib',''),v_item.cclass_trib),
      coalesce(nullif(v_item_json->>'aliquota_ibs_uf','')::numeric,v_item.aliquota_ibs_uf),
      coalesce(nullif(v_item_json->>'aliquota_ibs_municipio','')::numeric,v_item.aliquota_ibs_municipio),
      coalesce(nullif(v_item_json->>'aliquota_cbs','')::numeric,v_item.aliquota_cbs)
    ) RETURNING id INTO v_entrada_item_id;
    PERFORM set_config('app.usoconsumo_movimento','permitido',true);
    UPDATE public.usoconsumo_item SET estoque=estoque+v_qtd,ultimovalordecompra=v_custo,updated_by=v_user WHERE id=v_item_id;
    INSERT INTO public.usoconsumo_movimento_entrada(
      entrada_id,entrada_item_id,item_id,tipo,quantidade,saldo_anterior,saldo_resultante,valor_unitario_compra,created_by
    ) VALUES(v_entrada_id,v_entrada_item_id,v_item_id,'ENTRADA',v_qtd,v_item.estoque,v_item.estoque+v_qtd,v_custo,v_user);
    IF nullif(p_entrada->>'fornecedor_id','') IS NOT NULL THEN
      INSERT INTO public.usoconsumo_fornecedor_item(fornecedor_id,item_id,codigo_fornecedor,ultimo_valor_compra)
      VALUES((p_entrada->>'fornecedor_id')::integer,v_item_id,nullif(v_item_json->>'codigo_fornecedor',''),v_custo)
      ON CONFLICT(fornecedor_id,item_id) DO UPDATE SET
        codigo_fornecedor=coalesce(EXCLUDED.codigo_fornecedor,usoconsumo_fornecedor_item.codigo_fornecedor),
        ultimo_valor_compra=EXCLUDED.ultimo_valor_compra,updated_at=now();
    END IF;
    IF v_fiscal AND v_documento_id IS NOT NULL THEN
      INSERT INTO public.fiscal_dfe_item_apropriacao(
        documento_id,numero_item,destino,usoconsumo_entrada_id,quantidade,created_by
      ) VALUES(v_documento_id,v_numero_item,'USOCONSUMO',v_entrada_id,v_qtd,v_user);
    END IF;
    v_total:=v_total+v_total_item;
  END LOOP;
  UPDATE public.usoconsumo_entrada SET valor_total=round(v_total,2) WHERE id=v_entrada_id;

  IF jsonb_typeof(p_transacoes)='array' AND jsonb_array_length(p_transacoes)>0 THEN
    SELECT round(coalesce(sum((value->>'valor')::numeric),0),2) INTO v_total_fin FROM jsonb_array_elements(p_transacoes);
    IF v_total_fin<>round(v_total,2) THEN
      RAISE EXCEPTION 'A soma dos lancamentos financeiros difere do total da entrada.' USING ERRCODE='22023';
    END IF;
    FOR v_tx IN SELECT value FROM jsonb_array_elements(p_transacoes) LOOP
      IF coalesce(nullif(v_tx->>'valor','')::numeric,0)<=0 THEN
        RAISE EXCEPTION 'Valor financeiro invalido.' USING ERRCODE='22023';
      END IF;
      INSERT INTO public.transacao(
        descricao,valor,"valorLiquido",data,vencimento_em,metodopagamento,categoria,categoria_id,tipo,cliente_id,
        banco_id,nomepagador,cpfcnpjpagador,pendente,plano_de_conta_id,plano_de_conta,centro_custo_id,
        centro_custo,usoconsumo_entrada_id,origem,created_by
      ) VALUES(
        coalesce(nullif(v_tx->>'descricao',''),'Compra de material de uso e consumo'),(v_tx->>'valor')::numeric,
        (v_tx->>'valor')::numeric,coalesce(nullif(v_tx->>'data','')::timestamptz,now()),
        nullif(v_tx->>'vencimento_em','')::timestamptz,nullif(v_tx->>'metodopagamento','')::public.metodo_pagamento,
        coalesce(nullif(v_tx->>'categoria',''),'Compra de material de uso e consumo'),
        nullif(v_tx->>'categoria_id','')::integer,'DESPESA',NULL,nullif(v_tx->>'banco_id','')::bigint,
        coalesce(nullif(v_tx->>'nomepagador',''),'Fornecedor'),
        coalesce(nullif(regexp_replace(v_tx->>'cpfcnpjpagador','\D','','g'),''),'NAO INFORMADO'),
        coalesce((v_tx->>'pendente')::boolean,false),nullif(v_tx->>'plano_de_conta_id','')::integer,
        nullif(v_tx->>'plano_de_conta',''),nullif(v_tx->>'centro_custo_id','')::integer,
        nullif(v_tx->>'centro_custo',''),v_entrada_id,'USOCONSUMO_ENTRADA',v_user
      );
    END LOOP;
  END IF;
  RETURN jsonb_build_object('entrada_id',v_entrada_id,'valor_total',round(v_total,2));
END $function$;
