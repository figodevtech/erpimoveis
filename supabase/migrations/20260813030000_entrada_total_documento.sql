-- O financeiro da entrada fecha pelo total do DOCUMENTO, não pelo custo dos itens.
--
-- PROBLEMA
-- A NF-e pode declarar frete (ou seguro, ou despesa acessória) só em `ICMSTot`,
-- sem repartir entre os itens — comum em CIF. O `vNF` inclui esse valor e as
-- duplicatas também: uma nota de R$ 4.000 em produtos com R$ 200 de frete no
-- cabeçalho vale R$ 4.200, e é isso que se paga ao fornecedor.
--
-- A entrada, porém, soma os itens: R$ 4.000. Como o dinheiro devido é o da nota,
-- as parcelas precisam somar R$ 4.200 — e as três RPCs de entrada tratavam isso
-- de formas diferentes:
--
--   estoque      já aceitava `valor_total_documento` e comparava o financeiro
--                contra ele (era a válvula para nota parcialmente apropriada);
--   uso/consumo  comparava contra a soma dos itens, sem válvula nenhuma;
--   mista        comparava contra a soma das duas entradas.
--
-- Ou seja, o mesmo lançamento passava por um caminho e era recusado nos outros,
-- com erro técnico de RPC. Esta migration dá aos dois que faltavam a mesma
-- válvula que o estoque já tinha.
--
-- O QUE NÃO MUDA
-- O custo dos itens. `valor_total_documento` entra no total da entrada e na
-- conferência do financeiro; o preço de compra de cada produto continua saindo
-- da própria linha. Ratear o frete do cabeçalho entre os itens é outra decisão,
-- deliberadamente não tomada — o frete sem dono fica visível como diferença
-- entre o total do documento e a soma dos itens.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Uso e consumo
--
-- Idêntica à versão de 20260731180000, exceto por `v_total_documento`: a leitura,
-- a guarda de valor negativo e os três pontos onde o total passa a ser
-- `coalesce(documento, soma dos itens)`.
-- ---------------------------------------------------------------------------

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
  -- Total da nota quando ele é maior que a soma dos itens (frete no cabeçalho,
  -- nota parcialmente apropriada). Nulo mantém o comportamento antigo.
  v_total_documento numeric(14,2) := nullif(p_entrada->>'valor_total_documento','')::numeric;
  v_total_devido numeric(14,2);
BEGIN
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE='22023';
  END IF;
  IF v_total_documento IS NOT NULL AND v_total_documento < 0 THEN
    RAISE EXCEPTION 'O total do documento fiscal não pode ser negativo.' USING ERRCODE='22023';
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

  -- O total da entrada é o do documento quando ele foi informado. Mesmo critério
  -- de `registrar_entrada_confirmada`, para as duas metades de uma nota mista
  -- não responderem a regras diferentes.
  v_total_devido := round(coalesce(v_total_documento, v_total),2);
  UPDATE public.usoconsumo_entrada SET valor_total=v_total_devido WHERE id=v_entrada_id;

  IF jsonb_typeof(p_transacoes)='array' AND jsonb_array_length(p_transacoes)>0 THEN
    SELECT round(coalesce(sum((value->>'valor')::numeric),0),2) INTO v_total_fin FROM jsonb_array_elements(p_transacoes);
    IF v_total_fin<>v_total_devido THEN
      RAISE EXCEPTION 'A soma dos lancamentos financeiros (%) difere do total da entrada (%).',
        v_total_fin, v_total_devido USING ERRCODE='22023';
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
  RETURN jsonb_build_object('entrada_id',v_entrada_id,'valor_total',v_total_devido);
END $function$;

-- ---------------------------------------------------------------------------
-- 2) Nota mista
--
-- Aqui o total do documento não pode descer para as sub-entradas: cada metade
-- fecha pelos próprios itens (era o que o `- 'valor_total_documento'` já
-- garantia do lado do estoque). O que muda é a base da conferência do
-- financeiro, que passa a ser o documento quando ele foi informado.
-- ---------------------------------------------------------------------------

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
  v_entrada_uso jsonb;
  v_documento_id bigint := nullif(p_entrada_produto->>'fiscal_dfe_documento_id','')::bigint;
  v_total numeric(14,2);
  v_total_itens numeric(14,2);
  v_total_documento numeric(14,2) := nullif(p_entrada_produto->>'valor_total_documento','')::numeric;
  v_total_fin numeric(14,2);
  v_tx jsonb;
  v_user uuid := nullif(p_entrada_produto->>'created_by','')::uuid;
BEGIN
  IF jsonb_typeof(p_itens_produto) <> 'array' OR jsonb_array_length(p_itens_produto) = 0
     OR jsonb_typeof(p_itens_usoconsumo) <> 'array' OR jsonb_array_length(p_itens_usoconsumo) = 0 THEN
    RAISE EXCEPTION 'A entrada mista exige ao menos um item de estoque e um item de uso e consumo.'
      USING ERRCODE = '22023';
  END IF;

  IF v_total_documento IS NOT NULL AND v_total_documento < 0 THEN
    RAISE EXCEPTION 'O total do documento fiscal não pode ser negativo.' USING ERRCODE = '22023';
  END IF;

  -- Sem valor_total_documento a entrada de estoque fecha pelo total dos seus proprios
  -- itens, e nao pelo total da NF-e (que inclui a parte de uso e consumo). O mesmo
  -- vale agora para a metade de uso e consumo, que ganhou a mesma válvula.
  v_entrada_produto := p_entrada_produto - 'valor_total_documento';
  v_entrada_uso := p_entrada_usoconsumo - 'valor_total_documento';

  -- As duas entradas sao gravadas sem transacoes: o pagamento e unico e vem depois.
  IF v_documento_id IS NOT NULL THEN
    SELECT public.registrar_entrada_comercial_apropriada(v_entrada_produto, p_itens_produto, '[]'::jsonb)
      INTO v_res_produto;
  ELSE
    SELECT public.registrar_entrada_confirmada(v_entrada_produto, p_itens_produto, '[]'::jsonb)
      INTO v_res_produto;
  END IF;
  v_entrada_id := (v_res_produto->>'entrada_id')::bigint;

  SELECT public.registrar_entrada_usoconsumo(v_entrada_uso, p_itens_usoconsumo, '[]'::jsonb)
    INTO v_res_uso;
  v_uso_entrada_id := (v_res_uso->>'entrada_id')::bigint;

  v_total_itens := round(
    coalesce((v_res_produto->>'valor_total')::numeric, 0)
    + coalesce((v_res_uso->>'valor_total')::numeric, 0), 2);

  -- O documento manda quando informado: é ele que o fornecedor cobra, e é contra
  -- ele que as duplicatas fecham. Sem ele, vale a soma das duas entradas.
  v_total := round(coalesce(v_total_documento, v_total_itens), 2);

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

COMMIT;
